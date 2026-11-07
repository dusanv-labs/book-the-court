import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, ErrorMessage, Field, inputClass, Spinner } from '../../components/ui';
import { useI18n } from '../../i18n/context';
import { api, errorText } from '../../lib/api';
import { useAdminToken } from '../../lib/auth-context';
import { useFeedback } from '../../lib/feedback-context';
import { formatDayOf, formatTime, halfHourOptions, localToIso, minuteLabel, todayIn, VENUE_TZ } from '../../lib/time';

export function BlocksAdminPage() {
  const { m } = useI18n();
  const { toast } = useFeedback();
  const token = useAdminToken();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ date: todayIn(VENUE_TZ), courtId: '', from: 9 * 60, to: 11 * 60, reason: '' });

  const courts = useQuery({ queryKey: ['admin-courts'], queryFn: () => api.admin(token).courts() });
  const blocks = useQuery({ queryKey: ['blocks-upcoming'], queryFn: () => api.admin(token).blocks() });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['blocks-upcoming'] });
    void queryClient.invalidateQueries({ queryKey: ['availability'] });
  };

  const create = useMutation({
    mutationFn: () =>
      api.admin(token).createBlock({
        courtId: form.courtId || null,
        startsAt: localToIso(form.date, form.from),
        endsAt: localToIso(form.date, form.to),
        reason: form.reason.trim(),
      }),
    onSuccess: () => {
      toast(m.admin.blockCreated);
      setForm((f) => ({ ...f, reason: '' }));
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.admin(token).deleteBlock(id),
    onSuccess: () => {
      toast(m.admin.blockRemoved);
      refresh();
    },
    onError: (e) => toast(errorText(e, m.errors), 'error'),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <h2 className="mb-1 text-lg font-semibold">{m.admin.blockTitle}</h2>
        <p className="mb-4 text-sm text-slate-500">{m.admin.blockIntro}</p>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label={m.admin.date}>
              <input type="date" className={inputClass} value={form.date} onChange={(e) => e.target.value && setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label={m.admin.court}>
              <select className={inputClass} value={form.courtId} onChange={(e) => setForm({ ...form, courtId: e.target.value })}>
                <option value="">{m.admin.allCourts}</option>
                {courts.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={m.admin.from}>
              <select className={inputClass} value={form.from} onChange={(e) => setForm({ ...form, from: Number(e.target.value) })}>
                {halfHourOptions(0, 23 * 60 + 30).map((v) => (
                  <option key={v} value={v}>
                    {minuteLabel(v)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={m.admin.to}>
              <select className={inputClass} value={form.to} onChange={(e) => setForm({ ...form, to: Number(e.target.value) })}>
                {halfHourOptions(30, 24 * 60).map((v) => (
                  <option key={v} value={v}>
                    {v === 1440 ? '24:00' : minuteLabel(v)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={m.admin.reason}>
            <input
              className={inputClass}
              value={form.reason}
              maxLength={120}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              required
              placeholder={m.admin.reasonPlaceholder}
            />
          </Field>
          {create.isError && <ErrorMessage>{errorText(create.error, m.errors)}</ErrorMessage>}
          <Button type="submit" disabled={create.isPending || form.to <= form.from || !form.reason.trim()}>
            {m.admin.blockButton}
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">{m.admin.upcomingBlocks}</h2>
        {blocks.isLoading && <Spinner label={m.common.loading} />}
        {blocks.isError && <ErrorMessage>{errorText(blocks.error, m.errors)}</ErrorMessage>}
        {blocks.data?.length === 0 && <p className="text-sm text-slate-500">{m.admin.noBlocks}</p>}
        <ul className="divide-y divide-slate-100">
          {blocks.data?.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium first-letter:uppercase">{formatDayOf(b.startsAt, VENUE_TZ, m.locale)}</p>
                <p className="text-sm text-slate-600">
                  {formatTime(b.startsAt)} – {formatTime(b.endsAt)} · {b.court?.name ?? m.admin.allCourts}
                </p>
                <p className="text-sm text-slate-500">{b.reason}</p>
              </div>
              <Button variant="danger" className="px-3 py-1" onClick={() => remove.mutate(b.id)} disabled={remove.isPending}>
                {m.admin.removeBlock}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
