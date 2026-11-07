import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, ErrorMessage, Field, inputClass, Spinner } from '../../components/ui';
import { api, errorText } from '../../lib/api';
import { formatDateLong, formatTime, halfHourOptions, localToIso, minuteLabel, todayIn, VENUE_TZ } from '../../lib/time';
import { useAdminToken } from '../../lib/auth-context';

export function BlocksAdminPage() {
  const token = useAdminToken();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayIn(VENUE_TZ));
  const [form, setForm] = useState({ courtId: '', from: 9 * 60, to: 11 * 60, reason: '' });

  const courts = useQuery({ queryKey: ['admin-courts'], queryFn: () => api.admin(token).courts() });
  const blocks = useQuery({ queryKey: ['blocks', date], queryFn: () => api.admin(token).blocks(date) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['blocks', date] });

  const create = useMutation({
    mutationFn: () =>
      api.admin(token).createBlock({
        courtId: form.courtId || null,
        startsAt: localToIso(date, form.from),
        endsAt: localToIso(date, form.to),
        reason: form.reason.trim(),
      }),
    onSuccess: () => {
      setForm((f) => ({ ...f, reason: '' }));
      void refresh();
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.admin(token).deleteBlock(id), onSuccess: refresh });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <h2 className="mb-4 text-lg font-semibold">Block time</h2>
        <p className="mb-4 text-sm text-slate-500">For maintenance, tournaments or private events. Customers cannot book blocked time.</p>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Date">
            <input type="date" className={inputClass} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
          <Field label="Court">
            <select className={inputClass} value={form.courtId} onChange={(e) => setForm({ ...form, courtId: e.target.value })}>
              <option value="">All courts</option>
              {courts.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <select className={inputClass} value={form.from} onChange={(e) => setForm({ ...form, from: Number(e.target.value) })}>
                {halfHourOptions(0, 23 * 60 + 30).map((m) => (
                  <option key={m} value={m}>
                    {minuteLabel(m)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="To">
              <select className={inputClass} value={form.to} onChange={(e) => setForm({ ...form, to: Number(e.target.value) })}>
                {halfHourOptions(30, 24 * 60).map((m) => (
                  <option key={m} value={m}>
                    {m === 1440 ? '24:00' : minuteLabel(m)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Reason">
            <input className={inputClass} value={form.reason} maxLength={120} onChange={(e) => setForm({ ...form, reason: e.target.value })} required placeholder="e.g. Court maintenance" />
          </Field>
          {create.isError && <ErrorMessage>{errorText(create.error)}</ErrorMessage>}
          <Button type="submit" disabled={create.isPending || form.to <= form.from || !form.reason.trim()}>
            Block time
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Blocked on {formatDateLong(date)}</h2>
        {blocks.isLoading && <Spinner />}
        {remove.isError && <ErrorMessage>{errorText(remove.error)}</ErrorMessage>}
        {blocks.data?.length === 0 && <p className="text-sm text-slate-500">Nothing blocked on this day.</p>}
        <ul className="divide-y divide-slate-100">
          {blocks.data?.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">
                  {formatTime(b.startsAt)} – {formatTime(b.endsAt)} · {b.court?.name ?? 'All courts'}
                </p>
                <p className="text-sm text-slate-500">{b.reason}</p>
              </div>
              <Button variant="danger" className="px-3 py-1" onClick={() => remove.mutate(b.id)} disabled={remove.isPending}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
