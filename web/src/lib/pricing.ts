import { TZDate } from '@date-fns/tz';
import type { PriceBand } from './types';

/**
 * Client-side price preview, mirroring the API rule: each 30-minute part is charged by the
 * rule that covers its local start time. The API still calculates the final price.
 * Returns null when no rule covers part of the booking.
 */
export function previewPrice(startsAt: string, durationMinutes: number, prices: PriceBand[], tz: string): number | null {
  let total = 0;
  for (let offset = 0; offset < durationMinutes; offset += 30) {
    const t = new TZDate(new Date(startsAt).getTime() + offset * 60_000, tz);
    const dow = t.getDay();
    const minute = t.getHours() * 60 + t.getMinutes();
    const dayType = dow === 0 || dow === 6 ? 'WEEKEND' : 'WEEKDAY';
    const rule = prices.find((p) => p.dayType === dayType && p.startMinute <= minute && minute < p.endMinute);
    if (!rule) return null;
    total += rule.pricePerHour / 2;
  }
  return Math.round(total);
}

/** Lowest hourly price of a day type, for "from X / h" hints. */
export function lowestHourly(prices: PriceBand[]): number | null {
  return prices.length ? Math.min(...prices.map((p) => p.pricePerHour)) : null;
}
