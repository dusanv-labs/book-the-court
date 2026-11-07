import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/context';
import { api, errorText } from '../lib/api';
import { lowestHourly } from '../lib/pricing';
import { addDays, formatDateLong, formatPrice, formatTime, minuteLabel, possibleDurations, todayIn, VENUE_TZ } from '../lib/time';
import { SPORTS, type Availability, type AvailabilityCourt, type BookingResult, type Sport } from '../lib/types';
import { BookingDialog } from './BookingDialog';
import { DateStrip } from './DateStrip';
import { PriceList } from './PriceList';
import { Button, Card, ErrorMessage, SlowNotice, Spinner } from './ui';

type Part = 'all' | 'morning' | 'afternoon' | 'evening';

const partOf = (time: string): Exclude<Part, 'all'> => {
  const hour = Number(time.slice(0, 2));
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
};

interface StartTime {
  index: number;
  time: string;
}

/** Bookable start times: free slots with room for at least the shortest duration. */
function startTimes(court: AvailabilityCourt, data: Availability): StartTime[] {
  const shortest = Math.min(...data.durations);
  return court.slots
    .map((slot, index) => ({ index, time: formatTime(slot.startsAt, data.timezone) }))
    .filter(({ index }) => possibleDurations(court.slots, index, [shortest], data.slotMinutes).length > 0);
}

function StepTitle({ n, children }: { n: number; children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs text-white">{n}</span>
      {children}
    </h2>
  );
}

/** Sport → day → start time → booking dialog. Used by the public booking page and the admin "new booking" page. */
export function SlotBrowser({ onBooked, rememberCustomer }: { onBooked: (result: BookingResult) => void; rememberCustomer: boolean }) {
  const { m } = useI18n();
  const today = todayIn(VENUE_TZ);
  const [sport, setSport] = useState<Sport>('PADEL');
  const [date, setDate] = useState(today);
  const [part, setPart] = useState<Part>('all');
  const [selection, setSelection] = useState<{ court: AvailabilityCourt; slotIndex: number } | null>(null);
  const [conflict, setConflict] = useState(false);

  const availability = useQuery({
    queryKey: ['availability', date, sport],
    queryFn: () => api.availability(date, sport),
    refetchInterval: 60_000,
  });
  const data = availability.data;

  const courts = (data?.courts ?? []).map((court) => {
    const all = data ? startTimes(court, data) : [];
    return { court, all, shown: part === 'all' ? all : all.filter((s) => partOf(s.time) === part) };
  });
  const totalFree = courts.reduce((n, c) => n + c.all.length, 0);
  const shownFree = courts.reduce((n, c) => n + c.shown.length, 0);
  const minPrice = data ? lowestHourly(data.prices) : null;

  const parts: [Part, string][] = [
    ['all', m.booking.partAll],
    ['morning', m.booking.partMorning],
    ['afternoon', m.booking.partAfternoon],
    ['evening', m.booking.partEvening],
  ];

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

      <section>
        <StepTitle n={2}>{m.booking.stepDay}</StepTitle>
        <DateStrip start={today} value={date} onChange={setDate} />
      </section>

      <section aria-live="polite">
        <StepTitle n={3}>{m.booking.stepTime}</StepTitle>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-lg font-semibold first-letter:uppercase">{formatDateLong(date, m.locale)}</p>
            {data?.hours && (
              <p className="text-sm text-slate-500">
                {m.booking.open(minuteLabel(data.hours.openMinute), minuteLabel(data.hours.closeMinute))}
                {minPrice !== null && ` · ${m.booking.fromPrice(formatPrice(minPrice, data.currency))}`}
              </p>
            )}
          </div>
          {data?.hours && totalFree > 0 && (
            <div className="flex rounded-xl border border-slate-200 bg-white p-1" role="radiogroup" aria-label={m.booking.stepTime}>
              {parts.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={part === value}
                  onClick={() => setPart(value)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${part === value ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {conflict && <div className="mb-4"><ErrorMessage>{m.errors.conflict}</ErrorMessage></div>}

        {availability.isLoading && (
          <Card>
            <Spinner label={m.common.loading} />
            <SlowNotice />
          </Card>
        )}
        {availability.isError && <ErrorMessage>{errorText(availability.error, m.errors)}</ErrorMessage>}
        {data && !data.hours && <Card>{m.booking.closed}</Card>}
        {data && data.hours && data.courts.length === 0 && <Card>{m.booking.noCourts}</Card>}

        {data && data.hours && data.courts.length > 0 && totalFree === 0 && (
          <Card className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p>{m.booking.noneToday}</p>
            <Button onClick={() => setDate(addDays(date, 1))}>{m.booking.tryNextDay} →</Button>
          </Card>
        )}
        {data && totalFree > 0 && shownFree === 0 && <Card>{m.booking.noneInPart}</Card>}

        {data && totalFree > 0 && shownFree > 0 && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {courts.map(({ court, all, shown }) => (
              <Card key={court.id} className="flex flex-col">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-slate-900">{court.name}</h3>
                    <p className="text-xs text-slate-500">{court.indoor ? m.common.indoor : m.common.outdoor}</p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${all.length ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                  >
                    {all.length ? m.booking.freeCount(all.length) : m.booking.fullyBooked}
                  </span>
                </div>
                {shown.length > 0 ? (
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-4">
                    {shown.map(({ index, time }) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => {
                          setConflict(false);
                          setSelection({ court, slotIndex: index });
                        }}
                        aria-label={m.booking.bookAt(court.name, time)}
                        className="rounded-lg border border-emerald-200 bg-emerald-50 py-2 text-sm font-semibold text-emerald-800 transition-colors hover:border-emerald-600 hover:bg-emerald-600 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                      >
                        {time}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">{all.length ? m.booking.noneInPart : m.booking.fullyBooked}</p>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

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
          rememberable={rememberCustomer}
          onClose={() => setSelection(null)}
          onBooked={onBooked}
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
