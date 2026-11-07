import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, ErrorMessage, Field, inputClass, Spinner } from '../../components/ui';
import { api, errorText } from '../../lib/api';
import { SPORTS, type Court, type Sport } from '../../lib/types';
import { useAdminToken } from '../../lib/auth-context';

export function CourtsAdminPage() {
  const token = useAdminToken();
  const queryClient = useQueryClient();
  const courts = useQuery({ queryKey: ['admin-courts'], queryFn: () => api.admin(token).courts() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-courts'] });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Court> }) => api.admin(token).updateCourt(id, data),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (id: string) => api.admin(token).deleteCourt(id), onSuccess: refresh });
  const create = useMutation({
    mutationFn: (data: Omit<Court, 'id'>) => api.admin(token).createCourt(data),
    onSuccess: () => {
      setDraft({ name: '', sport: 'PADEL', indoor: false });
      void refresh();
    },
  });
  const [draft, setDraft] = useState<{ name: string; sport: Sport; indoor: boolean }>({ name: '', sport: 'PADEL', indoor: false });

  const error = update.error ?? remove.error ?? create.error;

  return (
    <div className="space-y-6">
      {error && <ErrorMessage>{errorText(error)}</ErrorMessage>}
      {courts.isLoading && <Spinner />}
      {courts.data && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Sport</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {courts.data.map((c) => (
                <tr key={c.id} className={c.active ? '' : 'text-slate-400'}>
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3">{SPORTS.find((s) => s.value === c.sport)?.label}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="rounded-full border border-slate-300 px-2 py-0.5 text-xs hover:border-emerald-500"
                      onClick={() => update.mutate({ id: c.id, data: { indoor: !c.indoor } })}
                    >
                      {c.indoor ? 'Indoor' : 'Outdoor'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={c.active}
                        onChange={() => update.mutate({ id: c.id, data: { active: !c.active } })}
                        className="h-4 w-4 accent-emerald-600"
                      />
                      {c.active ? 'Active' : 'Inactive'}
                    </label>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="danger"
                      className="px-3 py-1"
                      onClick={() => window.confirm(`Delete ${c.name}?`) && remove.mutate(c.id)}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm text-slate-500">Courts with bookings cannot be deleted. Deactivate them to hide them from customers.</p>

      <Card>
        <h2 className="mb-4 font-semibold">Add a court</h2>
        <form
          className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.name.trim()) create.mutate({ ...draft, name: draft.name.trim(), active: true, sortOrder: (courts.data?.length ?? 0) + 1 });
          }}
        >
          <Field label="Name">
            <input className={inputClass} value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
          </Field>
          <Field label="Sport">
            <select className={inputClass} value={draft.sport} onChange={(e) => setDraft({ ...draft, sport: e.target.value as Sport })}>
              {SPORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select className={inputClass} value={draft.indoor ? 'in' : 'out'} onChange={(e) => setDraft({ ...draft, indoor: e.target.value === 'in' })}>
              <option value="out">Outdoor</option>
              <option value="in">Indoor</option>
            </select>
          </Field>
          <Button type="submit" disabled={create.isPending}>
            Add court
          </Button>
        </form>
      </Card>
    </div>
  );
}
