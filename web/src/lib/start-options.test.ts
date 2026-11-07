import { describe, expect, it } from 'vitest';
import { startOptions } from './start-options';
import { addMonths, monthRange } from './time';
import type { Availability, Slot } from './types';

const slots = (statuses: string, startUtcHour: number): Slot[] =>
  [...statuses].map((s, i) => {
    const start = new Date(Date.UTC(2026, 10, 12, startUtcHour, i * 30));
    return {
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
      status: s === 'f' ? 'free' : 'booked',
    };
  });

const data = (a: string, b: string): Availability => ({
  date: '2026-11-12',
  sport: 'PADEL',
  timezone: 'Europe/Belgrade',
  slotMinutes: 30,
  durations: [60, 90, 120],
  currency: 'RSD',
  hours: { openMinute: 17 * 60, closeMinute: 20 * 60 },
  prices: [
    { dayType: 'WEEKDAY', startMinute: 0, endMinute: 17 * 60, pricePerHour: 2400 },
    { dayType: 'WEEKDAY', startMinute: 17 * 60, endMinute: 24 * 60, pricePerHour: 3200 },
  ],
  // 16:00 UTC = 17:00 in Belgrade (winter time)
  courts: [
    { id: 'a', name: 'Padel 1', indoor: true, slots: slots(a, 16) },
    { id: 'b', name: 'Padel 2', indoor: false, slots: slots(b, 16) },
  ],
});

describe('startOptions', () => {
  it('lists start times where at least one court fits the whole duration', () => {
    // Padel 1: 17:00-18:00 free, 18:00 booked, 18:30-20:00 free; Padel 2 fully booked except 19:00-20:00
    const options = startOptions(data('ffbfff', 'bbbbff'), 90);
    expect(options.map((o) => o.time)).toEqual(['18:30']);
    expect(options[0].courts.map((c) => c.name)).toEqual(['Padel 1']);
    expect(options[0].price).toBe(4800);
    expect(options[0].part).toBe('evening');
  });

  it('includes every court that is free at that time', () => {
    const options = startOptions(data('ffffff', 'bbbbff'), 60);
    const at19 = options.find((o) => o.time === '19:00');
    expect(at19?.courts.map((c) => c.name)).toEqual(['Padel 1', 'Padel 2']);
  });
});

describe('month helpers', () => {
  it('computes month ranges and moves across years', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
});
