import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { Button, Card, ErrorMessage, SlowNotice, Spinner, SuccessMessage } from '../components/ui';
import { api, errorText } from '../lib/api';
import { formatDayOf, formatPrice, formatTime } from '../lib/time';
import { sportLabel } from '../lib/types';

export function ManagePage() {
  const { token = '' } = useParams();
  const queryClient = useQueryClient();
  const booking = useQuery({ queryKey: ['manage', token], queryFn: () => api.manage(token), retry: false });
  const cancel = useMutation({
    mutationFn: () => api.cancel(token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['manage', token] }),
  });

  const b = booking.data;
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-3xl font-bold">Your booking</h1>
      {booking.isLoading && (
        <Card>
          <Spinner />
          <SlowNotice />
        </Card>
      )}
      {booking.isError && <ErrorMessage>{errorText(booking.error)}</ErrorMessage>}
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
                {b.status === 'CONFIRMED' ? 'Confirmed' : 'Cancelled'}
              </span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-slate-500">Name</dt>
              <dd className="font-medium">{b.customerName}</dd>
              <dt className="text-slate-500">Court</dt>
              <dd className="font-medium">
                {b.court.name} · {sportLabel(b.court.sport)}
              </dd>
              <dt className="text-slate-500">Date</dt>
              <dd className="font-medium">{formatDayOf(b.startsAt)}</dd>
              <dt className="text-slate-500">Time</dt>
              <dd className="font-medium">
                {formatTime(b.startsAt)} – {formatTime(b.endsAt)}
              </dd>
              <dt className="text-slate-500">Price</dt>
              <dd className="font-medium">{formatPrice(b.price, b.currency)}</dd>
            </dl>
          </Card>

          {cancel.isSuccess && <SuccessMessage>Your booking has been cancelled.</SuccessMessage>}
          {cancel.isError && <ErrorMessage>{errorText(cancel.error)}</ErrorMessage>}

          {b.status === 'CONFIRMED' &&
            (b.canCancel ? (
              <Button
                variant="danger"
                className="w-full"
                disabled={cancel.isPending}
                onClick={() => {
                  if (window.confirm('Cancel this booking?')) cancel.mutate();
                }}
              >
                {cancel.isPending ? 'Cancelling…' : 'Cancel booking'}
              </Button>
            ) : (
              <p className="text-sm text-slate-600">
                Online cancellation is possible until {b.cancelCutoffMinutes / 60} hours before the start. Please contact the
                venue.
              </p>
            ))}
        </>
      )}
      <p>
        <Link to="/" className="font-semibold text-emerald-700 hover:underline">
          ← Back to booking
        </Link>
      </p>
    </div>
  );
}
