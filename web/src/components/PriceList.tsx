import { useI18n } from '../i18n/context';
import { formatPrice, minuteLabel } from '../lib/time';
import type { PriceBand } from '../lib/types';

export function PriceList({ prices, currency }: { prices: PriceBand[]; currency: string }) {
  const { m } = useI18n();
  if (prices.length === 0) return null;
  const groups: [string, PriceBand[]][] = [
    [m.booking.weekdays, prices.filter((p) => p.dayType === 'WEEKDAY')],
    [m.booking.weekend, prices.filter((p) => p.dayType === 'WEEKEND')],
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {groups.map(([title, bands]) =>
        bands.length ? (
          <div key={title}>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">{title}</h3>
            <ul className="space-y-1 text-sm">
              {[...bands]
                .sort((a, b) => a.startMinute - b.startMinute)
                .map((b) => (
                  <li key={b.startMinute} className="flex justify-between gap-4 border-b border-dashed border-slate-200 pb-1">
                    <span className="text-slate-600">
                      {b.startMinute === 0 && b.endMinute === 1440
                        ? m.booking.allDay
                        : `${minuteLabel(b.startMinute)} – ${minuteLabel(b.endMinute)}`}
                    </span>
                    <span className="font-semibold">
                      {formatPrice(b.pricePerHour, currency)} {m.common.perHour}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}
