import { useEffect, useRef } from 'react';
import { formatTime } from '../lib/time';
import type { Availability, AvailabilityCourt, SlotStatus } from '../lib/types';

const cellStyle: Record<SlotStatus, string> = {
  free: 'bg-emerald-50 border-emerald-200 hover:bg-emerald-500 hover:border-emerald-500 cursor-pointer',
  booked: 'bg-slate-300 border-slate-300 cursor-not-allowed',
  blocked: 'bg-amber-100 border-amber-200 cursor-not-allowed bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(217,119,6,.18)_4px,rgba(217,119,6,.18)_8px)]',
  past: 'bg-slate-100 border-slate-100 cursor-not-allowed',
};

const statusText: Record<SlotStatus, string> = {
  free: 'free',
  booked: 'booked',
  blocked: 'not available',
  past: 'in the past',
};

export function Legend() {
  const items: [SlotStatus, string][] = [
    ['free', 'Free'],
    ['booked', 'Booked'],
    ['blocked', 'Not available'],
    ['past', 'Past'],
  ];
  return (
    <ul className="flex flex-wrap gap-4 text-xs text-slate-600">
      {items.map(([s, label]) => (
        <li key={s} className="flex items-center gap-1.5">
          <span className={`inline-block h-3.5 w-3.5 rounded border ${cellStyle[s]}`} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  );
}

/** Courts × 30-minute slots. Click a free slot to start a booking. */
export function AvailabilityGrid({
  data,
  onSelect,
}: {
  data: Availability;
  onSelect: (court: AvailabilityCourt, slotIndex: number) => void;
}) {
  const reference = data.courts[0]?.slots ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);

  // On narrow screens, scroll to the first slot that is not in the past, so free times are visible.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const slots = data.courts[0]?.slots ?? [];
    const first = slots.findIndex((_, i) => data.courts.some((c) => c.slots[i]?.status !== 'past'));
    const headers = box.querySelectorAll<HTMLElement>('thead th');
    const target = headers[first + 1];
    box.scrollLeft = first > 0 && target ? target.offsetLeft - headers[0].offsetWidth - 8 : 0;
  }, [data]);

  return (
    <div ref={scrollRef} className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <caption className="sr-only">Court availability on {data.date}</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 min-w-28 border-b border-slate-200 bg-white px-3 py-2 text-left font-semibold">
              Court
            </th>
            {reference.map((slot, i) => (
              <th
                key={slot.startsAt}
                scope="col"
                className="border-b border-slate-200 px-0 py-2 text-left text-xs font-medium text-slate-500"
              >
                {i % 2 === 0 ? <span className="-ml-2 block w-0 whitespace-nowrap">{formatTime(slot.startsAt, data.timezone)}</span> : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.courts.map((court) => (
            <tr key={court.id}>
              <th scope="row" className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-2 text-left">
                <span className="block font-semibold text-slate-900">{court.name}</span>
                <span className="block text-xs font-normal text-slate-500">{court.indoor ? 'Indoor' : 'Outdoor'}</span>
              </th>
              {court.slots.map((slot, i) => {
                const time = formatTime(slot.startsAt, data.timezone);
                return (
                  <td key={slot.startsAt} className="border-b border-slate-100 p-0.5">
                    <button
                      type="button"
                      disabled={slot.status !== 'free'}
                      onClick={() => onSelect(court, i)}
                      aria-label={`${court.name}, ${time}, ${statusText[slot.status]}`}
                      title={`${court.name} · ${time} · ${statusText[slot.status]}`}
                      className={`block h-10 w-7 min-w-7 rounded border transition-colors focus-visible:outline-2 focus-visible:outline-emerald-700 ${cellStyle[slot.status]}`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
