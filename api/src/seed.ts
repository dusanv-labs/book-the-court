/**
 * Seeds the database with a demo venue.
 *   npm run db:seed            courts, opening hours, prices, admin user (from env)
 *   npm run db:seed -- --demo  also adds sample bookings for the next days
 *   npm run db:seed -- --reset --demo  wipes ALL data first (used by the nightly demo reset)
 * Admin credentials come from SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD; they are never hard-coded.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from './auth/password.js';
import { generateBookingCode, generateCancelToken } from './bookings/domain/codes.js';
import { quotePrice } from './bookings/domain/pricing.js';
import { addMinutes, DEFAULT_TIMEZONE, localToUtc, toLocalParts } from './common/time.js';
import { PrismaClient } from './generated/prisma/client.js';
import { DEFAULT_COURTS, DEFAULT_PRICE_RULES, ensureVenueDefaults } from './seed-data.js';

const tz = process.env.TIMEZONE ?? DEFAULT_TIMEZONE;
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }) });

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log('- Admin: skipped (set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to create one)');
    return;
  }
  if (password.length < 10) throw new Error('SEED_ADMIN_PASSWORD must be at least 10 characters');
  const passwordHash = await hashPassword(password);
  await prisma.adminUser.upsert({ where: { email }, create: { email, passwordHash }, update: { passwordHash } });
  console.log(`- Admin: ${email}`);
}

async function seedCourts() {
  if ((await prisma.court.count()) > 0) {
    console.log('- Courts: already present, skipped');
    return;
  }
  await prisma.court.createMany({ data: DEFAULT_COURTS.map((c) => ({ ...c })) });
  console.log(`- Courts: created ${DEFAULT_COURTS.length}`);
}

async function seedDemoBookings() {
  const upcoming = await prisma.booking.count({ where: { startsAt: { gt: new Date() } } });
  if (upcoming > 0) {
    console.log('- Demo bookings: upcoming bookings exist, skipped');
    return;
  }
  const courts = await prisma.court.findMany({ where: { active: true } });
  const today = toLocalParts(new Date(), tz).date;
  const dayPlus = (n: number) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  // [days from today, court name, local start hour, duration minutes]
  const plan: [number, string, number, number][] = [
    [1, 'Padel 1', 18, 90],
    [1, 'Padel 2', 19, 60],
    [1, 'Padel 3', 20, 120],
    [1, 'Tennis 1', 10, 60],
    [1, 'Football 1', 18, 60],
    [2, 'Padel 1', 20, 120],
    [2, 'Padel 2', 17, 90],
    [2, 'Tennis 2', 18, 60],
    [3, 'Padel 3', 17, 90],
    [3, 'Padel 1', 11, 60],
    [4, 'Padel 2', 19, 90],
    [4, 'Football 1', 20, 60],
    [5, 'Padel 1', 18, 120],
  ];
  let created = 0;
  for (const [days, courtName, hour, duration] of plan) {
    const court = courts.find((c) => c.name === courtName);
    if (!court) continue;
    const startsAt = localToUtc(dayPlus(days), hour * 60, tz);
    const price = quotePrice({ sport: court.sport, startsAt, durationMinutes: duration, rules: DEFAULT_PRICE_RULES, tz });
    await prisma.booking.create({
      data: {
        code: generateBookingCode(),
        cancelToken: generateCancelToken(),
        courtId: court.id,
        startsAt,
        endsAt: addMinutes(startsAt, duration),
        customerName: `Demo Player ${created + 1}`,
        customerEmail: `demo${created + 1}@example.com`,
        customerPhone: '+381 60 000 0000',
        price,
      },
    });
    created++;
  }
  console.log(`- Demo bookings: created ${created}`);

  // One fully booked padel day, so the calendar shows what a full day looks like.
  const tournamentDay = dayPlus(12);
  const padelCourts = courts.filter((c) => c.sport === 'PADEL');
  await prisma.block.createMany({
    data: padelCourts.map((c) => ({
      courtId: c.id,
      startsAt: localToUtc(tournamentDay, 0, tz),
      endsAt: localToUtc(tournamentDay, 24 * 60, tz),
      reason: 'Club tournament',
    })),
  });
  console.log(`- Demo block: padel tournament on ${tournamentDay}`);
}

/** Deletes all data so the demo starts fresh. Only runs with an explicit --reset flag. */
async function resetAll() {
  await prisma.$transaction([
    prisma.booking.deleteMany(),
    prisma.block.deleteMany(),
    prisma.court.deleteMany(),
    prisma.priceRule.deleteMany(),
    prisma.openingHours.deleteMany(),
    prisma.adminUser.deleteMany(),
  ]);
  console.log('- Reset: all data deleted');
}

async function main() {
  console.log('Seeding database...');
  if (process.argv.includes('--reset')) await resetAll();
  await ensureVenueDefaults(prisma);
  console.log('- Opening hours and prices: ensured');
  await seedCourts();
  await seedAdmin();
  if (process.argv.includes('--demo')) await seedDemoBookings();
  console.log('Done.');
}

try {
  await main();
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
