import { addDays, dateParts } from '../lib/time';

/** Horizontal list of the next `days` dates. */
export function DateStrip({
  start,
  days = 14,
  value,
  onChange,
}: {
  start: string;
  days?: number;
  value: string;
  onChange: (date: string) => void;
}) {
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2" role="radiogroup" aria-label="Date">
      <div className="flex gap-2">
        {dates.map((date, i) => {
          const p = dateParts(date);
          const selected = date === value;
          return (
            <button
              key={date}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(date)}
              className={`flex w-16 shrink-0 flex-col items-center rounded-xl border px-2 py-2 text-center transition-colors ${
                selected
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-400'
              }`}
            >
              <span className={`text-xs font-medium ${selected ? 'text-emerald-100' : 'text-slate-500'}`}>
                {i === 0 ? 'Today' : p.weekday}
              </span>
              <span className="text-lg font-bold leading-tight">{p.day}</span>
              <span className={`text-xs ${selected ? 'text-emerald-100' : 'text-slate-500'}`}>{p.month}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
