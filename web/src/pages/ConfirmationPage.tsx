import { Link, Navigate, useLocation } from 'react-router';
import { Button, Card } from '../components/ui';
import { useI18n } from '../i18n/context';
import { manageUrl } from '../lib/auth-context';
import { buildIcs, downloadIcs } from '../lib/calendar';
import { useFeedback } from '../lib/feedback-context';
import { formatDayOf, formatPrice, formatTime, VENUE_TZ } from '../lib/time';
import type { BookingResult } from '../lib/types';

export function ConfirmationPage() {
  const { m } = useI18n();
  const { toast } = useFeedback();
  const booking = useLocation().state as BookingResult | null;
  if (!booking?.code) return <Navigate to="/" replace />;
  const link = manageUrl(booking.cancelToken);

  const addToCalendar = () =>
    downloadIcs(
      `booking-${booking.code}.ics`,
      buildIcs({
        uid: booking.code,
        title: m.confirmation.calendarTitle(booking.court.name),
        description: `${m.confirmation.court}: ${booking.court.name}\nCode: ${booking.code}\n${link}`,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        url: link,
      }),
    );

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700" aria-hidden="true">
          ✓
        </div>
        <h1 className="text-3xl font-bold">{m.confirmation.title}</h1>
        <p className="mt-2 text-slate-600">{m.confirmation.showCode}</p>
        <p className="mt-4 font-mono text-4xl font-bold tracking-[0.3em] text-emerald-700">{booking.code}</p>
      </div>

      <Card>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-slate-500">{m.confirmation.court}</dt>
          <dd className="font-medium">
            {booking.court.name} · {m.sports[booking.court.sport]}
          </dd>
          <dt className="text-slate-500">{m.confirmation.date}</dt>
          <dd className="font-medium first-letter:uppercase">{formatDayOf(booking.startsAt, VENUE_TZ, m.locale)}</dd>
          <dt className="text-slate-500">{m.confirmation.time}</dt>
          <dd className="font-medium">
            {formatTime(booking.startsAt)} – {formatTime(booking.endsAt)}
          </dd>
          <dt className="text-slate-500">{m.confirmation.price}</dt>
          <dd className="font-medium">
            {formatPrice(booking.price, booking.currency)} {m.confirmation.payAtVenue}
          </dd>
        </dl>
        <Button variant="secondary" className="mt-5 w-full" onClick={addToCalendar}>
          📅 {m.confirmation.addToCalendar}
        </Button>
      </Card>

      <Card>
        <h2 className="font-semibold">{m.confirmation.manageTitle}</h2>
        <p className="mt-1 text-sm text-slate-600">{m.confirmation.manageText}</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            readOnly
            value={link}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs"
            aria-label={m.confirmation.manageTitle}
            onFocus={(e) => e.target.select()}
          />
          <Button
            variant="secondary"
            className="whitespace-nowrap"
            onClick={() => {
              void navigator.clipboard?.writeText(link).then(() => toast(m.confirmation.copied));
            }}
          >
            {m.confirmation.copy}
          </Button>
        </div>
      </Card>

      <p className="text-center">
        <Link to="/" className="font-semibold text-emerald-700 hover:underline">
          ← {m.confirmation.another}
        </Link>
      </p>
    </div>
  );
}
