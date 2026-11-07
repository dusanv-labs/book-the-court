import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useI18n } from '../i18n/context';
import { api, ApiError, errorText } from '../lib/api';
import { loadCustomer, saveCustomer, type CustomerDetails } from '../lib/customer';
import { previewPrice } from '../lib/pricing';
import { formatDayOf, formatPrice, formatTime, possibleDurations } from '../lib/time';
import type { Availability, AvailabilityCourt, BookingResult } from '../lib/types';
import { Button, ErrorMessage, Field, inputClass, Spinner } from './ui';

export function BookingDialog({
  data,
  court,
  slotIndex,
  rememberable,
  onClose,
  onBooked,
  onConflict,
}: {
  data: Availability;
  court: AvailabilityCourt;
  slotIndex: number;
  /** Offer "remember my details" (public booking only, not for admins entering customer data). */
  rememberable: boolean;
  onClose: () => void;
  onBooked: (result: BookingResult) => void;
  onConflict: () => void;
}) {
  const { m } = useI18n();
  const options = possibleDurations(court.slots, slotIndex, data.durations, data.slotMinutes);
  const [duration, setDuration] = useState(options[0] ?? data.durations[0]);
  const startsAt = court.slots[slotIndex].startsAt;
  const dialogRef = useRef<HTMLDivElement>(null);
  const saved = rememberable ? loadCustomer() : null;
  const [remember, setRemember] = useState(saved !== null);

  const schema = useMemo(
    () =>
      z.object({
        customerName: z.string().trim().min(2, m.dialog.errName).max(80),
        customerEmail: z.email(m.dialog.errEmail),
        customerPhone: z
          .string()
          .trim()
          .regex(/^\+?[0-9 ()/-]{6,20}$/, m.dialog.errPhone),
      }),
    [m],
  );

  const quote = useQuery({
    queryKey: ['quote', court.id, startsAt, duration],
    queryFn: () => api.quote(court.id, startsAt, duration),
    enabled: options.includes(duration),
    placeholderData: (previous) => previous,
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CustomerDetails>({ resolver: zodResolver(schema), defaultValues: saved ?? undefined });

  const booking = useMutation({
    mutationFn: (values: CustomerDetails) => api.createBooking({ courtId: court.id, startsAt, durationMinutes: duration, ...values }),
    onSuccess: (result, values) => {
      if (rememberable) saveCustomer(remember ? values : null);
      onBooked(result);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) onConflict();
    },
  });

  // Focus the dialog when it opens and close it with Escape.
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('[aria-pressed="true"], button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Show the local price preview immediately; the server quote confirms it (and the server sets the final price).
  const currentQuote = quote.data && quote.data.startsAt === startsAt && !quote.isPlaceholderData ? quote.data : null;
  const previewAmount = previewPrice(startsAt, duration, data.prices, data.timezone);
  const amount = currentQuote?.price ?? previewAmount;
  const price = amount !== null ? formatPrice(amount, data.currency) : null;
  const endsAt = new Date(new Date(startsAt).getTime() + duration * 60_000).toISOString();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-title"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="booking-title" className="text-xl font-bold">
              {m.dialog.title(court.name)}
            </h2>
            <p className="text-sm text-slate-600 first-letter:uppercase">
              {m.dialog.when(formatDayOf(startsAt, data.timezone, m.locale), formatTime(startsAt, data.timezone))}
            </p>
          </div>
          <Button variant="ghost" onClick={onClose} aria-label={m.common.close} className="px-2">
            ✕
          </Button>
        </div>

        <fieldset className="mb-5">
          <legend className="mb-2 text-sm font-semibold text-slate-800">{m.dialog.duration}</legend>
          <div className="grid grid-cols-3 gap-2">
            {data.durations.map((d) => {
              const available = options.includes(d);
              const preview = available ? previewPrice(startsAt, d, data.prices, data.timezone) : null;
              const selected = duration === d && available;
              return (
                <button
                  key={d}
                  type="button"
                  disabled={!available}
                  aria-pressed={selected}
                  onClick={() => setDuration(d)}
                  className={`flex flex-col items-center rounded-xl border px-2 py-2.5 transition-colors ${
                    selected
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : available
                        ? 'border-slate-300 bg-white hover:border-emerald-500'
                        : 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
                  }`}
                >
                  <span className="text-sm font-bold">
                    {d} {m.common.min}
                  </span>
                  <span className={`text-xs ${selected ? 'text-emerald-100' : 'text-slate-500'}`}>
                    {available ? (preview !== null ? formatPrice(preview, data.currency) : '—') : m.dialog.unavailable}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="mb-5 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
          <span className="text-sm text-slate-600">
            {formatTime(startsAt, data.timezone)} – {formatTime(endsAt, data.timezone)}
            <span className="block text-xs text-slate-500">{m.dialog.payAtVenue}</span>
          </span>
          <span className="text-lg font-bold">{price ?? (quote.isLoading ? <Spinner label="" /> : '—')}</span>
        </div>
        {quote.isError && (
          <div className="mb-4">
            <ErrorMessage>{errorText(quote.error, m.errors)}</ErrorMessage>
          </div>
        )}

        <form className="space-y-4" onSubmit={handleSubmit((v) => booking.mutate(v))} noValidate>
          <p className="text-sm font-semibold text-slate-800">{m.dialog.yourDetails}</p>
          <Field label={m.dialog.name} error={errors.customerName?.message}>
            <input className={inputClass} autoComplete="name" aria-invalid={!!errors.customerName} {...register('customerName')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={m.dialog.email} error={errors.customerEmail?.message}>
              <input className={inputClass} type="email" autoComplete="email" aria-invalid={!!errors.customerEmail} {...register('customerEmail')} />
            </Field>
            <Field label={m.dialog.phone} error={errors.customerPhone?.message}>
              <input
                className={inputClass}
                type="tel"
                autoComplete="tel"
                placeholder={m.dialog.phonePlaceholder}
                aria-invalid={!!errors.customerPhone}
                {...register('customerPhone')}
              />
            </Field>
          </div>
          {rememberable && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              {m.dialog.remember}
            </label>
          )}

          {booking.isError && <ErrorMessage>{errorText(booking.error, m.errors)}</ErrorMessage>}

          <Button type="submit" className="w-full py-3 text-base" disabled={booking.isPending || quote.isError || !options.includes(duration)}>
            {booking.isPending ? m.dialog.submitting : m.dialog.submit(price ?? '…')}
          </Button>
          <p className="text-center text-xs text-slate-500">{m.dialog.note}</p>
        </form>
      </div>
    </div>
  );
}
