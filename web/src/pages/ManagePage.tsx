import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router';
import { Button, Card, ErrorMessage, SlowNotice, Spinner } from '../components/ui';
import { useI18n } from '../i18n/context';
import { api, errorText } from '../lib/api';
import { manageUrl } from '../lib/auth-context';
import { buildIcs, downloadIcs } from '../lib/calendar';
import { useFeedback } from '../lib/feedback-context';
import { formatDayOf, formatPrice, formatTime, VENUE_TZ } from '../lib/time';
import type { BookingStatus, PaymentStatus } from '../lib/types';

const STATUS_STYLE: Record<BookingStatus, string> = {
  CONFIRMED: 'bg-emerald-100 text-emerald-800',
  PENDING: 'bg-amber-100 text-amber-800',
  CANCELLED: 'bg-slate-200 text-slate-700',
  EXPIRED: 'bg-slate-200 text-slate-700',
};

export function ManagePage() {
  const { m } = useI18n();
  const { toast, confirm } = useFeedback();
  const { token = '' } = useParams();
  // Set by Stripe when the player comes back from the payment page.
  const returned = useSearchParams()[0].get('payment');
  const queryClient = useQueryClient();
  const booking = useQuery({
    queryKey: ['manage', token],
    queryFn: () => api.manage(token),
    retry: false,
    // Back from a finished payment: check again until the API has confirmed it.
    refetchInterval: (query) => (returned === 'done' && query.state.data?.status === 'PENDING' ? 2000 : false),
  });
  const paidOnline = booking.data?.paymentStatus === 'PAID';
  const cancel = useMutation({
    mutationFn: () => api.cancel(token),
    onSuccess: () => {
      toast(paidOnline ? m.manage.doneRefund : m.manage.done);
      void queryClient.invalidateQueries({ queryKey: ['manage', token] });
    },
    onError: (e) => toast(errorText(e, m.errors), 'error'),
  });

  const b = booking.data;
  const statusLabel: Record<BookingStatus, string> = {
    CONFIRMED: m.manage.confirmed,
    PENDING: m.manage.pending,
    CANCELLED: m.manage.cancelled,
    EXPIRED: m.manage.expired,
  };
  const paymentLabel: Record<PaymentStatus, string> = {
    AT_VENUE: m.manage.atVenue,
    UNPAID: m.manage.unpaid,
    PAID: m.manage.paidOnline,
    REFUNDED: m.manage.refunded,
  };
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-3xl font-bold">{m.manage.title}</h1>
      {booking.isLoading && (
        <Card>
          <Spinner label={m.common.loading} />
          <SlowNotice />
        </Card>
      )}
      {booking.isError && <ErrorMessage>{errorText(booking.error, m.errors)}</ErrorMessage>}
      {b?.status === 'PENDING' && (
        <div className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-5">
          {returned === 'done' ? (
            <Spinner label={m.manage.checking} />
          ) : (
            <>
              {returned === 'cancelled' && <p className="font-semibold text-amber-900">{m.manage.paymentCancelled}</p>}
              {b.holdExpiresAt && <p className="text-sm text-amber-900">{m.manage.pendingText(formatTime(b.holdExpiresAt))}</p>}
              {b.checkoutUrl && (
                <Button className="w-full" onClick={() => window.location.assign(b.checkoutUrl!)}>
                  💳 {m.manage.payNow} · {formatPrice(b.price, b.currency)}
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {b?.status === 'CONFIRMED' && paidOnline && returned === 'done' && (
        <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 font-semibold text-emerald-800">
          ✓ {m.manage.paidBanner}
        </p>
      )}
      {b?.status === 'EXPIRED' && <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">{m.manage.expiredText}</p>}
      {b && (
        <>
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <span className="font-mono text-2xl font-bold tracking-widest text-emerald-700">{b.code}</span>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[b.status]}`}>{statusLabel[b.status]}</span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-slate-500">{m.manage.name}</dt>
              <dd className="font-medium">{b.customerName}</dd>
              <dt className="text-slate-500">{m.confirmation.court}</dt>
              <dd className="font-medium">
                {b.court.name} · {m.sports[b.court.sport]}
              </dd>
              <dt className="text-slate-500">{m.confirmation.date}</dt>
              <dd className="font-medium first-letter:uppercase">{formatDayOf(b.startsAt, VENUE_TZ, m.locale)}</dd>
              <dt className="text-slate-500">{m.confirmation.time}</dt>
              <dd className="font-medium">
                {formatTime(b.startsAt)} – {formatTime(b.endsAt)}
              </dd>
              <dt className="text-slate-500">{m.confirmation.price}</dt>
              <dd className="font-medium">{formatPrice(b.price, b.currency)}</dd>
              <dt className="text-slate-500">{m.manage.payment}</dt>
              <dd className="font-medium">{paymentLabel[b.paymentStatus]}</dd>
            </dl>
            {b.status === 'CONFIRMED' && (
              <Button
                variant="secondary"
                className="mt-5 w-full"
                onClick={() =>
                  downloadIcs(
                    `booking-${b.code}.ics`,
                    buildIcs({
                      uid: b.code,
                      title: m.confirmation.calendarTitle(b.court.name),
                      description: `Code: ${b.code}`,
                      startsAt: b.startsAt,
                      endsAt: b.endsAt,
                      url: manageUrl(token),
                    }),
                  )
                }
              >
                📅 {m.confirmation.addToCalendar}
              </Button>
            )}
          </Card>

          {(b.status === 'CONFIRMED' || b.status === 'PENDING') &&
            (b.canCancel ? (
              <Button
                variant="danger"
                className="w-full"
                disabled={cancel.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: m.manage.confirmCancel,
                    text: paidOnline ? m.manage.confirmCancelPaid : m.manage.confirmCancelText,
                    confirmLabel: m.manage.cancelButton,
                    cancelLabel: m.manage.keep,
                    danger: true,
                  });
                  if (ok) cancel.mutate();
                }}
              >
                {cancel.isPending ? m.manage.cancelling : m.manage.cancelButton}
              </Button>
            ) : (
              <p className="text-sm text-slate-600">{m.manage.cutoff(b.cancelCutoffMinutes / 60)}</p>
            ))}
        </>
      )}
      <p>
        <Link to="/" className="font-semibold text-emerald-700 hover:underline">
          ← {m.manage.backToBooking}
        </Link>
      </p>
    </div>
  );
}
