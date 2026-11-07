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

/**
 * Every upcoming start time of the day (past times left out). `courts` is empty when no court
 * is free for the whole duration, so the UI can show the time as unavailable.
 */
export function allStartTimes(data: Availability, duration: number): StartOption[] {
  const reference = data.courts[0]?.slots ?? [];
  return reference
    .map((slot, index) => {
      const time = formatTime(slot.startsAt, data.timezone);
      const hour = Number(time.slice(0, 2));
      const isPast = data.courts.every((c) => c.slots[index]?.status === 'past');
      return {
        index,
        startsAt: slot.startsAt,
        endsAt: new Date(new Date(slot.startsAt).getTime() + duration * 60_000).toISOString(),
        time,
        part: (hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening') as Part,
        courts: data.courts.filter((c) => possibleDurations(c.slots, index, [duration], data.slotMinutes).length > 0),
        price: previewPrice(slot.startsAt, duration, data.prices, data.timezone),
        isPast,
      };
    })
    .filter((o) => !o.isPast)
    .map(({ isPast: _past, ...o }) => o);
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
