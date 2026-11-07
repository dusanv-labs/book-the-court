import { buildDaySlots, checkBookingRequest, countBookableStarts, courtDaySlots, dayStatus, type DayHours } from './slots.js';

const TZ = 'Europe/Belgrade';
const HOURS: DayHours = { openMinute: 8 * 60, closeMinute: 23 * 60, closed: false }; // 08:00-23:00
const allDays = () => HOURS;
const iso = (s: string) => new Date(s);

describe('buildDaySlots', () => {
  it('creates 30-minute slots within opening hours (winter time, UTC+1)', () => {
    const slots = buildDaySlots('2026-11-09', HOURS, TZ);
    expect(slots).toHaveLength(30);
    expect(slots[0].startsAt.toISOString()).toBe('2026-11-09T07:00:00.000Z');
    expect(slots.at(-1)!.endsAt.toISOString()).toBe('2026-11-09T22:00:00.000Z');
  });

  it('handles the daylight saving time change correctly', () => {
    // Clocks move forward on 2026-03-29: 08:00 local is 07:00Z the day before and 06:00Z that day.
    expect(buildDaySlots('2026-03-28', HOURS, TZ)[0].startsAt.toISOString()).toBe('2026-03-28T07:00:00.000Z');
    expect(buildDaySlots('2026-03-29', HOURS, TZ)[0].startsAt.toISOString()).toBe('2026-03-29T06:00:00.000Z');
  });

  it('returns no slots when the venue is closed', () => {
    expect(buildDaySlots('2026-11-09', { ...HOURS, closed: true }, TZ)).toEqual([]);
    expect(buildDaySlots('2026-11-09', null, TZ)).toEqual([]);
  });
});

describe('courtDaySlots', () => {
  it('marks past, booked, blocked and free slots', () => {
    const slots = courtDaySlots({
      date: '2026-11-09',
      hours: HOURS,
      bookings: [{ startsAt: iso('2026-11-09T10:00:00Z'), endsAt: iso('2026-11-09T11:30:00Z') }],
      blocks: [{ startsAt: iso('2026-11-09T17:00:00Z'), endsAt: iso('2026-11-09T18:00:00Z') }],
      now: iso('2026-11-09T09:15:00Z'), // 10:15 local
      tz: TZ,
    });
    const statusAt = (utc: string) => slots.find((s) => s.startsAt.toISOString() === utc)?.status;
    expect(statusAt('2026-11-09T09:00:00.000Z')).toBe('past');
    expect(statusAt('2026-11-09T09:30:00.000Z')).toBe('free');
    expect(statusAt('2026-11-09T10:00:00.000Z')).toBe('booked');
    expect(statusAt('2026-11-09T11:00:00.000Z')).toBe('booked');
    expect(statusAt('2026-11-09T11:30:00.000Z')).toBe('free');
    expect(statusAt('2026-11-09T17:30:00.000Z')).toBe('blocked');
    expect(statusAt('2026-11-09T18:00:00.000Z')).toBe('free');
  });
});

describe('countBookableStarts and dayStatus', () => {
  const day = (statuses: string) =>
    courtDaySlots({ date: '2026-11-09', hours: { openMinute: 600, closeMinute: 600 + statuses.length * 30, closed: false }, bookings: [], blocks: [], now: iso('2026-11-01T00:00:00Z'), tz: TZ }).map(
      (s, i) => ({ ...s, status: ({ f: 'free', b: 'booked', x: 'blocked', p: 'past' } as const)[statuses[i] as 'f' | 'b' | 'x' | 'p'] }),
    );

  it('counts start times with room for at least 60 minutes', () => {
    expect(countBookableStarts(day('ffff'))).toBe(3);
    expect(countBookableStarts(day('ffbff'))).toBe(2);
    expect(countBookableStarts(day('fbfbf'))).toBe(0);
    expect(countBookableStarts(day('ffff'), 120)).toBe(1);
  });

  it('classifies days for the calendar', () => {
    expect(dayStatus({ open: false, freeStarts: 0, remainingStarts: 0 })).toBe('closed');
    expect(dayStatus({ open: true, freeStarts: 0, remainingStarts: 0 })).toBe('past');
    expect(dayStatus({ open: true, freeStarts: 0, remainingStarts: 20 })).toBe('full');
    expect(dayStatus({ open: true, freeStarts: 4, remainingStarts: 20 })).toBe('limited');
    expect(dayStatus({ open: true, freeStarts: 15, remainingStarts: 20 })).toBe('available');
  });
});

describe('checkBookingRequest', () => {
  const now = iso('2026-11-09T08:00:00Z');
  const base = { hoursForDay: allDays, bookings: [], blocks: [], now, tz: TZ };

  it('accepts a valid booking and returns its end time', () => {
    const result = checkBookingRequest({ ...base, startsAt: iso('2026-11-10T09:00:00Z'), durationMinutes: 90 });
    expect(result).toEqual({ ok: true, endsAt: iso('2026-11-10T10:30:00Z') });
  });

  it.each([
    ['INVALID_DURATION', '2026-11-10T09:00:00Z', 45],
    ['NOT_ALIGNED', '2026-11-10T09:15:00Z', 60],
    ['OUTSIDE_HOURS', '2026-11-10T06:30:00Z', 60], // 07:30 local, before opening
    ['OUTSIDE_HOURS', '2026-11-10T20:30:00Z', 120], // 21:30-23:30 local, past closing
    ['IN_PAST', '2026-11-09T07:00:00Z', 60],
    ['TOO_FAR', '2027-03-01T09:00:00Z', 60],
  ])('rejects with %s', (reason, start, duration) => {
    expect(checkBookingRequest({ ...base, startsAt: iso(start), durationMinutes: duration })).toEqual({
      ok: false,
      reason,
    });
  });

  it('rejects when the venue is closed that day', () => {
    const result = checkBookingRequest({
      ...base,
      hoursForDay: () => ({ ...HOURS, closed: true }),
      startsAt: iso('2026-11-10T09:00:00Z'),
      durationMinutes: 60,
    });
    expect(result).toEqual({ ok: false, reason: 'CLOSED' });
  });

  it('rejects overlapping bookings but allows back-to-back ones', () => {
    const bookings = [{ startsAt: iso('2026-11-10T10:00:00Z'), endsAt: iso('2026-11-10T11:00:00Z') }];
    expect(
      checkBookingRequest({ ...base, bookings, startsAt: iso('2026-11-10T09:30:00Z'), durationMinutes: 60 }),
    ).toEqual({ ok: false, reason: 'CONFLICT' });
    expect(
      checkBookingRequest({ ...base, bookings, startsAt: iso('2026-11-10T11:00:00Z'), durationMinutes: 60 }).ok,
    ).toBe(true);
    expect(
      checkBookingRequest({ ...base, bookings, startsAt: iso('2026-11-10T09:00:00Z'), durationMinutes: 60 }).ok,
    ).toBe(true);
  });

  it('rejects bookings over blocked time', () => {
    const blocks = [{ startsAt: iso('2026-11-10T12:00:00Z'), endsAt: iso('2026-11-10T14:00:00Z') }];
    expect(
      checkBookingRequest({ ...base, blocks, startsAt: iso('2026-11-10T13:00:00Z'), durationMinutes: 60 }),
    ).toEqual({ ok: false, reason: 'BLOCKED' });
  });
});
