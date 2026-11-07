import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, ErrorMessage, Spinner } from '../../components/ui';
import { api, errorText } from '../../lib/api';
import { addDays, formatDateLong, formatPrice, formatTime, todayIn, VENUE_TZ } from '../../lib/time';
import { sportLabel } from '../../lib/types';
import { useAdminToken } from '../../lib/auth-context';

export function BookingsAdminPage() {
  const token = useAdminToken();
  const [date, setDate] = useState(todayIn(VENUE_TZ));
  const queryClient = useQueryClient();
  const bookings = useQuery({ queryKey: ['admin-bookings', date], queryFn: () => api.admin(token).bookings(date) });
  const cancel = useMutation({
    mutationFn: (id: string) => api.admin(token).cancelBooking(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-bookings', date] }),
  });

  const list = bookings.data ?? [];
  const confirmed = list.filter((b) => b.status === 'CONFIRMED');
  const revenue = confirmed.reduce((sum, b) => sum + b.price, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
          ←
        </Button>
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          aria-label="Date"
        />
        <Button variant="secondary" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">
          →
        </Button>
        <Button variant="ghost" onClick={() => setDate(todayIn(VENUE_TZ))}>
          Today
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-slate-500">{formatDateLong(date)}</p>
          <p className="text-2xl font-bold">{confirmed.length} bookings</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Expected revenue</p>
          <p className="text-2xl font-bold">{formatPrice(revenue)}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Cancelled</p>
          <p className="text-2xl font-bold">{list.length - confirmed.length}</p>
        </Card>
      </div>

      {bookings.isLoading && <Spinner />}
      {bookings.isError && <ErrorMessage>{errorText(bookings.error)}</ErrorMessage>}
      {cancel.isError && <ErrorMessage>{errorText(cancel.error)}</ErrorMessage>}
      {bookings.data && list.length === 0 && <Card>No bookings on this day.</Card>}
      {list.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Court</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((b) => (
                <tr key={b.id} className={b.status === 'CANCELLED' ? 'text-slate-400' : ''}>
                  <td className="whitespace-nowrap px-4 py-3 font-medium">
                    {formatTime(b.startsAt)} – {formatTime(b.endsAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {b.court.name}
                    <span className="block text-xs text-slate-500">{sportLabel(b.court.sport)}</span>
                  </td>
                  <td className="px-4 py-3">
                    {b.customerName}
                    <span className="block text-xs text-slate-500">
                      {b.customerEmail} · {b.customerPhone}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono">{b.code}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">{formatPrice(b.price)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        b.status === 'CONFIRMED' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {b.status === 'CONFIRMED' ? 'Confirmed' : 'Cancelled'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {b.status === 'CONFIRMED' && (
                      <Button
                        variant="danger"
                        className="px-3 py-1"
                        disabled={cancel.isPending}
                        onClick={() => window.confirm(`Cancel booking ${b.code}?`) && cancel.mutate(b.id)}
                      >
                        Cancel
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
