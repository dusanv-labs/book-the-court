import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, ErrorMessage, Spinner } from '../../components/ui';
import { useI18n } from '../../i18n/context';
import type { Messages } from '../../i18n/messages';
import { api, errorText } from '../../lib/api';
import { useAdminToken } from '../../lib/auth-context';
import { useFeedback } from '../../lib/feedback-context';
import { halfHourOptions, minuteLabel } from '../../lib/time';
import { SPORTS, type DayType, type OpeningHours, type PriceRule, type Sport } from '../../lib/types';

const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const WEEKDAYS = [1, 2, 3, 4, 5];
const selectClass = 'rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm';

function TimeSelect({ value, onChange, label }: { value: number; onChange: (m: number) => void; label: string }) {
  return (
    <select className={selectClass} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}>
      {halfHourOptions().map((m) => (
        <option key={m} value={m}>
          {m === 1440 ? '24:00' : minuteLabel(m)}
        </option>
      ))}
    </select>
  );
}

function HoursEditor({ token }: { token: string }) {
  const { m } = useI18n();
  const hours = useQuery({ queryKey: ['hours'], queryFn: () => api.admin(token).hours() });
  if (hours.isLoading) return <Spinner label={m.common.loading} />;
  if (hours.isError) return <ErrorMessage>{errorText(hours.error, m.errors)}</ErrorMessage>;
  // Re-mount the form when fresh data arrives, so its local state starts from the saved values.
  return <HoursForm key={hours.dataUpdatedAt} token={token} initial={hours.data ?? []} />;
}

function HoursForm({ token, initial }: { token: string; initial: OpeningHours[] }) {
  const { m } = useI18n();
  const { toast } = useFeedback();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<OpeningHours[]>(initial);
  const save = useMutation({
    mutationFn: () => api.admin(token).setHours(rows),
    onSuccess: () => {
      toast(m.admin.hoursSaved);
      void queryClient.invalidateQueries({ queryKey: ['hours'] });
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
    onError: (e) => toast(errorText(e, m.errors), 'error'),
  });
  const set = (dow: number, patch: Partial<OpeningHours>) => setRows((r) => r.map((x) => (x.dayOfWeek === dow ? { ...x, ...patch } : x)));
  const copyMonday = () => {
    const monday = rows.find((r) => r.dayOfWeek === 1);
    if (!monday) return;
    setRows((r) =>
      r.map((x) =>
        WEEKDAYS.includes(x.dayOfWeek) ? { ...x, openMinute: monday.openMinute, closeMinute: monday.closeMinute, closed: monday.closed } : x,
      ),
    );
  };

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{m.admin.openingHours}</h2>
        <Button variant="ghost" onClick={copyMonday}>
          {m.admin.copyWeekdays}
        </Button>
      </div>
      <div className="space-y-2">
        {DISPLAY_ORDER.map((dow) => {
          const row = rows.find((r) => r.dayOfWeek === dow);
          if (!row) return null;
          const day = m.admin.days[dow];
          return (
            <div key={dow} className="flex flex-wrap items-center gap-3">
              <span className="w-28 text-sm font-medium">{day}</span>
              <TimeSelect label={`${day} ${m.admin.from}`} value={row.openMinute} onChange={(v) => set(dow, { openMinute: v })} />
              <span className="text-slate-400">–</span>
              <TimeSelect label={`${day} ${m.admin.to}`} value={row.closeMinute} onChange={(v) => set(dow, { closeMinute: v })} />
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={row.closed} onChange={(e) => set(dow, { closed: e.target.checked })} />
                {m.admin.closedDay}
              </label>
            </div>
          );
        })}
      </div>
      <Button className="mt-5" onClick={() => save.mutate()} disabled={save.isPending}>
        {m.admin.saveHours}
      </Button>
    </Card>
  );
}

/** Warnings for overlapping rules and uncovered time, per sport and day type. */
function priceWarnings(rules: PriceRule[], m: Messages): string[] {
  const warnings: string[] = [];
  for (const s of SPORTS) {
    for (const dayType of ['WEEKDAY', 'WEEKEND'] as DayType[]) {
      const group = rules.filter((r) => r.sport === s.value && r.dayType === dayType).sort((a, b) => a.startMinute - b.startMinute);
      if (group.length === 0) continue;
      const days = dayType === 'WEEKDAY' ? m.admin.weekdays : m.admin.weekend;
      let cursor = 0;
      let overlap = false;
      for (const r of group) {
        if (r.startMinute < cursor) overlap = true;
        else if (r.startMinute > cursor) warnings.push(m.admin.gapWarning(m.sports[s.value], days, minuteLabel(cursor), minuteLabel(r.startMinute)));
        cursor = Math.max(cursor, r.endMinute);
      }
      if (cursor < 1440) warnings.push(m.admin.gapWarning(m.sports[s.value], days, minuteLabel(cursor), '24:00'));
      if (overlap) warnings.unshift(m.admin.overlapWarning(m.sports[s.value], days));
    }
  }
  return warnings;
}

