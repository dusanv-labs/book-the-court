import { addMinutes, localToUtc, toLocalParts } from '../../common/time.js';

export const SLOT_MINUTES = 30;
export const ALLOWED_DURATIONS = [60, 90, 120] as const;
export const MAX_DAYS_AHEAD = 60;

export interface Interval {
  startsAt: Date;
  endsAt: Date;
}

export interface DayHours {
  openMinute: number;
  closeMinute: number;
  closed: boolean;
}

export type SlotStatus = 'free' | 'booked' | 'blocked' | 'past';

export interface Slot extends Interval {
  status: SlotStatus;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/** All 30-minute slots of a local day within opening hours. */
export function buildDaySlots(date: string, hours: DayHours | null, tz: string): Interval[] {
  if (!hours || hours.closed) return [];
  const slots: Interval[] = [];
  for (let m = hours.openMinute; m + SLOT_MINUTES <= hours.closeMinute; m += SLOT_MINUTES) {
    slots.push({ startsAt: localToUtc(date, m, tz), endsAt: localToUtc(date, m + SLOT_MINUTES, tz) });
  }
  return slots;
}

/** Availability of one court for one local day. */
export function courtDaySlots(params: {
  date: string;
  hours: DayHours | null;
  bookings: Interval[];
  blocks: Interval[];
  now: Date;
  tz: string;
}): Slot[] {
  return buildDaySlots(params.date, params.hours, params.tz).map((slot) => {
    let status: SlotStatus = 'free';
    if (slot.startsAt < params.now) status = 'past';
    else if (params.bookings.some((b) => overlaps(slot, b))) status = 'booked';
    else if (params.blocks.some((b) => overlaps(slot, b))) status = 'blocked';
    return { ...slot, status };
  });
}

export type BookingRejection =
  | 'INVALID_DURATION'
  | 'NOT_ALIGNED'
  | 'CLOSED'
  | 'OUTSIDE_HOURS'
  | 'IN_PAST'
  | 'TOO_FAR'
  | 'CONFLICT'
  | 'BLOCKED';

export type BookingCheck = { ok: true; endsAt: Date } | { ok: false; reason: BookingRejection };

/** Validates a booking request against business rules. Pure: all data is passed in. */
export function checkBookingRequest(params: {
  startsAt: Date;
  durationMinutes: number;
  hoursForDay: (dayOfWeek: number) => DayHours | null;
  bookings: Interval[];
  blocks: Interval[];
  now: Date;
  tz: string;
  maxDaysAhead?: number;
}): BookingCheck {
  const { startsAt, durationMinutes, now, tz } = params;
  if (!(ALLOWED_DURATIONS as readonly number[]).includes(durationMinutes)) {
    return { ok: false, reason: 'INVALID_DURATION' };
  }
  const local = toLocalParts(startsAt, tz);
  if (local.minute % SLOT_MINUTES !== 0 || local.second !== 0 || local.millisecond !== 0) {
    return { ok: false, reason: 'NOT_ALIGNED' };
  }
  const hours = params.hoursForDay(local.dayOfWeek);
  if (!hours || hours.closed) return { ok: false, reason: 'CLOSED' };
  if (local.minute < hours.openMinute || local.minute + durationMinutes > hours.closeMinute) {
    return { ok: false, reason: 'OUTSIDE_HOURS' };
  }
  if (startsAt <= now) return { ok: false, reason: 'IN_PAST' };
  const maxDays = params.maxDaysAhead ?? MAX_DAYS_AHEAD;
  if (startsAt.getTime() > now.getTime() + maxDays * 24 * 60 * 60_000) {
    return { ok: false, reason: 'TOO_FAR' };
  }
  const endsAt = addMinutes(startsAt, durationMinutes);
  const requested = { startsAt, endsAt };
  if (params.bookings.some((b) => overlaps(requested, b))) return { ok: false, reason: 'CONFLICT' };
  if (params.blocks.some((b) => overlaps(requested, b))) return { ok: false, reason: 'BLOCKED' };
  return { ok: true, endsAt };
}

/** Number of start times where a booking of `minDuration` fits into consecutive free slots. */
export function countBookableStarts(slots: Slot[], minDuration: number = ALLOWED_DURATIONS[0]): number {
  const needed = minDuration / SLOT_MINUTES;
  let count = 0;
  let run = 0;
  for (let i = 0; i < slots.length; i++) {
    const contiguous = i > 0 && slots[i].startsAt.getTime() === slots[i - 1].endsAt.getTime();
    run = slots[i].status === 'free' ? (contiguous ? run + 1 : 1) : 0;
    if (run >= needed) count++;
  }
  return count;
}

/** Start times where a booking of `durationMinutes` fits into consecutive free slots. */
export function bookableStarts(slots: Slot[], durationMinutes: number): Date[] {
  const needed = durationMinutes / SLOT_MINUTES;
  const starts: Date[] = [];
  let run = 0;
  for (let i = 0; i < slots.length; i++) {
    const contiguous = i > 0 && slots[i].startsAt.getTime() === slots[i - 1].endsAt.getTime();
    run = slots[i].status === 'free' ? (contiguous ? run + 1 : 1) : 0;
    if (run >= needed) starts.push(slots[i - needed + 1].startsAt);
  }
  return starts;
}

export type DayStatus ='available' | 'limited' | 'full' | 'closed' | 'past' | 'unavailable';

/**
 * Summary status of one day for a calendar.
 * remainingStarts = start times not yet in the past (booked or not); freeStarts = of those, still bookable.
 * full = open but nothing left to book; limited = less than a quarter left.
 */
export function dayStatus(params: { open: boolean; freeStarts: number; remainingStarts: number }): DayStatus {
  if (!params.open) return 'closed';
  if (params.remainingStarts === 0) return 'past';
  if (params.freeStarts === 0) return 'full';
  if (params.freeStarts / params.remainingStarts < 0.25) return 'limited';
  return 'available';
}

export const REJECTION_MESSAGES: Record<BookingRejection, string> = {
  INVALID_DURATION: `Duration must be ${ALLOWED_DURATIONS.join(', ')} minutes.`,
  NOT_ALIGNED: 'Bookings must start on the hour or half hour.',
  CLOSED: 'The venue is closed on that day.',
  OUTSIDE_HOURS: 'The booking must be within opening hours.',
  IN_PAST: 'Cannot book a time in the past.',
  TOO_FAR: `Bookings can be made at most ${MAX_DAYS_AHEAD} days in advance.`,
  CONFLICT: 'This court is already booked at that time.',
  BLOCKED: 'This court is not available at that time.',
};
