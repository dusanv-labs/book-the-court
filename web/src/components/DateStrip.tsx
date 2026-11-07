import { useI18n } from '../i18n/context';
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
  const { m } = useI18n();
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2" role="radiogroup" aria-label={m.booking.stepDay}>
      <div className="flex gap-2">
        {dates.map((date, i) => {
          const p = dateParts(date, m.locale);
          const selected = date === value;
          const label = i === 0 ? m.common.today : i === 1 ? m.common.tomorrow : p.weekday;
          return (
            <button
              key={date}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(date)}
              className={`flex w-[4.5rem] shrink-0 flex-col items-center rounded-xl border px-2 py-2 text-center transition-colors ${
                selected
                  ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-400'
              }`}
            >
              <span className={`truncate text-xs font-medium capitalize ${selected ? 'text-emerald-100' : 'text-slate-500'}`}>{label}</span>
              <span className="text-lg font-bold leading-tight">{p.day}</span>
              <span className={`text-xs capitalize ${selected ? 'text-emerald-100' : 'text-slate-500'}`}>{p.month.replace('.', '')}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
