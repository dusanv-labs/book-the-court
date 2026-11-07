import { MissingPriceRuleError, quotePrice, type PriceRuleLike } from './pricing.js';

const TZ = 'Europe/Belgrade';
const RULES: PriceRuleLike[] = [
  { sport: 'PADEL', dayType: 'WEEKDAY', startMinute: 0, endMinute: 17 * 60, pricePerHour: 2400 },
  { sport: 'PADEL', dayType: 'WEEKDAY', startMinute: 17 * 60, endMinute: 24 * 60, pricePerHour: 3200 },
  { sport: 'PADEL', dayType: 'WEEKEND', startMinute: 0, endMinute: 24 * 60, pricePerHour: 3200 },
];
const quote = (startsAt: string, durationMinutes: number, sport: PriceRuleLike['sport'] = 'PADEL') =>
  quotePrice({ sport, startsAt: new Date(startsAt), durationMinutes, rules: RULES, tz: TZ });

describe('quotePrice', () => {
  it('charges the daytime weekday rate', () => {
    expect(quote('2026-11-09T09:00:00Z', 60)).toBe(2400); // Monday 10:00-11:00 local
  });

  it('splits a booking that runs from daytime into the evening rate', () => {
    // Monday 16:30-18:00 local: 30 min at 2400/h + 60 min at 3200/h
    expect(quote('2026-11-09T15:30:00Z', 90)).toBe(1200 + 3200);
  });

  it('charges the weekend rate on Saturday', () => {
    expect(quote('2026-11-14T09:00:00Z', 120)).toBe(6400); // Saturday 10:00-12:00 local
  });

  it('uses local time across daylight saving time', () => {
    expect(quote('2026-03-29T06:00:00Z', 60)).toBe(3200); // Sunday 08:00 local (UTC+2)
    expect(quote('2026-03-30T14:30:00Z', 90)).toBe(1200 + 3200); // Monday 16:30 local (UTC+2)
  });

  it('throws when no rule covers the time', () => {
    expect(() => quote('2026-11-09T09:00:00Z', 60, 'TENNIS')).toThrow(MissingPriceRuleError);
  });
});
