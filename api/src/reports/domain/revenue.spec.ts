import { buildRevenueReport, changePct, previousPeriod, weekStart, type ReportBooking, type ReportCourt } from './revenue.js';

const TZ = 'Europe/Belgrade';
const courts: ReportCourt[] = [
  { id: 'p1', name: 'Padel 1', sport: 'PADEL', active: true },
  { id: 't1', name: 'Tennis 1', sport: 'TENNIS', active: true },
];
const open8to22 = () => ({ openMinute: 8 * 60, closeMinute: 22 * 60, closed: false }); // 840 min/day
const booking = (courtId: string, start: string, minutes: number, price: number, status: ReportBooking['status'] = 'CONFIRMED'): ReportBooking => ({
  courtId,
  startsAt: new Date(start),
  endsAt: new Date(new Date(start).getTime() + minutes * 60_000),
  price,
  status,
});

const bookings = [
  booking('p1', '2026-11-09T17:00:00Z', 90, 4800), // Mon, past at "now"
  booking('t1', '2026-11-09T09:00:00Z', 60, 1500), // Mon, past
  booking('p1', '2026-11-11T17:00:00Z', 60, 3200), // Wed, future
  booking('p1', '2026-11-10T17:00:00Z', 60, 3200, 'CANCELLED'),
  booking('p1', '2026-11-20T17:00:00Z', 60, 9999), // outside the range
];
const now = new Date('2026-11-10T12:00:00Z');
const build = (groupBy: Parameters<typeof buildRevenueReport>[0]['groupBy'], list = courts) =>
  buildRevenueReport({ from: '2026-11-09', to: '2026-11-11', groupBy, courts: list, bookings, hoursFor: open8to22, now, tz: TZ });

describe('buildRevenueReport', () => {
  it('splits realized (already played) and estimated (upcoming) revenue', () => {
    const { totals } = build('day');
    expect(totals).toMatchObject({ bookings: 3, realized: 6300, estimated: 3200, total: 9500, cancelledCount: 1, cancelledAmount: 3200 });
  });

  it('computes occupancy against opening hours of active courts', () => {
    const { totals } = build('day');
    // booked 90 + 60 + 60 = 210 min of 3 days x 2 courts x 840 min
    expect(totals.availableMinutes).toBe(3 * 2 * 840);
    expect(totals.occupancyPct).toBe(Math.round((210 / 5040) * 1000) / 10);
  });

  it('lists every day of the range, including days without bookings', () => {
    const { rows } = build('day');
    expect(rows.map((r) => r.key)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
    expect(rows[1]).toMatchObject({ bookings: 0, total: 0, cancelledCount: 1 });
  });

  it('groups by court, sport, week and month', () => {
    expect(build('court').rows.map((r) => [r.label, r.total])).toEqual([
      ['Padel 1', 8000],
      ['Tennis 1', 1500],
    ]);
    expect(build('sport').rows.map((r) => [r.key, r.total])).toEqual([
      ['PADEL', 8000],
      ['TENNIS', 1500],
    ]);
    expect(build('week').rows.map((r) => r.key)).toEqual(['2026-11-09']);
    expect(build('month').rows.map((r) => [r.key, r.total])).toEqual([['2026-11', 9500]]);
  });

  it('respects a court filter (only the given courts are counted)', () => {
    const { totals } = build('day', [courts[1]]);
    expect(totals).toMatchObject({ bookings: 1, realized: 1500, estimated: 0 });
  });
});

describe('period helpers', () => {
  it('finds the Monday of a week and the previous period of equal length', () => {
    expect(weekStart('2026-11-12')).toBe('2026-11-09');
    expect(weekStart('2026-11-09')).toBe('2026-11-09');
    expect(previousPeriod('2026-11-01', '2026-11-30')).toEqual({ from: '2026-10-02', to: '2026-10-31' });
  });

  it('computes percentage change', () => {
    expect(changePct(120, 100)).toBe(20);
    expect(changePct(95, 100)).toBe(-5);
    expect(changePct(50, 0)).toBeNull();
  });
});
