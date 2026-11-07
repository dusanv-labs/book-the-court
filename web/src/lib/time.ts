import { TZDate } from '@date-fns/tz';
import type { Slot } from './types';

/** Venue time zone. The API also returns it with availability data. */
export const VENUE_TZ = 'Europe/Belgrade';

/** Today's date (YYYY-MM-DD) in the given time zone. */
export function todayIn(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Mon", "12" and "Nov" parts for a YYYY-MM-DD date. */
export function dateParts(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...o }).format(d);
  return { weekday: f({ weekday: 'short' }), day: f({ day: 'numeric' }), month: f({ month: 'short' }) };
}

export function formatDateLong(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

/** "18:30" for an ISO instant, in the venue time zone. */
export function formatTime(iso: string, tz: string = VENUE_TZ): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(iso),
  );
}

/** "Thursday, 12 November" for an ISO instant, in the venue time zone. */
export function formatDayOf(iso: string, tz: string = VENUE_TZ): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(iso),
  );
}

export function minuteLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** UTC ISO string for a local date + minute of day in `tz` (DST-safe). */
export function localToIso(date: string, minuteOfDay: number, tz: string = VENUE_TZ): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(new TZDate(y, m - 1, d, Math.floor(minuteOfDay / 60), minuteOfDay % 60, tz).getTime()).toISOString();
}

export function formatPrice(amount: number, currency = 'RSD'): string {
  return `${new Intl.NumberFormat('sr-Latn-RS').format(amount)} ${currency}`;
}

/** Durations that fit when starting at `index`: every 30-minute slot they cover must be free. */
export function possibleDurations(slots: Slot[], index: number, durations: number[], slotMinutes = 30): number[] {
  return durations.filter((d) => {
    const needed = d / slotMinutes;
    if (index + needed > slots.length) return false;
    for (let i = index; i < index + needed; i++) {
      if (slots[i].status !== 'free') return false;
      // Slots must be contiguous in time.
      if (i > index && slots[i].startsAt !== slots[i - 1].endsAt) return false;
    }
    return true;
  });
}

/** Options for time selects: every 30 minutes from `from` to `to` inclusive. */
export function halfHourOptions(from = 0, to = 24 * 60): number[] {
  const out: number[] = [];
  for (let m = from; m <= to; m += 30) out.push(m);
  return out;
}
