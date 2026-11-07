import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { Button, Card } from '../components/ui';
import { manageUrl } from '../lib/auth-context';
import { formatDayOf, formatPrice, formatTime } from '../lib/time';
import { sportLabel, type BookingResult } from '../lib/types';


export function ConfirmationPage() {
  const booking = useLocation().state as BookingResult | null;
  const [copied, setCopied] = useState(false);
  if (!booking?.code) return <Navigate to="/" replace />;
  const link = manageUrl(booking.cancelToken);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700" aria-hidden="true">
          ✓
        </div>
        <h1 className="text-3xl font-bold">You're booked!</h1>
        <p className="mt-2 text-slate-600">Show this code at the reception.</p>
        <p className="mt-4 font-mono text-4xl font-bold tracking-[0.3em] text-emerald-700">{booking.code}</p>
      </div>

      <Card>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-slate-500">Court</dt>
          <dd className="font-medium">
            {booking.court.name} · {sportLabel(booking.court.sport)}
          </dd>
          <dt className="text-slate-500">Date</dt>
          <dd className="font-medium">{formatDayOf(booking.startsAt)}</dd>
          <dt className="text-slate-500">Time</dt>
          <dd className="font-medium">
            {formatTime(booking.startsAt)} – {formatTime(booking.endsAt)}
          </dd>
          <dt className="text-slate-500">Price</dt>
          <dd className="font-medium">{formatPrice(booking.price, booking.currency)} (pay at the venue)</dd>
        </dl>
      </Card>

      <Card>
        <h2 className="font-semibold">Manage or cancel your booking</h2>
        <p className="mt-1 text-sm text-slate-600">Save this private link. Anyone with it can cancel the booking.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input readOnly value={link} className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs" aria-label="Manage link" />
          <Button
            variant="secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(link).then(() => setCopied(true));
            }}
          >
            <span className="whitespace-nowrap">{copied ? "Copied ✓" : "Copy link"}</span>
          </Button>
        </div>
      </Card>

      <p className="text-center">
        <Link to="/" className="font-semibold text-emerald-700 hover:underline">
          ← Book another court
        </Link>
      </p>
    </div>
  );
}
