import { useState } from 'react';
import { useI18n } from '../i18n/context';
import { formatAmount } from '../lib/report-format';

// Validated pair (dataviz palette check: lightness, chroma, colour-blind separation, contrast).
const REALIZED_COLOR = '#059669';
const ESTIMATED_COLOR = '#6366f1';

interface Bar {
  label: string;
  realized: number;
  estimated: number;
}

/** "Nice" round maximum for the y axis (1, 2, 2.5 or 5 × 10^n). */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const f = value / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

/**
 * Stacked bars: realized (bottom) + estimated (top), one bar per report row.
 * The data table below the chart is the accessible view, so the chart itself is decorative for screen readers.
 */
export function RevenueChart({ bars, currency }: { bars: Bar[]; currency: string }) {
  const { m } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...bars.map((b) => b.realized + b.estimated), 0));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const labelEvery = Math.max(1, Math.ceil(bars.length / 12));
  const h = 220;

  return (
    <figure className="m-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <figcaption className="text-sm font-semibold text-slate-700">{m.reports.chartTitle}</figcaption>
        <ul className="flex gap-4 text-xs text-slate-600">
          {[
            [REALIZED_COLOR, m.reports.realized],
            [ESTIMATED_COLOR, m.reports.estimated],
          ].map(([color, label]) => (
            <li key={label} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>
      </div>
      <div className="relative" aria-hidden="true">
        <div className="flex">
          {/* y axis labels */}
          <div className="relative mr-2 w-14 shrink-0 text-right text-[11px] text-slate-400" style={{ height: h }}>
            {ticks.map((t) => (
              <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: h - (t / max) * h }}>
                {formatAmount(t, m.locale)}
              </span>
            ))}
          </div>
          <div className="relative flex-1" style={{ height: h }}>
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 border-t border-slate-100" style={{ top: h - (t / max) * h }} />
            ))}
            <div className="absolute inset-0 flex items-end gap-[2px]">
              {bars.map((b, i) => {
                const total = b.realized + b.estimated;
                return (
                  <div
                    key={b.label + i}
                    className="relative flex h-full min-w-[3px] flex-1 flex-col justify-end"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                  >
                    {b.estimated > 0 && (
                      <div
                        className="w-full rounded-t-[4px]"
                        style={{ height: (b.estimated / max) * h, background: ESTIMATED_COLOR, opacity: hover === null || hover === i ? 1 : 0.55 }}
                      />
                    )}
                    {b.realized > 0 && (
                      <div
                        className={`w-full ${b.estimated > 0 ? 'mt-[2px]' : 'rounded-t-[4px]'}`}
                        style={{ height: (b.realized / max) * h, background: REALIZED_COLOR, opacity: hover === null || hover === i ? 1 : 0.55 }}
                      />
                    )}
                    {hover === i && (
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-44 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg">
                        <p className="mb-1 font-semibold">{b.label}</p>
                        <p>
                          {m.reports.realized}: {formatAmount(b.realized, m.locale)} {currency}
                        </p>
                        <p>
                          {m.reports.estimated}: {formatAmount(b.estimated, m.locale)} {currency}
                        </p>
                        <p className="mt-1 font-semibold">
                          {m.reports.total}: {formatAmount(total, m.locale)} {currency}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {/* x axis labels: every n-th, so they never collide */}
        <div className="ml-16 mt-1 flex gap-[2px] text-[11px] text-slate-500">
          {bars.map((b, i) => (
            <div key={b.label + i} className="min-w-[3px] flex-1 overflow-visible whitespace-nowrap text-center">
              {i % labelEvery === 0 ? b.label : ''}
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}
