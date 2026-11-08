import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { RevenueChart } from '../../components/RevenueChart';
import { Button, Card, ErrorMessage, Spinner } from '../../components/ui';
import { useI18n } from '../../i18n/context';
import { api, errorText } from '../../lib/api';
import { useAdminToken } from '../../lib/auth-context';
import { useFeedback } from '../../lib/feedback-context';
import { exportPdf, exportXlsx, type ExportMeta } from '../../lib/report-export';
import { formatAmount, formatDateShort, formatPct, presetRange, reportTable, rowLabel, type PresetKey } from '../../lib/report-format';
import { todayIn, VENUE_TZ } from '../../lib/time';
import { SPORTS, type ReportGroupBy, type Sport } from '../../lib/types';

const GROUPS: ReportGroupBy[] = ['day', 'week', 'month', 'court', 'sport'];
const PRESETS: PresetKey[] = ['today', 'thisWeek', 'thisMonth', 'lastMonth', 'thisYear'];
const selectClass = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const MAX_DAYS = 366;

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

function StatCard({ label, value, hint, children }: { label: string; value: string; hint?: string; children?: ReactNode }) {
  return (
    <Card className="print:border-slate-300 print:shadow-none">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {children}
    </Card>
  );
}

export function ReportsAdminPage() {
  const { m } = useI18n();
  const { toast } = useFeedback();
  const token = useAdminToken();
  const today = todayIn(VENUE_TZ);
  const initial = presetRange('thisMonth', today);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [sport, setSport] = useState<Sport | ''>('');
  const [courtId, setCourtId] = useState('');
  const [groupBy, setGroupBy] = useState<ReportGroupBy>('day');
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);

  const validRange = from <= to && daysBetween(from, to) <= MAX_DAYS;
  const courts = useQuery({ queryKey: ['admin-courts'], queryFn: () => api.admin(token).courts() });
  const report = useQuery({
    queryKey: ['revenue', from, to, sport, courtId, groupBy],
    queryFn: () => api.admin(token).revenue({ from, to, groupBy, sport: sport || undefined, courtId: courtId || undefined }),
    enabled: validRange,
    placeholderData: (prev) => prev,
  });
  const data = report.data;
  const courtOptions = (courts.data ?? []).filter((c) => !sport || c.sport === sport);
  const activePreset = PRESETS.find((p) => {
    const r = presetRange(p, today);
    return r.from === from && r.to === to;
  });

  const r = m.reports;
  const money = (n: number) => `${formatAmount(n, m.locale)} ${data?.currency ?? 'RSD'}`;
  const sportName = sport ? m.sports[sport] : r.all;
  const courtName = courtId ? (courts.data?.find((c) => c.id === courtId)?.name ?? '') : r.allCourts;
  const periodText = `${formatDateShort(from, m.locale)} – ${formatDateShort(to, m.locale)}`;
  const meta: ExportMeta = {
    filtersLine: r.filtersLine(periodText, sportName, courtName),
    generatedLine: r.generated(new Intl.DateTimeFormat(m.locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: VENUE_TZ }).format(data ? new Date(data.generatedAt) : undefined)),
    fileBase: `${r.fileName}-${from}_${to}`,
  };

  const runExport = async (kind: 'xlsx' | 'pdf') => {
    if (!data) return;
    setBusy(kind);
    try {
      await (kind === 'xlsx' ? exportXlsx(data, m, meta) : exportPdf(data, m, meta));
      toast(r.exported);
    } catch {
      toast(m.errors.generic, 'error');
    } finally {
      setBusy(null);
    }
  };

  const change = data?.previous.changePct ?? null;
  const table = data ? reportTable(data, m) : null;

  return (
    <div className="space-y-6">
      {/* Print header: only visible on paper */}
      <div className="hidden print:block">
        <h1 className="text-2xl font-bold">{r.title} – BookTheCourt</h1>
        <p className="text-sm">{meta.filtersLine}</p>
        <p className="text-xs text-slate-500">{meta.generatedLine}</p>
      </div>

      <Card className="space-y-4 print:hidden">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p}
              variant={activePreset === p ? 'primary' : 'secondary'}
              className="px-3 py-1.5"
              onClick={() => {
                const range = presetRange(p, today);
                setFrom(range.from);
                setTo(range.to);
              }}
            >
              {r.presets[p]}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">{r.from}</span>
            <input type="date" className={selectClass} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">{r.to}</span>
            <input type="date" className={selectClass} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">{r.sport}</span>
            <select
              className={selectClass}
              value={sport}
              onChange={(e) => {
                setSport(e.target.value as Sport | '');
                setCourtId('');
              }}
            >
              <option value="">{r.all}</option>
              {SPORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {m.sports[s.value]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">{r.court}</span>
            <select className={selectClass} value={courtId} onChange={(e) => setCourtId(e.target.value)}>
              <option value="">{r.allCourts}</option>
              {courtOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">{r.groupBy}</span>
            <div className="flex rounded-lg border border-slate-300 bg-white p-0.5" role="radiogroup" aria-label={r.groupBy}>
              {GROUPS.map((g) => (
                <button
                  key={g}
                  type="button"
                  role="radio"
                  aria-checked={groupBy === g}
                  onClick={() => setGroupBy(g)}
                  className={`rounded-md px-3 py-1.5 font-medium ${groupBy === g ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  {r.groups[g]}
                </button>
              ))}
            </div>
          </div>
        </div>
        {!validRange && <ErrorMessage>{r.tooLong}</ErrorMessage>}
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <Button variant="secondary" onClick={() => window.print()} disabled={!data}>
            🖨 {r.print}
          </Button>
          <Button variant="secondary" onClick={() => void runExport('xlsx')} disabled={!data || busy !== null}>
            {busy === 'xlsx' ? r.exporting : `⬇ ${r.exportXlsx}`}
          </Button>
          <Button variant="secondary" onClick={() => void runExport('pdf')} disabled={!data || busy !== null}>
            {busy === 'pdf' ? r.exporting : `⬇ ${r.exportPdf}`}
          </Button>
        </div>
      </Card>

      {report.isLoading && <Spinner label={m.common.loading} />}
      {report.isError && <ErrorMessage>{errorText(report.error, m.errors)}</ErrorMessage>}

      {data && table && (
        <div className={`space-y-6 ${report.isFetching ? 'opacity-60' : ''}`}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
            <StatCard label={r.realized} value={money(data.totals.realized)} hint={r.realizedHint} />
            <StatCard label={r.estimated} value={money(data.totals.estimated)} hint={r.estimatedHint} />
            <StatCard label={r.total} value={money(data.totals.total)}>
              <p className={`mt-1 text-xs font-medium ${change === null ? 'text-slate-500' : change >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {change === null ? r.noPrevious : `${change >= 0 ? '▲' : '▼'} ${r.vsPrevious(formatPct(change, m.locale, true))}`}
              </p>
            </StatCard>
            <StatCard label={r.bookings} value={String(data.totals.bookings)} />
            <StatCard
              label={r.cancelled}
              value={String(data.totals.cancelledCount)}
              hint={data.totals.cancelledCount ? r.lostRevenue(money(data.totals.cancelledAmount)) : undefined}
            />
            <StatCard label={r.occupancy} value={formatPct(data.totals.occupancyPct, m.locale)} hint={r.occupancyHint} />
          </div>

          {data.totals.bookings === 0 && data.totals.cancelledCount === 0 ? (
            <Card>{r.noData}</Card>
          ) : (
            <Card className="print:break-inside-avoid print:shadow-none">
              <RevenueChart
                currency={data.currency}
                bars={data.rows.map((row) => ({ label: rowLabel(row, data.groupBy, m), realized: row.realized, estimated: row.estimated }))}
              />
            </Card>
          )}

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm print:overflow-visible print:shadow-none">
            <table className="w-full text-sm">
              <caption className="sr-only">{r.title}</caption>
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {table.header.map((h, i) => (
                    <th key={h} scope="col" className={`px-4 py-3 ${i === 0 ? 'text-left' : 'text-right'}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {table.rows.map(([label, ...nums], idx) => (
                  <tr key={data.rows[idx].key} className={nums[0] === 0 && nums[4] === 0 ? 'text-slate-400' : ''}>
                    <th scope="row" className="whitespace-nowrap px-4 py-2.5 text-left font-medium">
                      {label}
                    </th>
                    {nums.map((n, i) => (
                      <td key={i} className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                        {i === 6 ? formatPct(n, m.locale) : i === 0 || i === 4 ? n : formatAmount(n ?? 0, m.locale)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                <tr>
                  <th scope="row" className="px-4 py-3 text-left">
                    {table.total[0]}
                  </th>
                  {table.total.slice(1).map((n, i) => (
                    <td key={i} className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {i === 6 ? formatPct(n as number | null, m.locale) : i === 0 || i === 4 ? n : formatAmount((n as number) ?? 0, m.locale)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
