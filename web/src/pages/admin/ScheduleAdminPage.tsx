import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, ErrorMessage, Spinner, SuccessMessage } from '../../components/ui';
import { api, errorText } from '../../lib/api';
import { halfHourOptions, minuteLabel } from '../../lib/time';
import { SPORTS, type DayType, type OpeningHours, type PriceRule, type Sport } from '../../lib/types';
import { useAdminToken } from '../../lib/auth-context';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
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
  const hours = useQuery({ queryKey: ['hours'], queryFn: () => api.admin(token).hours() });
  if (hours.isLoading) return <Spinner />;
  if (hours.isError) return <ErrorMessage>{errorText(hours.error)}</ErrorMessage>;
  // Re-mount the form when fresh data arrives, so its local state starts from the saved values.
  return <HoursForm key={hours.dataUpdatedAt} token={token} initial={hours.data ?? []} />;
}

function HoursForm({ token, initial }: { token: string; initial: OpeningHours[] }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<OpeningHours[]>(initial);
  const save = useMutation({
    mutationFn: () => api.admin(token).setHours(rows),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hours'] }),
  });
  const set = (dow: number, patch: Partial<OpeningHours>) =>
    setRows((r) => r.map((x) => (x.dayOfWeek === dow ? { ...x, ...patch } : x)));

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold">Opening hours</h2>
      <div className="space-y-2">
        {DISPLAY_ORDER.map((dow) => {
          const row = rows.find((r) => r.dayOfWeek === dow);
          if (!row) return null;
          return (
            <div key={dow} className="flex flex-wrap items-center gap-3">
              <span className="w-28 text-sm font-medium">{DAY_NAMES[dow]}</span>
              <TimeSelect label={`${DAY_NAMES[dow]} opens`} value={row.openMinute} onChange={(m) => set(dow, { openMinute: m })} />
              <span className="text-slate-400">–</span>
              <TimeSelect label={`${DAY_NAMES[dow]} closes`} value={row.closeMinute} onChange={(m) => set(dow, { closeMinute: m })} />
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={row.closed} onChange={(e) => set(dow, { closed: e.target.checked })} />
                Closed
              </label>
            </div>
          );
        })}
      </div>
      <div className="mt-4 space-y-3">
        {save.isError && <ErrorMessage>{errorText(save.error)}</ErrorMessage>}
        {save.isSuccess && <SuccessMessage>Opening hours saved.</SuccessMessage>}
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          Save opening hours
        </Button>
      </div>
    </Card>
  );
}

function PricesEditor({ token }: { token: string }) {
  const prices = useQuery({ queryKey: ['prices'], queryFn: () => api.admin(token).prices() });
  if (prices.isLoading) return <Spinner />;
  if (prices.isError) return <ErrorMessage>{errorText(prices.error)}</ErrorMessage>;
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
  const queryClient = useQueryClient();
  const [rules, setRules] = useState<PriceRule[]>(initial);
  const [sport, setSport] = useState<Sport>('PADEL');
  const save = useMutation({
    mutationFn: () => api.admin(token).setPrices(rules),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prices'] }),
  });

  const visible = rules.map((r, index) => ({ r, index })).filter(({ r }) => r.sport === sport);
  const patch = (index: number, p: Partial<PriceRule>) => setRules((all) => all.map((r, i) => (i === index ? { ...r, ...p } : r)));

  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">Prices per hour (RSD)</h2>
      <p className="mb-4 text-sm text-slate-500">Each half hour of a booking is charged by the rule that covers it.</p>
      <div className="mb-4 flex gap-2">
        {SPORTS.map((s) => (
          <Button key={s.value} variant={sport === s.value ? 'primary' : 'secondary'} onClick={() => setSport(s.value)}>
            {s.label}
          </Button>
        ))}
      </div>
      <div className="space-y-2">
        {visible.map(({ r, index }) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <select className={selectClass} value={r.dayType} onChange={(e) => patch(index, { dayType: e.target.value as DayType })} aria-label="Day type">
              <option value="WEEKDAY">Mon–Fri</option>
              <option value="WEEKEND">Sat–Sun</option>
            </select>
            <TimeSelect label="From" value={r.startMinute} onChange={(m) => patch(index, { startMinute: m })} />
            <span className="text-slate-400">–</span>
            <TimeSelect label="To" value={r.endMinute} onChange={(m) => patch(index, { endMinute: m })} />
            <input
              type="number"
              min={1}
              step={100}
              className={`${selectClass} w-28`}
              value={r.pricePerHour}
              onChange={(e) => patch(index, { pricePerHour: Number(e.target.value) })}
              aria-label="Price per hour"
            />
            <Button variant="ghost" onClick={() => setRules((all) => all.filter((_, i) => i !== index))} aria-label="Remove rule">
              ✕
            </Button>
          </div>
        ))}
        <Button
          variant="secondary"
          onClick={() => setRules((all) => [...all, { sport, dayType: 'WEEKDAY', startMinute: 0, endMinute: 1440, pricePerHour: 2000 }])}
        >
          + Add rule
        </Button>
      </div>
      <div className="mt-4 space-y-3">
        {save.isError && <ErrorMessage>{errorText(save.error)}</ErrorMessage>}
        {save.isSuccess && <SuccessMessage>Prices saved.</SuccessMessage>}
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          Save all prices
        </Button>
      </div>
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
