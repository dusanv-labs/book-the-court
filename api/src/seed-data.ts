import type { PrismaClient } from './generated/prisma/client.js';
import type { PriceRuleLike } from './bookings/domain/pricing.js';

const H = 60;

export const DEFAULT_COURTS = [
  { name: 'Padel 1', sport: 'PADEL', indoor: true, sortOrder: 1 },
  { name: 'Padel 2', sport: 'PADEL', indoor: true, sortOrder: 2 },
  { name: 'Padel 3', sport: 'PADEL', indoor: false, sortOrder: 3 },
  { name: 'Tennis 1', sport: 'TENNIS', indoor: false, sortOrder: 4 },
  { name: 'Tennis 2', sport: 'TENNIS', indoor: true, sortOrder: 5 },
  { name: 'Football 1', sport: 'FOOTBALL', indoor: false, sortOrder: 6 },
] as const;

/** Weekdays 08:00-23:00, weekends 09:00-22:00. */
export const DEFAULT_HOURS = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) =>
  dayOfWeek === 0 || dayOfWeek === 6
    ? { dayOfWeek, openMinute: 9 * H, closeMinute: 22 * H, closed: false }
    : { dayOfWeek, openMinute: 8 * H, closeMinute: 23 * H, closed: false },
);

/** Prices in RSD per hour: weekday daytime / weekday evening (from 17:00) / weekend. */
export const DEFAULT_PRICE_RULES: PriceRuleLike[] = (
  [
    ['PADEL', 2400, 3200, 3000],
    ['TENNIS', 1500, 2000, 1800],
    ['FOOTBALL', 4000, 5500, 5000],
  ] as const
).flatMap(([sport, day, evening, weekend]) => [
  { sport, dayType: 'WEEKDAY', startMinute: 0, endMinute: 17 * H, pricePerHour: day },
  { sport, dayType: 'WEEKDAY', startMinute: 17 * H, endMinute: 24 * H, pricePerHour: evening },
  { sport, dayType: 'WEEKEND', startMinute: 0, endMinute: 24 * H, pricePerHour: weekend },
]);

/** Creates default opening hours and prices if none exist. Never overwrites admin changes. */
export async function ensureVenueDefaults(prisma: PrismaClient): Promise<void> {
  if ((await prisma.openingHours.count()) === 0) {
    await prisma.openingHours.createMany({ data: DEFAULT_HOURS });
  }
  if ((await prisma.priceRule.count()) === 0) {
    await prisma.priceRule.createMany({ data: DEFAULT_PRICE_RULES });
  }
}
