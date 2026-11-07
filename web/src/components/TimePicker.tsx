import { useState } from 'react';
import { useI18n } from '../i18n/context';
import { allStartTimes } from '../lib/start-options';
import { formatPrice, formatTime } from '../lib/time';
import type { Availability, AvailabilityCourt } from '../lib/types';
import { Button } from './ui';

/**
 * Step "start time": a compact grid of full-hour start times (half hours on request).
 * Times with no free court for the whole duration are crossed out. Picking a time shows
 * the free courts below the grid, each with a Book button.
 */
export function TimePicker({
  data,
  duration,
  onBook,
}: {
  data: Availability;
  duration: number;
  onBook: (court: AvailabilityCourt, slotIndex: number) => void;
}) {
  const { m } = useI18n();
  const all = allStartTimes(data, duration);
  const fullHours = all.filter((o) => o.time.endsWith(':00'));
  const halfHours = all.filter((o) => o.time.endsWith(':30'));
  const freeHalf = halfHours.filter((o) => o.courts.length > 0).length;
  // If no full hour is free but some half hours are, show them right away.
  const [showHalf, setShowHalf] = useState(fullHours.every((o) => o.courts.length === 0) && freeHalf > 0);
  const [selected, setSelected] = useState<string | null>(null);

  const times = showHalf ? all : fullHours;
  const chosen = all.find((o) => o.startsAt === selected && o.courts.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">{m.booking.pickTimeHint}</p>
        {halfHours.length > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={showHalf} onChange={(e) => setShowHalf(e.target.checked)} />
            {m.booking.showHalfHours}
          </label>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-8" role="group" aria-label={m.booking.chooseTime}>
        {times.map((o) => {
          const free = o.courts.length > 0;
          const isSelected = selected === o.startsAt;
          return (
            <button
              key={o.startsAt}
              type="button"
              data-time={o.time}
              disabled={!free}
              aria-pressed={isSelected}
              aria-label={free ? `${o.time}, ${m.booking.courtsFree(o.courts.length)}` : `${o.time}, ${m.dialog.unavailable}`}
              onClick={() => setSelected(isSelected ? null : o.startsAt)}
              className={`rounded-lg border py-2.5 text-sm font-bold tabular-nums transition-colors ${
                isSelected
                  ? 'border-emerald-700 bg-emerald-600 text-white shadow'
                  : free
                    ? 'border-emerald-200 bg-white text-slate-900 hover:border-emerald-600 hover:bg-emerald-50'
                    : 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300 line-through'
              }`}
            >
              {o.time}
            </button>
          );
        })}
      </div>
      {!showHalf && freeHalf > 0 && (
        <button type="button" className="text-sm font-semibold text-emerald-700 hover:underline" onClick={() => setShowHalf(true)}>
          {m.booking.moreHalfHours(freeHalf)}
        </button>
      )}

      {chosen && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4" aria-live="polite">
          <p className="mb-3 font-semibold">
            {chosen.time} – {formatTime(chosen.endsAt, data.timezone)}
            {chosen.price !== null && <span className="font-normal text-slate-600"> · {formatPrice(chosen.price, data.currency)}</span>}
          </p>
          <div className="space-y-2">
            {chosen.courts.map((court) => (
              <div key={court.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                <div>
                  <p className="font-semibold">{court.name}</p>
                  <p className="text-xs text-slate-500">{court.indoor ? m.common.indoor : m.common.outdoor}</p>
                </div>
                <Button onClick={() => onBook(court, chosen.index)} aria-label={m.booking.bookAt(court.name, chosen.time)}>
                  {m.booking.book}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
