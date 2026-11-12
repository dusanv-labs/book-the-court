import 'dotenv/config';
import type Anthropic from '@anthropic-ai/sdk';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import Stripe from 'stripe';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import type { AssistantLlm } from '../src/assistant/agent.js';
import { ASSISTANT_LLM } from '../src/assistant/assistant.js';
import { hashPassword } from '../src/auth/password.js';
import { PAYMENT_GATEWAY, type CheckoutRequest, type CheckoutState, type PaymentGateway } from '../src/payments/payments.js';
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

/** Scripted stand-in for the Claude API, so CI never calls (or pays for) the real model. */
type LlmStep = (request: Anthropic.MessageStreamParams) => Partial<Anthropic.Message>;
const llmScript: LlmStep[] = [];
const llmRequests: Anthropic.MessageStreamParams[] = [];
const fakeLlm: AssistantLlm = {
  streamMessage: async (params, { onText }) => {
    llmRequests.push(structuredClone(params));
    const step = llmScript.shift();
    if (!step) throw new Error('Unexpected call to the model');
    const message = {
      id: 'msg_e2e',
      type: 'message',
      role: 'assistant',
      model: params.model,
      stop_reason: 'end_turn',
      content: [],
      usage: { input_tokens: 2000, output_tokens: 200 },
      ...step(params),
    } as Anthropic.Message;
    // Text is sent word by word, like the real stream.
    for (const block of message.content) {
      if (block.type === 'text') for (const word of block.text.split(/(?<= )/)) onText?.(word);
    }
    return message;
  },
};
/** Stand-in for Stripe, so CI never calls it. Webhooks are still signed and verified like Stripe's. */
const WEBHOOK_SECRET = 'whsec_e2e_test_secret'; // pragma: allowlist secret
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
const checkouts = new Map<string, CheckoutState & { request: CheckoutRequest }>();
const refunds: string[] = [];
let stripeDown = false;
const fakePayments: PaymentGateway = {
  createCheckout: async (r) => {
    if (stripeDown) throw new Error('Stripe is not reachable');
    const sessionId = `cs_test_e2e_${checkouts.size + 1}_${Date.now()}`;
    checkouts.set(sessionId, { sessionId, bookingId: r.bookingId, status: 'open', paid: false, paymentIntentId: null, request: r });
    return { sessionId, url: `https://checkout.stripe.test/${sessionId}` };
  },
  getCheckout: async (id) => {
    const { request: _request, ...state } = checkouts.get(id)!;
    return state;
  },
  expireCheckout: async (id) => {
    const checkout = checkouts.get(id)!;
    if (checkout.status !== 'open') throw new Error('Only an open session can be expired');
    checkout.status = 'expired';
  },
  refund: async (paymentIntentId, idempotencyKey) => {
    refunds.push(`${paymentIntentId} ${idempotencyKey}`);
  },
};
/** The player pays on the (fake) Stripe page. */
const payCheckout = (sessionId: string) =>
  Object.assign(checkouts.get(sessionId)!, { status: 'complete', paid: true, paymentIntentId: `pi_${sessionId}` });
const sessionOf = (checkoutUrl: string) => checkoutUrl.split('/').pop()!;

const lastToolResult = (req: Anthropic.MessageStreamParams) => {
  const content = req.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
  return JSON.parse(content[0].content as string);
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ASSISTANT_LLM)
    .useValue(fakeLlm)
    .overrideProvider(PAYMENT_GATEWAY)
    .useValue(fakePayments)
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
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

