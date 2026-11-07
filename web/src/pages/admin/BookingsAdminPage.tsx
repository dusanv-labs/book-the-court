import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button, Card, ErrorMessage, inputClass, Spinner } from '../../components/ui';
import { useI18n } from '../../i18n/context';
import { api, errorText } from '../../lib/api';
import { useAdminToken } from '../../lib/auth-context';
import { useFeedback } from '../../lib/feedback-context';
import { addDays, formatDateLong, formatPrice, formatTime, todayIn, VENUE_TZ } from '../../lib/time';

type StatusFilter = 'all' | 'CONFIRMED' | 'CANCELLED';

export function BookingsAdminPage() {
  const { m } = useI18n();
  const { toast, confirm } = useFeedback();
  const token = useAdminToken();
  const today = todayIn(VENUE_TZ);
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? today;
  const setDate = (d: string) => setParams(d === today ? {} : { date: d }, { replace: true });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const queryClient = useQueryClient();

  const bookings = useQuery({ queryKey: ['admin-bookings', date], queryFn: () => api.admin(token).bookings(date) });
  const cancel = useMutation({
    mutationFn: (id: string) => api.admin(token).cancelBooking(id),
    onSuccess: () => {
      toast(m.admin.bookingCancelled);
      void queryClient.invalidateQueries({ queryKey: ['admin-bookings', date] });
    },
    onError: (e) => toast(errorText(e, m.errors), 'error'),
  });

  const list = bookings.data ?? [];
  const confirmed = list.filter((b) => b.status === 'CONFIRMED');
  const revenue = confirmed.reduce((sum, b) => sum + b.price, 0);
  const needle = search.trim().toLowerCase();
  const visible = list.filter(
    (b) =>
      (status === 'all' || b.status === status) &&
      (!needle ||
        [b.code, b.customerName, b.customerEmail, b.customerPhone, b.court.name].some((v) => v.toLowerCase().includes(needle))),
  );

  const quickDays: [string, string][] = [
    [m.common.yesterday, addDays(today, -1)],
    [m.common.today, today],
    [m.common.tomorrow, addDays(today, 1)],
  ];
  const statuses: [StatusFilter, string][] = [
    ['all', m.admin.statusAll],
    ['CONFIRMED', m.admin.statusConfirmed],
    ['CANCELLED', m.admin.statusCancelled],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setDate(addDays(date, -1))} aria-label={m.common.previousDay}>
          ←
        </Button>
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          aria-label={m.admin.date}
        />
        <Button variant="secondary" onClick={() => setDate(addDays(date, 1))} aria-label={m.common.nextDay}>
          →
        </Button>
        {quickDays.map(([label, d]) => (
          <Button key={d} variant={d === date ? 'primary' : 'ghost'} onClick={() => setDate(d)}>
            {label}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-slate-500 first-letter:uppercase">{formatDateLong(date, m.locale)}</p>
          <p className="text-2xl font-bold">{m.admin.bookingsCount(confirmed.length)}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">{m.admin.revenue}</p>
          <p className="text-2xl font-bold">{formatPrice(revenue)}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">{m.admin.cancelledCount}</p>
          <p className="text-2xl font-bold">{list.length - confirmed.length}</p>
        </Card>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="search"
          className={`${inputClass} sm:max-w-sm`}
          placeholder={m.admin.search}
          aria-label={m.admin.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex rounded-xl border border-slate-200 bg-white p-1" role="radiogroup" aria-label={m.admin.colStatus}>
          {statuses.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={status === value}
              onClick={() => setStatus(value)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${status === value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {bookings.isLoading && <Spinner label={m.common.loading} />}
      {bookings.isError && <ErrorMessage>{errorText(bookings.error, m.errors)}</ErrorMessage>}
      {bookings.data && list.length === 0 && <Card>{m.admin.noBookings}</Card>}
      {list.length > 0 && visible.length === 0 && <Card>{m.admin.noMatches}</Card>}
      {visible.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">{m.admin.colTime}</th>
                <th className="px-4 py-3">{m.admin.colCourt}</th>
                <th className="px-4 py-3">{m.admin.colCustomer}</th>
                <th className="px-4 py-3">{m.admin.colCode}</th>
                <th className="px-4 py-3 text-right">{m.admin.colPrice}</th>
                <th className="px-4 py-3">{m.admin.colStatus}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((b) => (
                <tr key={b.id} className={b.status === 'CANCELLED' ? 'text-slate-400' : ''}>
                  <td className="whitespace-nowrap px-4 py-3 font-medium">
                    {formatTime(b.startsAt)} – {formatTime(b.endsAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {b.court.name}
                    <span className="block text-xs text-slate-500">{m.sports[b.court.sport]}</span>
                  </td>
                  <td className="px-4 py-3">
                    {b.customerName}
                    <span className="block text-xs text-slate-500">
                      <a className="hover:underline" href={`mailto:${b.customerEmail}`}>
                        {b.customerEmail}
                      </a>{' '}
                      ·{' '}
                      <a className="hover:underline" href={`tel:${b.customerPhone.replace(/[^+\d]/g, '')}`}>
                        {b.customerPhone}
                      </a>
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
                      {b.status === 'CONFIRMED' ? m.admin.statusConfirmed : m.admin.statusCancelled}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {b.status === 'CONFIRMED' && (
                      <Button
                        variant="danger"
                        className="px-3 py-1"
                        disabled={cancel.isPending}
                        onClick={async () => {
                          const ok = await confirm({
                            title: m.admin.confirmCancelBooking(b.code),
                            text: m.admin.confirmCancelBookingText,
                            confirmLabel: m.admin.cancelBooking,
                            danger: true,
                          });
                          if (ok) cancel.mutate(b.id);
                        }}
                      >
                        {m.admin.cancelBooking}
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
