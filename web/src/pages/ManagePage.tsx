import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { Button, Card, ErrorMessage, SlowNotice, Spinner } from '../components/ui';
import { useI18n } from '../i18n/context';
import { api, errorText } from '../lib/api';
import { manageUrl } from '../lib/auth-context';
import { buildIcs, downloadIcs } from '../lib/calendar';
import { useFeedback } from '../lib/feedback-context';
import { formatDayOf, formatPrice, formatTime, VENUE_TZ } from '../lib/time';

export function ManagePage() {
  const { m } = useI18n();
  const { toast, confirm } = useFeedback();
  const { token = '' } = useParams();
  const queryClient = useQueryClient();
  const booking = useQuery({ queryKey: ['manage', token], queryFn: () => api.manage(token), retry: false });
  const cancel = useMutation({
    mutationFn: () => api.cancel(token),
    onSuccess: () => {
      toast(m.manage.done);
      void queryClient.invalidateQueries({ queryKey: ['manage', token] });
    },
    onError: (e) => toast(errorText(e, m.errors), 'error'),
  });

  const b = booking.data;
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
      {b && (
        <>
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <span className="font-mono text-2xl font-bold tracking-widest text-emerald-700">{b.code}</span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  b.status === 'CONFIRMED' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                }`}
              >
                {b.status === 'CONFIRMED' ? m.manage.confirmed : m.manage.cancelled}
              </span>
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

          {b.status === 'CONFIRMED' &&
            (b.canCancel ? (
              <Button
                variant="danger"
                className="w-full"
                disabled={cancel.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: m.manage.confirmCancel,
                    text: m.manage.confirmCancelText,
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
