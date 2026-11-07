import { previewPrice } from './pricing';
import { formatTime, possibleDurations } from './time';
import type { Availability, AvailabilityCourt } from './types';

export type Part = 'morning' | 'afternoon' | 'evening';

export interface StartOption {
  index: number;
  startsAt: string;
  endsAt: string;
  time: string;
  part: Part;
  courts: AvailabilityCourt[];
  price: number | null;
}

/** Start times where at least one court is free for the whole duration, with those courts. */
export function startOptions(data: Availability, duration: number): StartOption[] {
  const reference = data.courts[0]?.slots ?? [];
  return reference
    .map((slot, index) => {
      const courts = data.courts.filter((c) => possibleDurations(c.slots, index, [duration], data.slotMinutes).length > 0);
      const time = formatTime(slot.startsAt, data.timezone);
      const hour = Number(time.slice(0, 2));
      return {
        index,
        startsAt: slot.startsAt,
        endsAt: new Date(new Date(slot.startsAt).getTime() + duration * 60_000).toISOString(),
        time,
        part: (hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening') as Part,
        courts,
        price: previewPrice(slot.startsAt, duration, data.prices, data.timezone),
      };
    })
    .filter((o) => o.courts.length > 0);
}