function PricesEditor({ token }: { token: string }) {
  const { m } = useI18n();
  const prices = useQuery({ queryKey: ['prices'], queryFn: () => api.admin(token).prices() });
  if (prices.isLoading) return <Spinner label={m.common.loading} />;
  if (prices.isError) return <ErrorMessage>{errorText(prices.error, m.errors)}</ErrorMessage>;
  const initial = (prices.data ?? []).map(({ sport, dayType, startMinute, endMinute, pricePerHour }) => ({
    sport,
    dayType,
    startMinute,
    endMinute,
    pricePerHour,
  }));
  return <PricesForm key={prices.dataUpdatedAt} token={token} initial={initial} />;
}

function PricesForm({ token, initial }: { token: string; initial: PriceRule[] }) {
  const { m } = useI18n();
  const { toast } = useFeedback();
  const queryClient = useQueryClient();
  const [rules, setRules] = useState<PriceRule[]>(initial);
  const [sport, setSport] = useState<Sport>('PADEL');
  const save = useMutation({
    mutationFn: () => api.admin(token).setPrices(rules),
    onSuccess: () => {
      toast(m.admin.pricesSaved);
      void queryClient.invalidateQueries({ queryKey: ['prices'] });
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
    onError: (e) => toast(errorText(e, m.errors), 'error'),
  });

  const visible = rules.map((r, index) => ({ r, index })).filter(({ r }) => r.sport === sport);
  const patch = (index: number, p: Partial<PriceRule>) => setRules((all) => all.map((r, i) => (i === index ? { ...r, ...p } : r)));
  const warnings = priceWarnings(rules, m);
  const hasOverlap = rules.some((a, i) =>
    rules.some((b, j) => i !== j && a.sport === b.sport && a.dayType === b.dayType && a.startMinute < b.endMinute && b.startMinute < a.endMinute),
  );

  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">{m.admin.pricesTitle}</h2>
      <p className="mb-4 text-sm text-slate-500">{m.admin.pricesIntro}</p>
      <div className="mb-4 flex flex-wrap gap-2">
        {SPORTS.map((s) => (
          <Button key={s.value} variant={sport === s.value ? 'primary' : 'secondary'} onClick={() => setSport(s.value)}>
            {m.sports[s.value]}
          </Button>
        ))}
      </div>
      <div className="space-y-2">
        {visible.map(({ r, index }) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <select className={selectClass} value={r.dayType} onChange={(e) => patch(index, { dayType: e.target.value as DayType })} aria-label={m.admin.dayType}>
              <option value="WEEKDAY">{m.admin.weekdays}</option>
              <option value="WEEKEND">{m.admin.weekend}</option>
            </select>
            <TimeSelect label={m.admin.from} value={r.startMinute} onChange={(v) => patch(index, { startMinute: v })} />
            <span className="text-slate-400">–</span>
            <TimeSelect label={m.admin.to} value={r.endMinute} onChange={(v) => patch(index, { endMinute: v })} />
            <input
              type="number"
              min={1}
              step={100}
              className={`${selectClass} w-28`}
              value={r.pricePerHour}
              onChange={(e) => patch(index, { pricePerHour: Number(e.target.value) })}
              aria-label={m.admin.pricePerHour}
            />
            <Button variant="ghost" onClick={() => setRules((all) => all.filter((_, i) => i !== index))} aria-label={m.admin.removeRule}>
              ✕
            </Button>
          </div>
        ))}
        <Button
          variant="secondary"
          onClick={() => setRules((all) => [...all, { sport, dayType: 'WEEKDAY', startMinute: 0, endMinute: 1440, pricePerHour: 2000 }])}
        >
          + {m.admin.addRule}
        </Button>
      </div>
      {warnings.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      <Button className="mt-5" onClick={() => save.mutate()} disabled={save.isPending || hasOverlap}>
        {m.admin.savePrices}
      </Button>
    </Card>
  );
}

export function ScheduleAdminPage() {
  const token = useAdminToken();
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <HoursEditor token={token} />
      <PricesEditor token={token} />
    </div>
  );
}
