import { addMinutes, isWeekend, toLocalParts } from '../../common/time.js';
import { SLOT_MINUTES } from './slots.js';

export type SportCode = 'PADEL' | 'TENNIS' | 'FOOTBALL';
export type DayTypeCode = 'WEEKDAY' | 'WEEKEND';

export interface PriceRuleLike {
  sport: SportCode;
  dayType: DayTypeCode;
  startMinute: number;
  endMinute: number;
  pricePerHour: number;
}

export class MissingPriceRuleError extends Error {
  constructor(sport: SportCode, dayType: DayTypeCode, minute: number) {
    super(`No price rule for ${sport} on ${dayType} at minute ${minute}`);
  }
}

/**
 * Total price of a booking. Each 30-minute part is charged by the rule that covers it,
 * so a booking that starts in the afternoon and runs into the evening mixes both rates.
 */
export function quotePrice(params: {
  sport: SportCode;
  startsAt: Date;
  durationMinutes: number;
  rules: PriceRuleLike[];
  tz: string;
}): number {
  let total = 0;
  for (let offset = 0; offset < params.durationMinutes; offset += SLOT_MINUTES) {
    const local = toLocalParts(addMinutes(params.startsAt, offset), params.tz);
    const dayType: DayTypeCode = isWeekend(local.dayOfWeek) ? 'WEEKEND' : 'WEEKDAY';
    const rule = params.rules.find(
      (r) =>
        r.sport === params.sport &&
        r.dayType === dayType &&
        r.startMinute <= local.minute &&
        local.minute < r.endMinute,
    );
    if (!rule) throw new MissingPriceRuleError(params.sport, dayType, local.minute);
    total += (rule.pricePerHour * SLOT_MINUTES) / 60;
  }
  return Math.round(total);
}
