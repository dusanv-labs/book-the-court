import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AvailabilityGrid, Legend } from '../components/AvailabilityGrid';
import { BookingDialog } from '../components/BookingDialog';
import { DateStrip } from '../components/DateStrip';
import { PriceList } from '../components/PriceList';
import { Card, ErrorMessage, SlowNotice, Spinner } from '../components/ui';
import { api, errorText } from '../lib/api';
import { formatDateLong, minuteLabel, todayIn, VENUE_TZ } from '../lib/time';
import { SPORTS, type AvailabilityCourt, type Sport } from '../lib/types';

export function BookingPage() {
  const today = todayIn(VENUE_TZ);
  const [sport, setSport] = useState<Sport>('PADEL');
  const [date, setDate] = useState(today);
  const [selection, setSelection] = useState<{ court: AvailabilityCourt; slotIndex: number } | null>(null);
  const [conflict, setConflict] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const availability = useQuery({
    queryKey: ['availability', date, sport],
    queryFn: () => api.availability(date, sport),
    refetchInterval: 60_000,
  });
  const data = availability.data;

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Book a court</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Pick a sport and a day, then click a free slot. Courts can be booked for 60, 90 or 120 minutes.
        </p>
      </section>

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Sport">
        {SPORTS.map((s) => (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={sport === s.value}
            onClick={() => setSport(s.value)}
            className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
              sport === s.value
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:border-slate-500'
            }`}
          >
            <span aria-hidden="true">{s.icon}</span> {s.label}
          </button>
        ))}
      </div>

      <DateStrip start={today} value={date} onChange={setDate} />

      <section aria-live="polite" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{formatDateLong(date)}</h2>
            {data?.hours && (
              <p className="text-sm text-slate-500">
                Open {minuteLabel(data.hours.openMinute)} – {minuteLabel(data.hours.closeMinute)}
              </p>
            )}
          </div>
          <Legend />
        </div>

        {conflict && (
          <ErrorMessage>That slot was just booked by someone else. The grid has been refreshed — please pick another time.</ErrorMessage>
        )}

        {availability.isLoading && (
          <Card>
            <Spinner label="Loading availability" />
            <SlowNotice />
          </Card>
        )}
        {availability.isError && <ErrorMessage>{errorText(availability.error)}</ErrorMessage>}
        {data && !data.hours && <Card>The venue is closed on this day.</Card>}
        {data && data.hours && data.courts.length === 0 && <Card>No courts are available for this sport.</Card>}
        {data && data.hours && data.courts.length > 0 && (
          <p className="text-xs text-slate-500 sm:hidden">Swipe the table sideways to see all times →</p>
        )}
        {data && data.hours && data.courts.length > 0 && (
          <AvailabilityGrid
            data={data}
            onSelect={(court, slotIndex) => {
              setConflict(false);
              setSelection({ court, slotIndex });
            }}
          />
        )}
      </section>

      {data && data.prices.length > 0 && (
        <Card>
          <h2 className="mb-3 text-lg font-semibold">Prices · {SPORTS.find((s) => s.value === sport)?.label}</h2>
          <PriceList prices={data.prices} currency={data.currency} />
        </Card>
      )}

      {data && selection && (
        <BookingDialog
          data={data}
          court={selection.court}
          slotIndex={selection.slotIndex}
          onClose={() => setSelection(null)}
          onBooked={(result) => {
            void queryClient.invalidateQueries({ queryKey: ['availability'] });
            navigate('/confirmed', { state: result });
          }}
          onConflict={() => {
            setSelection(null);
            setConflict(true);
            void availability.refetch();
          }}
        />
      )}
    </div>
  );
}
