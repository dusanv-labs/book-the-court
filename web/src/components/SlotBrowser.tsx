import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/context';
import { api, errorText } from '../lib/api';
import { lowestHourly } from '../lib/pricing';
import { addDays, formatDateLong, formatPrice, minuteLabel, monthRange, todayIn, VENUE_TZ } from '../lib/time';
import { SPORTS, type AvailabilityCourt, type BookingResult, type DayStatus, type Sport } from '../lib/types';
import { BookingDialog } from './BookingDialog';
import { MonthCalendar } from './MonthCalendar';
import { PriceList } from './PriceList';
import { startOptions } from '../lib/start-options';
import { TimePicker } from './TimePicker';
import { Button, Card, ErrorMessage, SlowNotice, Spinner } from './ui';

const MAX_DAYS_AHEAD = 60; // mirrors the API rule; the API also enforces it
const DURATIONS = [60, 90, 120];

function StepTitle({ n, children }: { n: number; children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs text-white">{n}</span>
      {children}
    </h2>
  );
}

/** Sport → day (calendar) → duration and start time → court → booking dialog. */
export function SlotBrowser({ onBooked, rememberCustomer }: { onBooked: (result: BookingResult) => void; rememberCustomer: boolean }) {
  const { m } = useI18n();
  const today = todayIn(VENUE_TZ);
  const lastDay = addDays(today, MAX_DAYS_AHEAD);
  const [sport, setSport] = useState<Sport>('PADEL');
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [duration, setDuration] = useState(90);
  const [selection, setSelection] = useState<{ court: AvailabilityCourt; slotIndex: number } | null>(null);
  const [conflict, setConflict] = useState(false);

  // Calendar colours for the visible month (only the bookable part of it).
  const range = monthRange(month);
  const from = range.from < today ? today : range.from;
  const to = range.to > lastDay ? lastDay : range.to;
  const days = useQuery({
    queryKey: ['days', sport, from, to],
    queryFn: () => api.days(sport, from, to),
    enabled: from <= to,
  });
  const statuses: Record<string, DayStatus> = Object.fromEntries((days.data?.days ?? []).map((d) => [d.date, d.status]));
  const nextAvailable = days.data?.days.find((d) => d.date > date && (d.status === 'available' || d.status === 'limited'))?.date;

  const availability = useQuery({
    queryKey: ['availability', date, sport],
    queryFn: () => api.availability(date, sport),
    refetchInterval: 60_000,
  });
  const data = availability.data;
  const options = data ? startOptions(data, duration) : [];
  const minPrice = data ? lowestHourly(data.prices) : null;

  const pickDate = (d: string) => {
    setDate(d);
    setMonth(d.slice(0, 7));
    setConflict(false);
  };

  return (
    <div className="space-y-8">
      <section>
        <StepTitle n={1}>{m.booking.stepSport}</StepTitle>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={m.booking.stepSport}>
          {SPORTS.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={sport === s.value}
              onClick={() => setSport(s.value)}
              className={`rounded-full border px-5 py-2.5 text-sm font-semibold transition-colors ${
                sport === s.value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-500'
              }`}
            >
              <span aria-hidden="true">{s.icon}</span> {m.sports[s.value]}
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_1fr] lg:items-start">
        <section>
          <StepTitle n={2}>{m.booking.stepDay}</StepTitle>
          <MonthCalendar
            month={month}
            onMonthChange={setMonth}
            minMonth={today.slice(0, 7)}
            maxMonth={lastDay.slice(0, 7)}
            statuses={statuses}
            value={date}
            onChange={pickDate}
            loading={days.isFetching}
          />
        </section>

        <section aria-live="polite">
          <StepTitle n={3}>{m.booking.chooseTime}</StepTitle>
          <div className="mb-4">
            <p className="text-lg font-semibold first-letter:uppercase">{formatDateLong(date, m.locale)}</p>
            {data?.hours && (
              <p className="text-sm text-slate-500">
                {m.booking.open(minuteLabel(data.hours.openMinute), minuteLabel(data.hours.closeMinute))}
                {minPrice !== null && ` · ${m.booking.fromPrice(formatPrice(minPrice, data.currency))}`}
              </p>
            )}
          </div>

          <div className="mb-5">
            <p className="mb-2 text-sm font-medium text-slate-700">{m.booking.stepDuration}</p>
            <div className="grid max-w-sm grid-cols-3 gap-2" role="radiogroup" aria-label={m.booking.stepDuration}>
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={duration === d}
                  onClick={() => setDuration(d)}
                  className={`rounded-xl border py-2.5 text-sm font-bold transition-colors ${
                    duration === d ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-emerald-500'
                  }`}
                >
                  {d} {m.common.min}
                </button>
              ))}
            </div>
          </div>

          {conflict && (
            <div className="mb-4">
              <ErrorMessage>{m.errors.conflict}</ErrorMessage>
            </div>
          )}
          {availability.isLoading && (
            <Card>
              <Spinner label={m.common.loading} />
              <SlowNotice />
            </Card>
          )}
          {availability.isError && <ErrorMessage>{errorText(availability.error, m.errors)}</ErrorMessage>}
          {data && !data.hours && <Card>{m.booking.closed}</Card>}
          {data && data.hours && data.courts.length === 0 && <Card>{m.booking.noCourts}</Card>}
          {data && data.hours && data.courts.length > 0 && options.length === 0 && (
            <Card className="space-y-3">
              <p>{m.booking.noTimesForDuration}</p>
              {nextAvailable && <Button onClick={() => pickDate(nextAvailable)}>{m.booking.nextAvailable} →</Button>}
            </Card>
          )}
          {data && options.length > 0 && (
            <TimePicker
              key={`${date}-${sport}-${duration}`}
              data={data}
              duration={duration}
              onBook={(court, slotIndex) => {
                setConflict(false);
                setSelection({ court, slotIndex });
              }}
            />
          )}
        </section>
      </div>

      {data && data.prices.length > 0 && (
        <Card>
          <h2 className="mb-3 text-lg font-semibold">
            {m.booking.prices} · {m.sports[sport]}
          </h2>
          <PriceList prices={data.prices} currency={data.currency} />
        </Card>
      )}

      {data && selection && (
        <BookingDialog
          data={data}
          court={selection.court}
          slotIndex={selection.slotIndex}
          initialDuration={duration}
          rememberable={rememberCustomer}
          onClose={() => setSelection(null)}
          onBooked={onBooked}
          onConflict={() => {
            setSelection(null);
            setConflict(true);
            void availability.refetch();
            void days.refetch();
          }}
        />
      )}
    </div>
  );
}
