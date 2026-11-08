import type { Messages } from '../i18n/messages';
import { addDays, monthRange } from './time';
import type { ReportGroupBy, RevenueFigures, RevenueReport, RevenueRow } from './types';

export type PresetKey = 'today' | 'thisWeek' | 'thisMonth' | 'lastMonth' | 'thisYear';

/** Monday of the week containing `date`. */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return addDays(date, -((d.getUTCDay() + 6) % 7));
}

export function presetRange(preset: PresetKey, today: string): { from: string; to: string } {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'thisWeek': {
      const from = mondayOf(today);
      return { from, to: addDays(from, 6) };
    }
    case 'thisMonth':
      return monthRange(today.slice(0, 7));
    case 'lastMonth': {
      const [y, m] = today.split('-').map(Number);
      const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
      return monthRange(prev);
    }
    case 'thisYear':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
  }
}

export function formatDateShort(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

/** Human label of a report row in the current language. */
export function rowLabel(row: RevenueRow, groupBy: ReportGroupBy, m: Messages): string {
  const d = new Date(`${row.key.length === 7 ? `${row.key}-01` : row.key}T12:00:00Z`);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(m.locale, { timeZone: 'UTC', ...o }).format(d);
  switch (groupBy) {
    case 'day':
      return `${f({ weekday: 'short' })} ${f({ day: '2-digit', month: '2-digit' })}`;
    case 'week':
      return m.reports.weekOf(formatDateShort(row.key, m.locale));
    case 'month':
      return f({ month: 'long', year: 'numeric' });
    case 'court':
      return row.label;
    case 'sport':
      return m.sports[row.key as keyof Messages['sports']] ?? row.key;
  }
}

export function formatPct(value: number | null, locale: string, signed = false): string {
  if (value === null) return '—';
  const text = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 0 }).format(Math.abs(value));
  const sign = signed ? (value > 0 ? '+' : value < 0 ? '−' : '') : value < 0 ? '−' : '';
  return `${sign}${text}%`;
}

export function formatAmount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'en-GB' ? 'en-GB' : 'sr-Latn-RS').format(value);
}

/** One table (header + rows + total) used by the page, the XLSX file and the PDF. */
export function reportTable(report: RevenueReport, m: Messages) {
  const r = m.reports;
  const firstColumn = report.groupBy === 'court' ? r.court : report.groupBy === 'sport' ? r.sport : r.period;
  const header = [firstColumn, r.bookings, r.realized, r.estimated, r.total, r.cancelled, r.cancelledAmount, `${r.occupancy} (%)`];
  const values = (f: RevenueFigures) => [f.bookings, f.realized, f.estimated, f.total, f.cancelledCount, f.cancelledAmount, f.occupancyPct];
  return {
    header,
    rows: report.rows.map((row) => [rowLabel(row, report.groupBy, m), ...values(row)] as [string, ...(number | null)[]]),
    total: [r.totalRow, ...values(report.totals)] as [string, ...(number | null)[]],
  };
}