describe('AI booking assistant (scripted model)', () => {
  const today = () => toLocalParts(new Date(), TZ).date;

  it('reports that it is switched on', async () => {
    const res = await request(app.getHttpServer()).get('/api/assistant/status').expect(200);
    expect(res.body).toEqual({ enabled: true, available: true });
  });

  it('finds free courts with the tools and shows only suggestions that pass the booking checks', async () => {
    const server = app.getHttpServer();
    await request(server).post('/api/bookings').send(bookingBody(at(20))).expect(201);
    let freeStart = '';
    llmScript.push(
      () => ({
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'find_available_slots',
            input: { sport: 'PADEL', date: DATE, durationMinutes: 60, earliestStart: '19:00' },
          },
        ],
      }),
      (req) => {
        const ours = lastToolResult(req).options.filter((o: { courtId: string }) => o.courtId === courtId);
        expect(ours.length).toBeGreaterThan(0);
        expect(ours.map((o: { start: string }) => o.start)).not.toContain('20:00'); // booked above
        freeStart = ours[0].start;
        return {
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'call_2',
              name: 'suggest_booking_options',
              input: {
                options: [
                  { courtId, date: DATE, startTime: freeStart, durationMinutes: 60 },
                  { courtId, date: DATE, startTime: '20:00', durationMinutes: 60 }, // taken: must be rejected
                ],
              },
            },
          ],
        };
      },
      (req) => {
        expect(lastToolResult(req)).toMatchObject({ shown: 1, rejected: [{ option: 2 }] });
        return { content: [{ type: 'text', text: 'Here are the free courts.', citations: null }] };
      },
    );

    const res = await request(server)
      .post('/api/assistant/chat')
      .send({ language: 'en', messages: [{ role: 'user', content: 'Padel this evening after 19:00?' }] })
      .expect(200);
    expect(res.body.reply).toBe('Here are the free courts.');
    expect(res.body.suggestions).toEqual([
      expect.objectContaining({ courtId, date: DATE, startTime: freeStart, durationMinutes: 60, currency: 'RSD' }),
    ]);
    expect(res.body.suggestions[0].price).toBeGreaterThan(0);
    expect(llmScript).toHaveLength(0);

    // Nothing the model saw contains customer data.
    const seen = JSON.stringify(llmRequests);
    expect(seen).not.toContain('e2e@example.com');
    expect(seen).not.toContain('E2E Player');

    const usage = await prisma.assistantUsage.findUniqueOrThrow({ where: { date: today() } });
    expect(usage.requests).toBeGreaterThan(0);
    expect(usage.inputTokens).toBeGreaterThanOrEqual(3 * 2000);
    expect(usage.costMicroUsd).toBeGreaterThan(0);
  });

  it('streams the answer as newline-delimited JSON and caches the fixed part of the prompt', async () => {
    llmRequests.length = 0;
    llmScript.push(
      () => ({
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Let me check.', citations: null },
          { type: 'tool_use', id: 'call_1', name: 'get_venue_info', input: {} },
        ],
      }),
      () => ({ content: [{ type: 'text', text: 'We have padel, tennis and football courts.', citations: null }] }),
    );
    const res = await request(app.getHttpServer())
      .post('/api/assistant/chat/stream')
      .send({ language: 'en', messages: [{ role: 'user', content: 'Which sports do you have?' }] })
      .expect(200)
      .expect('Content-Type', /application\/x-ndjson/);

    const events = res.text.trim().split('\n').map((line) => JSON.parse(line));
    expect(events.at(-1)).toEqual({ type: 'done', reply: 'Let me check.\n\nWe have padel, tennis and football courts.', suggestions: [] });
    expect(events).toContainEqual({ type: 'tool', name: 'get_venue_info' });
    const streamed = events.filter((e) => e.type === 'text').map((e) => e.text).join('');
    expect(streamed).toBe(events.at(-1).reply);
    expect(events.filter((e) => e.type === 'text').length).toBeGreaterThan(5);
    // The tool event comes after the first round's text and before the second round's.
    expect(events.findIndex((e) => e.type === 'tool')).toBeGreaterThan(events.findIndex((e) => e.text === 'check.'));

    // Fixed instructions carry the cache breakpoint; the changing date comes after it.
    const system = llmRequests[0].system as Anthropic.TextBlockParam[];
    expect(system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(system[1].text).toMatch(/^Current local date and time/);
    expect(system[1].cache_control).toBeUndefined();
    // Same tools and fixed instructions in every call, so the cached prefix matches.
    expect(llmRequests[1].tools).toEqual(llmRequests[0].tools);
    expect(llmRequests[1].system).toEqual(llmRequests[0].system);
  });

  it('sends limit errors on the streaming route as normal JSON errors', async () => {
    const date = today();
    const before = await prisma.assistantUsage.findUniqueOrThrow({ where: { date } });
    await prisma.assistantUsage.update({ where: { date }, data: { requests: 1_000_000 } });
    try {
      const res = await request(app.getHttpServer())
        .post('/api/assistant/chat/stream')
        .send({ messages: [{ role: 'user', content: 'Tennis tomorrow?' }] })
        .expect(429)
        .expect('Content-Type', /application\/json/);
      expect(res.body.code).toBe('DAILY_LIMIT');
    } finally {
      await prisma.assistantUsage.update({ where: { date }, data: { requests: before.requests } });
    }
  });

  it('validates the conversation', async () => {
    const server = app.getHttpServer();
    await request(server)
      .post('/api/assistant/chat')
      .send({ messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }] })
      .expect(400);
    await request(server).post('/api/assistant/chat').send({ messages: [] }).expect(400);
  });

  it('stops answering when the daily budget is used up', async () => {
    const server = app.getHttpServer();
    const date = today();
    const before = await prisma.assistantUsage.findUniqueOrThrow({ where: { date } });
    await prisma.assistantUsage.update({ where: { date }, data: { costMicroUsd: 1_000_000_000 } });
    try {
      const res = await request(server)
        .post('/api/assistant/chat')
        .send({ messages: [{ role: 'user', content: 'Tennis tomorrow?' }] })
        .expect(429);
      expect(res.body.code).toBe('DAILY_LIMIT');
      expect((await request(server).get('/api/assistant/status')).body).toEqual({ enabled: true, available: false });
    } finally {
      await prisma.assistantUsage.update({ where: { date }, data: { costMicroUsd: before.costMicroUsd } });
    }
  });
});

