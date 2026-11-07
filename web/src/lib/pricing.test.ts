import { describe, expect, it } from 'vitest';
import { buildIcs } from './calendar';
import { lowestHourly, previewPrice } from './pricing';
import type { PriceBand } from './types';

const PRICES: PriceBand[] = [
  { dayType: 'WEEKDAY', startMinute: 0, endMinute: 17 * 60, pricePerHour: 2400 },
  { dayType: 'WEEKDAY', startMinute: 17 * 60, endMinute: 24 * 60, pricePerHour: 3200 },
  { dayType: 'WEEKEND', startMinute: 0, endMinute: 24 * 60, pricePerHour: 3000 },
];
const TZ = 'Europe/Belgrade';

describe('previewPrice', () => {
  it('matches the API rules, including mixed day/evening rates', () => {
    expect(previewPrice('2026-11-09T09:00:00Z', 60, PRICES, TZ)).toBe(2400); // Mon 10:00
    expect(previewPrice('2026-11-09T15:30:00Z', 90, PRICES, TZ)).toBe(1200 + 3200); // Mon 16:30
    expect(previewPrice('2026-11-14T09:00:00Z', 120, PRICES, TZ)).toBe(6000); // Sat
  });

  it('returns null when a part of the booking has no price', () => {
    expect(previewPrice('2026-11-09T09:00:00Z', 60, PRICES.slice(2), TZ)).toBeNull();
  });

  it('finds the lowest hourly price', () => {
    expect(lowestHourly(PRICES)).toBe(2400);
    expect(lowestHourly([])).toBeNull();
  });
});

describe('buildIcs', () => {
  it('creates a valid calendar event in UTC with escaped text', () => {
    const ics = buildIcs({
      uid: 'ABC123',
      title: 'Padel 1, BookTheCourt',
      description: 'Code: ABC123',
      startsAt: '2026-11-12T17:00:00.000Z',
      endsAt: '2026-11-12T18:30:00.000Z',
    });
    expect(ics).toContain('DTSTART:20261112T170000Z');
    expect(ics).toContain('DTEND:20261112T183000Z');
    expect(ics).toContain('SUMMARY:Padel 1\\, BookTheCourt');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  });
});
