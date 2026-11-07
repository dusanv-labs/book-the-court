import { describe, expect, it } from 'vitest';
import { addDays, formatPrice, formatTime, localToIso, minuteLabel, possibleDurations, todayIn } from './time';
import type { Slot } from './types';

const slot = (start: string, end: string, status: Slot['status'] = 'free'): Slot => ({
  startsAt: start,
  endsAt: end,
  status,
});

describe('time helpers', () => {
  it('computes today in the venue time zone, not the browser one', () => {
    // 23:30 UTC on 7 Nov is already 8 Nov in Belgrade (UTC+1).
    expect(todayIn('Europe/Belgrade', new Date('2026-11-07T23:30:00Z'))).toBe('2026-11-08');
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  });

  it('formats times and prices', () => {
    expect(formatTime('2026-11-12T17:30:00Z', 'Europe/Belgrade')).toBe('18:30');
    expect(minuteLabel(17 * 60 + 30)).toBe('17:30');
    expect(formatPrice(4800)).toMatch(/^4\.800 RSD$/);
  });

  it('converts local time to UTC across daylight saving time', () => {
    expect(localToIso('2026-03-28', 8 * 60)).toBe('2026-03-28T07:00:00.000Z');
    expect(localToIso('2026-03-29', 8 * 60)).toBe('2026-03-29T06:00:00.000Z');
  });
});

describe('possibleDurations', () => {
  const slots = [
    slot('2026-11-12T16:00:00Z', '2026-11-12T16:30:00Z'),
    slot('2026-11-12T16:30:00Z', '2026-11-12T17:00:00Z'),
    slot('2026-11-12T17:00:00Z', '2026-11-12T17:30:00Z'),
    slot('2026-11-12T17:30:00Z', '2026-11-12T18:00:00Z', 'booked'),
  ];

  it('offers only durations whose slots are all free', () => {
    expect(possibleDurations(slots, 0, [60, 90, 120])).toEqual([60, 90]);
    expect(possibleDurations(slots, 1, [60, 90, 120])).toEqual([60]);
    expect(possibleDurations(slots, 2, [60, 90, 120])).toEqual([]);
  });
});
