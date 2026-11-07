import { TZDate } from '@date-fns/tz';

/** Default venue time zone. All opening hours and prices are defined in local time. */
export const DEFAULT_TIMEZONE = 'Europe/Belgrade';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d;
}

/** Converts a local calendar date + minute of day (0..1440) in `tz` to a UTC instant. */
export function localToUtc(date: string, minuteOfDay: number, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const local = new TZDate(y, m - 1, d, Math.floor(minuteOfDay / 60), minuteOfDay % 60, tz);
  return new Date(local.getTime());
}

/** Day of week (0 = Sunday ... 6 = Saturday) of a local calendar date. */
export function dayOfWeekOf(date: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new TZDate(y, m - 1, d, 12, 0, tz).getDay();
}

export interface LocalParts {
  date: string;
  minute: number;
  dayOfWeek: number;
  second: number;
  millisecond: number;
}

/** Local date, minute of day and weekday of a UTC instant in `tz`. */
export function toLocalParts(instant: Date, tz: string): LocalParts {
  const t = new TZDate(instant.getTime(), tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`,
    minute: t.getHours() * 60 + t.getMinutes(),
    dayOfWeek: t.getDay(),
    second: t.getSeconds(),
    millisecond: t.getMilliseconds(),
  };
}

export function isWeekend(dayOfWeek: number): boolean {
  return dayOfWeek === 0 || dayOfWeek === 6;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}
