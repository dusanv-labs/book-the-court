import { dayOfWeekOf, toLocalParts } from '../../common/time.js';
import type { DayHours } from '../../bookings/domain/slots.js';

export type GroupBy = 'day' | 'week' | 'month' | 'court' | 'sport';
export const GROUP_BY: GroupBy[] = ['day', 'week', 'month', 'court', 'sport'];
const SPORT_ORDER = ['PADEL', 'TENNIS', 'FOOTBALL'];

export interface ReportBooking {
  courtId: string;
  startsAt: Date;
  endsAt: Date;
  price: number;
  status: 'CONFIRMED' | 'CANCELLED';
}

export interface ReportCourt {
  id: string;
  name: string;
  sport: string;
  active: boolean;
}

export interface RevenueFigures {
  bookings: number;
  realized: number;
  estimated: number;
  total: number;
  cancelledCount: number;
  cancelledAmount: number;
  bookedMinutes: number;
  availableMinutes: number;
  /** Booked share of opening hours, in percent with one decimal; null when nothing was open. */
  occupancyPct: number | null;
}

export interface RevenueRow extends RevenueFigures {
  key: string;
  /** Court name for court grouping; otherwise equal to key (dates and sport codes are formatted by the client). */
  label: string;
}

const empty = (): RevenueFigures => ({
  bookings: 0,
  realized: 0,
  estimated: 0,
  total: 0,
  cancelledCount: 0,
  cancelledAmount: 0,
  bookedMinutes: 0,
  availableMinutes: 0,
  occupancyPct: null,
});

/** All dates from..to inclusive (YYYY-MM-DD). */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Monday of the week that contains `date`. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** The period of the same length that ends the day before `from`. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const days = datesBetween(from, to).length;
  const end = new Date(`${from}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

/**
 * Revenue report. A booking belongs to the local date it starts on.
 * Realized = confirmed bookings that have already ended; estimated = confirmed bookings still to come.
 * Occupancy compares booked minutes with the opening hours of active courts.
 */
export function buildRevenueReport(params: {
  from: string;
  to: string;
  groupBy: GroupBy;
  courts: ReportCourt[];
  bookings: ReportBooking[];
  hoursFor: (dayOfWeek: number) => DayHours | null;
  now: Date;
  tz: string;
}): { rows: RevenueRow[]; totals: RevenueFigures } {
  const { from, to, groupBy, courts, tz } = params;
  const courtById = new Map(courts.map((c) => [c.id, c]));
  const dates = datesBetween(from, to);

  const timeKey = (date: string) => (groupBy === 'week' ? weekStart(date) : groupBy === 'month' ? date.slice(0, 7) : date);
  const keyFor = (date: string, court: ReportCourt): string =>
    groupBy === 'court' ? court.id : groupBy === 'sport' ? court.sport : timeKey(date);

  // Every period / court / sport appears, even with no bookings.
  const rows = new Map<string, RevenueFigures>();
  const ensure = (key: string) => {
    if (!rows.has(key)) rows.set(key, empty());
    return rows.get(key)!;
  };
  if (groupBy === 'court') courts.forEach((c) => ensure(c.id));
  else if (groupBy === 'sport') SPORT_ORDER.filter((s) => courts.some((c) => c.sport === s)).forEach(ensure);
  else dates.forEach((d) => ensure(timeKey(d)));

  // Opening hours available for booking.
  for (const date of dates) {
    const hours = params.hoursFor(dayOfWeekOf(date, tz));
    if (!hours || hours.closed) continue;
    for (const court of courts) {
      if (court.active) ensure(keyFor(date, court)).availableMinutes += hours.closeMinute - hours.openMinute;
    }
  }

  for (const b of params.bookings) {
    const court = courtById.get(b.courtId);
    if (!court) continue;
    const date = toLocalParts(b.startsAt, tz).date;
    if (date < from || date > to) continue;
    const row = ensure(keyFor(date, court));
    if (b.status === 'CANCELLED') {
      row.cancelledCount++;
      row.cancelledAmount += b.price;
      continue;
    }
    row.bookings++;
    row.bookedMinutes += Math.round((b.endsAt.getTime() - b.startsAt.getTime()) / 60_000);
    if (b.endsAt <= params.now) row.realized += b.price;
    else row.estimated += b.price;
  }

  const finish = (f: RevenueFigures): RevenueFigures => ({
    ...f,
    total: f.realized + f.estimated,
    occupancyPct: f.availableMinutes > 0 ? Math.round((f.bookedMinutes / f.availableMinutes) * 1000) / 10 : null,
  });

  const totals = finish(
    [...rows.values()].reduce((acc, r) => {
      (Object.keys(acc) as (keyof RevenueFigures)[]).forEach((k) => {
        if (k !== 'occupancyPct' && k !== 'total') acc[k] += r[k] as number;
      });
      return acc;
    }, empty()),
  );

  const sorted = [...rows.entries()].sort(([a], [b]) => {
    if (groupBy === 'court') return courts.findIndex((c) => c.id === a) - courts.findIndex((c) => c.id === b);
    if (groupBy === 'sport') return SPORT_ORDER.indexOf(a) - SPORT_ORDER.indexOf(b);
    return a.localeCompare(b);
  });

  return {
    rows: sorted.map(([key, f]) => ({ key, label: groupBy === 'court' ? (courtById.get(key)?.name ?? key) : key, ...finish(f) })),
    totals,
  };
}

/** Percentage change, one decimal; null when there is nothing to compare with. */
export function changePct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
