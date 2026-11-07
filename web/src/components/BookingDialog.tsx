import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api, ApiError, errorText } from '../lib/api';
import { formatDayOf, formatPrice, formatTime, possibleDurations } from '../lib/time';
import type { Availability, AvailabilityCourt, BookingResult } from '../lib/types';
import { Button, ErrorMessage, Field, inputClass, Spinner } from './ui';

const formSchema = z.object({
  customerName: z.string().trim().min(2, 'Please enter your name').max(80),
  customerEmail: z.email('Please enter a valid email'),
  customerPhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()/-]{6,20}$/, 'Please enter a valid phone number'),
});
type FormValues = z.infer<typeof formSchema>;

export function BookingDialog({
  data,
  court,
  slotIndex,
  onClose,
  onBooked,
  onConflict,
}: {
  data: Availability;
  court: AvailabilityCourt;
  slotIndex: number;
  onClose: () => void;
  onBooked: (result: BookingResult) => void;
  onConflict: () => void;
}) {
  const options = possibleDurations(court.slots, slotIndex, data.durations, data.slotMinutes);
  const [duration, setDuration] = useState(options[0] ?? data.durations[0]);
  const startsAt = court.slots[slotIndex].startsAt;
  const dialogRef = useRef<HTMLDivElement>(null);

  const quote = useQuery({
    queryKey: ['quote', court.id, startsAt, duration],
    queryFn: () => api.quote(court.id, startsAt, duration),
    enabled: options.includes(duration),
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  const booking = useMutation({
    mutationFn: (values: FormValues) => api.createBooking({ courtId: court.id, startsAt, durationMinutes: duration, ...values }),
    onSuccess: onBooked,
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) onConflict();
    },
  });

  // Close on Escape and keep focus inside the dialog when it opens.
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('input, button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const endsAt = quote.data?.endsAt;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-title"
        className="max-h-[95vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="booking-title" className="text-xl font-bold">
              Book {court.name}
            </h2>
            <p className="text-sm text-slate-600">
              {formatDayOf(startsAt, data.timezone)} · starts at {formatTime(startsAt, data.timezone)}
            </p>
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="Close" className="px-2">
            ✕
          </Button>
        </div>

        <fieldset className="mb-5">
          <legend className="mb-2 text-sm font-medium text-slate-700">Duration</legend>
          <div className="grid grid-cols-3 gap-2">
            {data.durations.map((d) => {
              const available = options.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  disabled={!available}
                  aria-pressed={duration === d}
                  onClick={() => setDuration(d)}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                    duration === d && available
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : available
                        ? 'border-slate-300 bg-white hover:border-emerald-500'
                        : 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 line-through'
                  }`}
                >
                  {d} min
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="mb-5 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
          <span className="text-sm text-slate-600">
            {endsAt
              ? `${formatTime(startsAt, data.timezone)} – ${formatTime(endsAt, data.timezone)}`
              : `${formatTime(startsAt, data.timezone)}`}
          </span>
          <span className="text-lg font-bold">
            {quote.isLoading ? <Spinner label="Price" /> : quote.data ? formatPrice(quote.data.price, quote.data.currency) : '—'}
          </span>
        </div>
        {quote.isError && <ErrorMessage>{errorText(quote.error)}</ErrorMessage>}

        <form className="space-y-4" onSubmit={handleSubmit((v) => booking.mutate(v))} noValidate>
          <Field label="Full name" error={errors.customerName?.message}>
            <input className={inputClass} autoComplete="name" aria-invalid={!!errors.customerName} {...register('customerName')} />
          </Field>
          <Field label="Email" error={errors.customerEmail?.message}>
            <input
              className={inputClass}
              type="email"
              autoComplete="email"
              aria-invalid={!!errors.customerEmail}
              {...register('customerEmail')}
            />
          </Field>
          <Field label="Phone" error={errors.customerPhone?.message}>
            <input
              className={inputClass}
              type="tel"
              autoComplete="tel"
              placeholder="+381 64 123 4567"
              aria-invalid={!!errors.customerPhone}
              {...register('customerPhone')}
            />
          </Field>

          {booking.isError && <ErrorMessage>{errorText(booking.error)}</ErrorMessage>}

          <Button type="submit" className="w-full py-3 text-base" disabled={booking.isPending || !quote.data}>
            {booking.isPending ? 'Booking…' : quote.data ? `Confirm booking · ${formatPrice(quote.data.price, quote.data.currency)}` : 'Confirm booking'}
          </Button>
          <p className="text-center text-xs text-slate-500">
            Demo app: no payment is taken and no email is sent.
          </p>
        </form>
      </div>
    </div>
  );
}