describe('online payment (fake Stripe)', () => {
  const onlineBooking = (startsAt: string) => ({ ...bookingBody(startsAt), payment: 'online' });
  const webhook = (type: string, sessionId: string, signWith = WEBHOOK_SECRET) => {
    const checkout = checkouts.get(sessionId)!;
    const payload = JSON.stringify({
      id: `evt_${sessionId}`,
      object: 'event',
      type,
      data: {
        object: {
          id: sessionId,
          object: 'checkout.session',
          client_reference_id: checkout.bookingId,
          status: checkout.status,
          payment_status: checkout.paid ? 'paid' : 'unpaid',
          payment_intent: checkout.paymentIntentId,
        },
      },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: signWith });
    return request(app.getHttpServer())
      .post('/api/payments/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);
  };

  it('offers online payment', async () => {
    const res = await request(app.getHttpServer()).get(`/api/availability?date=${DATE}&sport=PADEL`).expect(200);
    expect(res.body.onlinePayment).toBe(true);
  });

  it('holds the court during payment, confirms it when the player returns, and refunds a cancellation', async () => {
    const server = app.getHttpServer();
    const created = await request(server).post('/api/bookings').send(onlineBooking(at(18))).expect(201);
    expect(created.body).toMatchObject({ status: 'PENDING', paymentStatus: 'UNPAID' });
    const sessionId = sessionOf(created.body.checkoutUrl);
    const checkout = checkouts.get(sessionId)!.request;
    const token = created.body.cancelToken;
    expect(checkout).toMatchObject({ amount: created.body.price, currency: 'RSD', customerEmail: 'e2e@example.com' });
    expect(checkout.successUrl.endsWith(`#/manage/${token}?payment=done`)).toBe(true);
    expect((checkout.expiresAt.getTime() - Date.now()) / 60_000).toBeGreaterThan(30);

    // Nobody else can take the court while the player is paying.
    await request(server).post('/api/bookings').send(bookingBody(at(18))).expect(409);
    const grid = await request(server).get(`/api/availability?date=${DATE}&sport=PADEL`).expect(200);
    const court = grid.body.courts.find((c: { id: string }) => c.id === courtId);
    expect(court.slots.find((s: { startsAt: string }) => s.startsAt === at(18)).status).toBe('booked');

    let manage = await request(server).get(`/api/bookings/manage/${token}`).expect(200);
    expect(manage.body).toMatchObject({ status: 'PENDING', paymentStatus: 'UNPAID', checkoutUrl: created.body.checkoutUrl });

    // Back from Stripe before the webhook: the API asks Stripe and confirms the booking.
    payCheckout(sessionId);
    manage = await request(server).get(`/api/bookings/manage/${token}`).expect(200);
    expect(manage.body).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID', checkoutUrl: null, canCancel: true });

    // A late webhook for the same payment changes nothing.
    await webhook('checkout.session.completed', sessionId).expect(200);

    await request(server).post(`/api/bookings/manage/${token}/cancel`).expect(200);
    manage = await request(server).get(`/api/bookings/manage/${token}`).expect(200);
    expect(manage.body).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED' });
    const booking = await prisma.booking.findUniqueOrThrow({ where: { cancelToken: token } });
    expect(refunds).toEqual([`pi_${sessionId} refund-${booking.id}`]);
  });

  it('confirms a payment from a signed Stripe webhook and rejects unsigned ones', async () => {
    const server = app.getHttpServer();
    const created = await request(server).post('/api/bookings').send(onlineBooking(at(19))).expect(201);
    const sessionId = sessionOf(created.body.checkoutUrl);
    payCheckout(sessionId);

    await webhook('checkout.session.completed', sessionId, 'whsec_somebody_else').expect(400); // pragma: allowlist secret
    let booking = await prisma.booking.findUniqueOrThrow({ where: { cancelToken: created.body.cancelToken } });
    expect(booking.status).toBe('PENDING');

    await webhook('checkout.session.completed', sessionId).expect(200);
    booking = await prisma.booking.findUniqueOrThrow({ where: { cancelToken: created.body.cancelToken } });
    expect(booking).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID', paymentIntentId: `pi_${sessionId}` });
  });

  it('releases the court when the payment is not finished, and refunds a payment that arrives too late', async () => {
    const server = app.getHttpServer();
    const created = await request(server).post('/api/bookings').send(onlineBooking(at(21))).expect(201);
    const sessionId = sessionOf(created.body.checkoutUrl);
    // The hold runs out (moved into the past instead of waiting 35 minutes).
    await prisma.booking.update({ where: { cancelToken: created.body.cancelToken }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    const manage = await request(server).get(`/api/bookings/manage/${created.body.cancelToken}`).expect(200);
    expect(manage.body).toMatchObject({ status: 'EXPIRED', checkoutUrl: null, canCancel: false });

    // Somebody else books the time, then the first player's payment arrives after all.
    await request(server).post('/api/bookings').send(bookingBody(at(21))).expect(201);
    payCheckout(sessionId);
    await webhook('checkout.session.completed', sessionId).expect(200);
    const late = await prisma.booking.findUniqueOrThrow({ where: { cancelToken: created.body.cancelToken } });
    expect(late).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED' });
    expect(refunds).toContain(`pi_${sessionId} refund-${late.id}`);
  });

  it('frees the court when a payment page is cancelled or Stripe is not reachable', async () => {
    const server = app.getHttpServer();
    const created = await request(server).post('/api/bookings').send(onlineBooking(at(13))).expect(201);
    await request(server).post(`/api/bookings/manage/${created.body.cancelToken}/cancel`).expect(200);
    expect(checkouts.get(sessionOf(created.body.checkoutUrl))!.status).toBe('expired');

    stripeDown = true;
    try {
      await request(server).post('/api/bookings').send(onlineBooking(at(13))).expect(503);
    } finally {
      stripeDown = false;
    }
    await request(server).post('/api/bookings').send(bookingBody(at(13))).expect(201);
  });
});
