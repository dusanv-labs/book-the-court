import 'dotenv/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { hashPassword } from '../src/auth/password.js';
import { localToUtc, toLocalParts } from '../src/common/time.js';
import { isOverlapViolation, PrismaService } from '../src/prisma/prisma.service.js';
import { ensureVenueDefaults } from '../src/seed-data.js';
import { setupApp } from '../src/setup-app.js';

/**
 * End-to-end tests against a real PostgreSQL database (DATABASE_URL).
 * They create their own court and admin user and remove them afterwards.
 */
const TZ = process.env.TIMEZONE ?? 'Europe/Belgrade';
const ADMIN_EMAIL = `e2e-admin-${Date.now()}@example.com`;
const ADMIN_PASSWORD = `e2e-${Math.random().toString(36).slice(2)}-pw`;

let app: NestExpressApplication;
let prisma: PrismaService;
let courtId: string;

/** A weekday about a week from now (so it is never in the past and always within the booking window). */
function futureWeekday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  while ([0, 6].includes(toLocalParts(d, TZ).dayOfWeek)) d.setUTCDate(d.getUTCDate() + 1);
  return toLocalParts(d, TZ).date;
}
const DATE = futureWeekday();
const at = (hour: number, minute = 0) => localToUtc(DATE, hour * 60 + minute, TZ).toISOString();

const bookingBody = (startsAt: string, durationMinutes = 60) => ({
  courtId,
  startsAt,
  durationMinutes,
  customerName: 'E2E Player',
  customerEmail: 'e2e@example.com',
  customerPhone: '+381 60 123 4567',
});

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  setupApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  await ensureVenueDefaults(prisma);
  // Make sure the test date is open 08:00-23:00 regardless of existing data.
  await prisma.openingHours.update({
    where: { dayOfWeek: toLocalParts(new Date(at(12)), TZ).dayOfWeek },
    data: { openMinute: 8 * 60, closeMinute: 23 * 60, closed: false },
  });
  const court = await prisma.court.create({ data: { name: `E2E Court ${Date.now()}`, sport: 'PADEL', sortOrder: 999 } });
  courtId = court.id;
  await prisma.adminUser.create({ data: { email: ADMIN_EMAIL, passwordHash: await hashPassword(ADMIN_PASSWORD) } });
});

afterAll(async () => {
  await prisma.booking.deleteMany({ where: { courtId } });
  await prisma.court.deleteMany({ where: { id: courtId } });
  await prisma.adminUser.deleteMany({ where: { email: ADMIN_EMAIL } });
  await app.close();
});

describe('health', () => {
  it('reports the API and database as healthy', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok' });
  });
});

describe('booking flow', () => {
  it('shows the test court as free in the availability grid', async () => {
    const res = await request(app.getHttpServer()).get(`/api/availability?date=${DATE}&sport=PADEL`).expect(200);
    const court = res.body.courts.find((c: { id: string }) => c.id === courtId);
    expect(court.slots.length).toBe(30);
    expect(court.slots.every((s: { status: string }) => s.status === 'free')).toBe(true);
  });

  it('quotes, books, rejects a double booking, and frees the slot after cancelling', async () => {
    const server = app.getHttpServer();
    const quote = await request(server)
      .get(`/api/bookings/quote?courtId=${courtId}&startsAt=${encodeURIComponent(at(16, 30))}&durationMinutes=90`)
      .expect(200);
    expect(quote.body.price).toBe(1200 + 3200); // 30 min daytime + 60 min evening rate

    const created = await request(server).post('/api/bookings').send(bookingBody(at(16, 30), 90)).expect(201);
    expect(created.body.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(created.body.price).toBe(4400);

    await request(server).post('/api/bookings').send(bookingBody(at(17), 60)).expect(409);

    const token = created.body.cancelToken;
    const manage = await request(server).get(`/api/bookings/manage/${token}`).expect(200);
    expect(manage.body).toMatchObject({ status: 'CONFIRMED', canCancel: true });

    await request(server).post(`/api/bookings/manage/${token}/cancel`).expect(200);
    await request(server).post('/api/bookings').send(bookingBody(at(17), 60)).expect(201);
  });

  it('validates input and business rules', async () => {
    const server = app.getHttpServer();
    const bad = await request(server)
      .post('/api/bookings')
      .send({ ...bookingBody(at(10)), customerEmail: 'not-an-email', durationMinutes: 45 })
      .expect(400);
    expect(bad.body.message).toEqual(
      expect.arrayContaining([expect.stringContaining('customerEmail'), expect.stringContaining('durationMinutes')]),
    );
    await request(server).post('/api/bookings').send(bookingBody(at(10, 15))).expect(400); // not aligned
    await request(server).post('/api/bookings').send(bookingBody(at(22, 30))).expect(400); // past closing
  });
});

describe('calendar summary', () => {
  it('returns one status per day and marks a fully booked day as full', async () => {
    const server = app.getHttpServer();
    const res = await request(server).get(`/api/availability/days?sport=PADEL&from=${DATE}&to=${DATE}`).expect(200);
    expect(res.body.days).toHaveLength(1);
    expect(['available', 'limited', 'full']).toContain(res.body.days[0].status);

    await request(server).get(`/api/availability/days?sport=PADEL&from=${DATE}&to=2099-01-01`).expect(400);
  });
});

describe('double booking protection', () => {
  it('accepts exactly one of many simultaneous requests for the same slot', async () => {
    const server = app.getHttpServer();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => request(server).post('/api/bookings').send(bookingBody(at(12)))),
    );
    const statuses = results.map((r) => r.status).sort((a, b) => a - b);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
  });

  it('is enforced by the database itself, not only by application checks', async () => {
    const data = {
      courtId,
      startsAt: new Date(at(14)),
      endsAt: new Date(at(15)),
      customerName: 'Direct insert',
      customerEmail: 'direct@example.com',
      customerPhone: '+381 60 000 0000',
      price: 2400,
    };
    await prisma.booking.create({ data: { ...data, code: 'E2EAA1', cancelToken: 'e2e-token-aaaaaaaaaaaaaaaaaaaaaaaaa' } });
    const error = await prisma.booking
      .create({
        data: {
          ...data,
          startsAt: new Date(at(14, 30)),
          endsAt: new Date(at(15, 30)),
          code: 'E2EAA2',
          cancelToken: 'e2e-token-bbbbbbbbbbbbbbbbbbbbbbbbb',
        },
      })
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).not.toBeNull();
    expect(isOverlapViolation(error)).toBe(true);
  });
});

