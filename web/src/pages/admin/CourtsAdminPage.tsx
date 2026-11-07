import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, ErrorMessage, Field, inputClass, Spinner } from '../../components/ui';
import { useI18n } from '../../i18n/context';
import { api, errorText } from '../../lib/api';
import { useAdminToken } from '../../lib/auth-context';
import { useFeedback } from '../../lib/feedback-context';
import { SPORTS, type Court, type Sport } from '../../lib/types';

const smallSelect = 'rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm';

export function CourtsAdminPage() {
  const { m } = useI18n();
  const { toast, confirm } = useFeedback();
  const token = useAdminToken();
  const queryClient = useQueryClient();
  const courts = useQuery({ queryKey: ['admin-courts'], queryFn: () => api.admin(token).courts() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-courts'] });
  const onError = (e: unknown) => toast(errorText(e, m.errors), 'error');

  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [draft, setDraft] = useState<{ name: string; sport: Sport; indoor: boolean }>({ name: '', sport: 'PADEL', indoor: false });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Court> }) => api.admin(token).updateCourt(id, data),
    onSuccess: () => {
      toast(m.admin.courtSaved);
      setEditing(null);
      void refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.admin(token).deleteCourt(id),
    onSuccess: () => {
      toast(m.admin.courtDeleted);
      void refresh();
    },
    onError,
  });
  const create = useMutation({
    mutationFn: (data: Omit<Court, 'id'>) => api.admin(token).createCourt(data),
    onSuccess: () => {
      toast(m.admin.courtAdded);
      setDraft({ name: '', sport: 'PADEL', indoor: false });
      void refresh();
    },
    onError,
  });

  const saveName = () => {
    if (editing && editing.name.trim()) update.mutate({ id: editing.id, data: { name: editing.name.trim() } });
  };

  return (
    <div className="space-y-6">
      {courts.isLoading && <Spinner label={m.common.loading} />}
      {courts.isError && <ErrorMessage>{errorText(courts.error, m.errors)}</ErrorMessage>}
      {courts.data && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">{m.admin.courtName}</th>
                <th className="px-4 py-3">{m.admin.courtSport}</th>
                <th className="px-4 py-3">{m.admin.courtType}</th>
                <th className="px-4 py-3">{m.admin.courtStatus}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {courts.data.map((c) => (
                <tr key={c.id} className={c.active ? '' : 'text-slate-400'}>
                  <td className="px-4 py-3 font-medium">
                    {editing?.id === c.id ? (
                      <form
                        className="flex gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          saveName();
                        }}
                      >
                        <input
                          autoFocus
                          className={`${inputClass} py-1`}
                          value={editing.name}
                          maxLength={60}
                          onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                          onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                          aria-label={m.admin.courtName}
                        />
                        <Button type="submit" className="px-3 py-1">
                          {m.common.save}
                        </Button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="group inline-flex items-center gap-2 text-left hover:text-emerald-700"
                        onClick={() => setEditing({ id: c.id, name: c.name })}
                        title={m.admin.rename}
                      >
                        {c.name}
                        <span className="text-xs text-slate-400 group-hover:text-emerald-600" aria-hidden="true">
                          ✎
                        </span>
                        <span className="sr-only">{m.admin.rename}</span>
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className={smallSelect}
                      value={c.sport}
                      onChange={(e) => update.mutate({ id: c.id, data: { sport: e.target.value as Sport } })}
                      aria-label={m.admin.courtSport}
                    >
                      {SPORTS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {m.sports[s.value]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className={smallSelect}
                      value={c.indoor ? 'in' : 'out'}
                      onChange={(e) => update.mutate({ id: c.id, data: { indoor: e.target.value === 'in' } })}
                      aria-label={m.admin.courtType}
                    >
                      <option value="out">{m.common.outdoor}</option>
                      <option value="in">{m.common.indoor}</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={c.active}
                        onChange={() => update.mutate({ id: c.id, data: { active: !c.active } })}
                        className="h-4 w-4 accent-emerald-600"
                      />
                      {c.active ? m.admin.active : m.admin.inactive}
                    </label>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="danger"
                      className="px-3 py-1"
                      onClick={async () => {
                        const ok = await confirm({
                          title: m.admin.confirmDeleteCourt(c.name),
                          text: m.admin.confirmDeleteCourtText,
                          confirmLabel: m.admin.deleteCourt,
                          danger: true,
                        });
                        if (ok) remove.mutate(c.id);
                      }}
                    >
                      {m.admin.deleteCourt}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm text-slate-500">{m.admin.courtsHint}</p>

      <Card>
        <h2 className="mb-4 font-semibold">{m.admin.addCourt}</h2>
        <form
          className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.name.trim()) {
              create.mutate({ ...draft, name: draft.name.trim(), active: true, sortOrder: (courts.data?.length ?? 0) + 1 });
            }
          }}
        >
          <Field label={m.admin.courtName}>
            <input className={inputClass} value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
          </Field>
          <Field label={m.admin.courtSport}>
            <select className={inputClass} value={draft.sport} onChange={(e) => setDraft({ ...draft, sport: e.target.value as Sport })}>
              {SPORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {m.sports[s.value]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={m.admin.courtType}>
            <select className={inputClass} value={draft.indoor ? 'in' : 'out'} onChange={(e) => setDraft({ ...draft, indoor: e.target.value === 'in' })}>
              <option value="out">{m.common.outdoor}</option>
              <option value="in">{m.common.indoor}</option>
            </select>
          </Field>
          <Button type="submit" disabled={create.isPending || !draft.name.trim()}>
            {m.admin.addCourtButton}
          </Button>
        </form>
      </Card>
    </div>
  );
}
