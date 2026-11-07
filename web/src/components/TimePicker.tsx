import { useState } from 'react';
import { useI18n } from '../i18n/context';
import { startOptions, type Part } from '../lib/start-options';
import { formatPrice, formatTime } from '../lib/time';
import type { Availability, AvailabilityCourt } from '../lib/types';
import { Button } from './ui';

/**
 * Step "start time": a list of start times grouped by part of day. Selecting a time shows the
 * courts that are free for the whole duration, each with a Book button.
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
  const [selected, setSelected] = useState<string | null>(null);
  const options = startOptions(data, duration);
  const parts: [Part, string][] = [
    ['morning', m.booking.partMorning],
    ['afternoon', m.booking.partAfternoon],
    ['evening', m.booking.partEvening],
  ];

  return (
    <div className="space-y-5">
      {parts.map(([part, label]) => {
        const list = options.filter((o) => o.part === part);
        if (list.length === 0) return null;
        return (
          <section key={part}>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</h4>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {list.map((o) => {
                const open = selected === o.startsAt;
                const end = formatTime(o.endsAt, data.timezone);
                return (
                  <li key={o.startsAt}>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setSelected(open ? null : o.startsAt)}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${open ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}
                    >
                      <span className="w-28 shrink-0 text-base font-bold tabular-nums">
                        {o.time} <span className="font-normal text-slate-400">– {end}</span>
                      </span>
                      <span className="flex-1 text-sm text-emerald-700">{m.booking.courtsFree(o.courts.length)}</span>
                      {o.price !== null && (
                        <span className="hidden text-sm font-semibold text-slate-700 sm:inline">{formatPrice(o.price, data.currency)}</span>
                      )}
                      <span className={`text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">
                        ›
                      </span>
                    </button>
                    {open && (
                      <div className="space-y-2 bg-emerald-50/60 px-4 pb-4 pt-1">
                        <p className="text-xs font-medium text-slate-500">{m.booking.freeCourts(o.time, end)}</p>
                        {o.courts.map((court) => (
                          <div key={court.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <div>
                              <p className="font-semibold">{court.name}</p>
                              <p className="text-xs text-slate-500">
                                {court.indoor ? m.common.indoor : m.common.outdoor}
                                {o.price !== null && ` · ${formatPrice(o.price, data.currency)}`}
                              </p>
                            </div>
                            <Button onClick={() => onBook(court, o.index)} aria-label={m.booking.bookAt(court.name, o.time)}>
                              {m.booking.book}
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
