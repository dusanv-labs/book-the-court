import { useI18n } from '../i18n/context';
import { addMonths } from '../lib/time';
import type { DayStatus } from '../lib/types';

const cellStyle: Record<DayStatus, string> = {
  available: 'bg-emerald-50 text-emerald-900 border-emerald-200 hover:border-emerald-500',
  limited: 'bg-amber-50 text-amber-900 border-amber-300 hover:border-amber-500',
  full: 'bg-red-100 text-red-800 border-red-300 cursor-not-allowed',
  closed: 'bg-slate-100 text-slate-400 border-transparent cursor-not-allowed',
  past: 'bg-transparent text-slate-300 border-transparent cursor-not-allowed',
  unavailable: 'bg-transparent text-slate-300 border-transparent cursor-not-allowed',
};
const selectable: DayStatus[] = ['available', 'limited'];

const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** Month grid (Monday first). Days are coloured by availability; fully booked days are red. */
export function MonthCalendar({
  month,
  onMonthChange,
  minMonth,
  maxMonth,
  statuses,
  value,
  onChange,
  loading,
}: {
  month: string; // YYYY-MM
  onMonthChange: (month: string) => void;
  minMonth: string;
  maxMonth: string;
  statuses: Record<string, DayStatus>;
  value: string;
  onChange: (date: string) => void;
  loading: boolean;
}) {
  const { m } = useI18n();
  const [y, mo] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const leading = (first.getUTCDay() + 6) % 7; // Monday = 0
  const title = new Intl.DateTimeFormat(m.locale, { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(first);
  // 2026-11-02 was a Monday: use it to get localized short weekday names.
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(m.locale, { timeZone: 'UTC', weekday: 'short' }).format(new Date(Date.UTC(2026, 10, 2 + i))),
  );
  const legend: DayStatus[] = ['available', 'limited', 'full', 'closed'];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onMonthChange(addMonths(month, -1))}
          disabled={month <= minMonth}
          aria-label={m.booking.prevMonth}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:invisible"
        >
          ‹
        </button>
        <p className="font-semibold capitalize" aria-live="polite">
          {title}
        </p>
        <button
          type="button"
          onClick={() => onMonthChange(addMonths(month, 1))}
          disabled={month >= maxMonth}
          aria-label={m.booking.nextMonth}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:invisible"
        >
          ›
        </button>
      </div>

      <div className={`grid grid-cols-7 gap-1 sm:gap-1.5 ${loading ? 'opacity-50' : ''}`} role="grid" aria-label={title}>
        {weekdays.map((w) => (
          <div key={w} className="pb-1 text-center text-xs font-medium capitalize text-slate-500">
            {w.replace('.', '')}
          </div>
        ))}
        {Array.from({ length: leading }, (_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const date = dateKey(y, mo - 1, day);
          const status = statuses[date] ?? 'unavailable';
          const isSelected = date === value;
          const canPick = selectable.includes(status);
          return (
            <button
              key={date}
              type="button"
              disabled={!canPick}
              aria-pressed={isSelected}
              aria-label={`${day}. ${title}: ${m.booking.status[status]}`}
              title={m.booking.status[status]}
              onClick={() => onChange(date)}
              className={`aspect-square rounded-lg border text-sm font-semibold transition-colors sm:text-base ${
                isSelected ? 'border-emerald-700 bg-emerald-600 text-white shadow' : cellStyle[status]
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {legend.map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className={`inline-block h-3 w-3 rounded border ${cellStyle[s]}`} aria-hidden="true" />
            {m.booking.status[s]}
          </li>
        ))}
      </ul>
    </div>
  );
}