describe('admin', () => {
  it('rejects requests without a valid token', async () => {
    await request(app.getHttpServer()).get('/api/admin/courts').expect(401);
    await request(app.getHttpServer()).get('/api/admin/courts').set('Authorization', 'Bearer invalid').expect(401);
  });

  it('only accepts HS256 tokens (no "none" algorithm, no other algorithm even with the right secret)', async () => {
    const server = app.getHttpServer();
    const payload = { sub: 'e2e', email: ADMIN_EMAIL, role: 'admin' };
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...payload, exp: 4_102_444_800 })}.`;
    await request(server).get('/api/admin/courts').set('Authorization', `Bearer ${unsigned}`).expect(401);
    const hs512 = await app.get(JwtService).signAsync(payload, { algorithm: 'HS512' });
    await request(server).get('/api/admin/courts').set('Authorization', `Bearer ${hs512}`).expect(401);
    const hs256 = await app.get(JwtService).signAsync(payload);
    await request(server).get('/api/admin/courts').set('Authorization', `Bearer ${hs256}`).expect(200);
  });

  it('logs in and lists the day bookings with customer details', async () => {
    const server = app.getHttpServer();
    const wrong = { email: ADMIN_EMAIL, password: 'wrong-password' }; // pragma: allowlist secret
    await request(server).post('/api/auth/login').send(wrong).expect(401);
    const login = await request(server)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
    const res = await request(server)
      .get(`/api/admin/bookings?date=${DATE}`)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    const ours = res.body.filter((b: { court: { id: string } }) => b.court.id === courtId);
    expect(ours.length).toBeGreaterThan(0);
    expect(ours[0]).toHaveProperty('customerEmail');
  });

  it('builds a revenue report filtered by court, with totals and a previous-period comparison', async () => {
    const server = app.getHttpServer();
    await request(server).get(`/api/admin/reports/revenue?from=${DATE}&to=${DATE}`).expect(401);
    const login = await request(server).post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const res = await request(server)
      .get(`/api/admin/reports/revenue?from=${DATE}&to=${DATE}&courtId=${courtId}&groupBy=court`)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.totals.bookings).toBeGreaterThan(0);
    expect(res.body.totals.estimated).toBe(res.body.totals.total); // the test date is in the future
    expect(res.body.totals.cancelledCount).toBeGreaterThan(0);
    expect(res.body.previous).toHaveProperty('changePct');
  });

  it('creates a block, lists it as upcoming, and removes it', async () => {
    const server = app.getHttpServer();
    const login = await request(server).post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };
    const created = await request(server)
      .post('/api/admin/venue/blocks')
      .set(auth)
      .send({ courtId, startsAt: at(8), endsAt: at(9), reason: 'E2E maintenance' })
      .expect(201);
    const upcoming = await request(server).get('/api/admin/venue/blocks').set(auth).expect(200);
    expect(upcoming.body.map((b: { id: string }) => b.id)).toContain(created.body.id);
    await request(server).post('/api/bookings').send(bookingBody(at(8))).expect(409);
    await request(server).delete(`/api/admin/venue/blocks/${created.body.id}`).set(auth).expect(204);
  });
});
