import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { BookingsService, CANCEL_CUTOFF_MINUTES } from '../bookings/bookings.js';
import { MissingPriceRuleError, quotePrice } from '../bookings/domain/pricing.js';
import { ALLOWED_DURATIONS, bookableStarts, MAX_DAYS_AHEAD, SLOT_MINUTES } from '../bookings/domain/slots.js';
import { dateSchema, idSchema, sportSchema } from '../common/schemas.js';
import { addMinutes, dayOfWeekOf, localToUtc, toLocalParts } from '../common/time.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { CourtsService } from '../courts/courts.js';
import { VenueService } from '../venue/venue.js';
import { type AgentTool, defineTool } from './agent.js';
import { formatMinute, timeOfDaySchema, WEEKDAYS } from './domain/conversation.js';

const CURRENCY = 'RSD';
const MAX_OVERVIEW_DAYS = 31;
const MAX_SLOT_OPTIONS = 40;
export const MAX_SUGGESTIONS = 4;

// Written as min/max/step (60, 90, 120) so the model sees a clear JSON Schema; the refine is the real check.
const durationSchema = z
  .number()
  .int()
  .min(Math.min(...ALLOWED_DURATIONS))
  .max(Math.max(...ALLOWED_DURATIONS))
  .multipleOf(SLOT_MINUTES)
  .refine((d) => (ALLOWED_DURATIONS as readonly number[]).includes(d), `Allowed durations: ${ALLOWED_DURATIONS.join(', ')}`)
  .describe(`Booking length in minutes: ${ALLOWED_DURATIONS.join(', ')}`);

/** A bookable option the page shows as a card with a "Book" button. Checked against live data before it is shown. */
export interface BookingSuggestion {
  courtId: string;
  courtName: string;
  sport: z.infer<typeof sportSchema>;
  indoor: boolean;
  date: string;
  startTime: string;
  endTime: string;
  startsAt: string;
  durationMinutes: number;
  price: number;
  currency: string;
}

/**
 * Read-only tools for the booking assistant. They use the same services as the public API and
 * return only public information (courts, hours, prices, free times) - never customer data.
 */
@Injectable()
export class AssistantToolbox {
  constructor(
    private readonly bookings: BookingsService,
    private readonly venue: VenueService,
    private readonly courts: CourtsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private get tz() {
    return this.config.TIMEZONE;
  }

  /** Tools for one request. Suggestions the model makes are collected in `suggestions`. */
  forRequest(suggestions: BookingSuggestion[]): AgentTool[] {
    return [this.venueInfo(), this.calendarOverview(), this.findSlots(), this.suggestOptions(suggestions)];
  }

  private venueInfo() {
    return defineTool({
      name: 'get_venue_info',
      description:
        'Courts (name, sport, indoor/outdoor), opening hours per weekday, hourly prices per sport and booking rules. ' +
        'Use it for questions about prices, hours, courts and rules.',
      input: z.object({}),
      run: async () => {
        const [courts, hours, prices] = await Promise.all([
          this.courts.listActive(),
          this.venue.openingHours(),
          this.venue.priceRules(),
        ]);
        return {
          courts: courts.map(({ name, sport, indoor }) => ({ name, sport, indoor })),
          openingHours: hours.map((h) => ({
            day: WEEKDAYS[h.dayOfWeek],
            ...(h.closed ? { closed: true } : { open: formatMinute(h.openMinute), close: formatMinute(h.closeMinute) }),
          })),
          prices: prices.map((p) => ({
            sport: p.sport,
            days: p.dayType === 'WEEKEND' ? 'Saturday-Sunday' : 'Monday-Friday',
            from: formatMinute(p.startMinute),
            to: formatMinute(p.endMinute),
            pricePerHour: p.pricePerHour,
          })),
          currency: CURRENCY,
          rules: {
            durationsMinutes: ALLOWED_DURATIONS,
            startTimes: `every ${SLOT_MINUTES} minutes (on the hour or half hour)`,
            bookAheadDays: MAX_DAYS_AHEAD,
            freeCancellation: `online, up to ${CANCEL_CUTOFF_MINUTES / 60} hours before the start, with the link from the confirmation`,
            pricing: 'each half hour is charged at the rate that applies to it, so a booking can mix two rates',
            payment: 'paid at the venue; this demo takes no payment and sends no email',
          },
        };
      },
    });
  }

  private calendarOverview() {
    return defineTool({
      name: 'get_calendar_overview',
      description:
        `Status of each day in a date range for one sport (at most ${MAX_OVERVIEW_DAYS} days): available, limited ` +
        '(few times left), full, closed, past or unavailable (too far ahead), with the number of free 60-minute start times. ' +
        'Use it to find which days have free courts.',
      input: z
        .object({
          sport: sportSchema,
          from: dateSchema.describe('First day, YYYY-MM-DD'),
          to: dateSchema.describe('Last day, YYYY-MM-DD'),
        })
        .refine((q) => q.from <= q.to, 'from must not be after to')
        .refine((q) => daysBetween(q.from, q.to) < MAX_OVERVIEW_DAYS, `At most ${MAX_OVERVIEW_DAYS} days`),
      run: async ({ sport, from, to }) => {
        const summary = await this.bookings.daysSummary(sport, from, to);
        return {
          sport,
          days: summary.days.map((d) => ({
            date: d.date,
            weekday: WEEKDAYS[dayOfWeekOf(d.date, this.tz)],
            status: d.status,
            freeStartTimes: d.freeStarts,
          })),
        };
      },
    });
  }

  private findSlots() {
    return defineTool({
      name: 'find_available_slots',
      description:
        'Free start times on one day for one sport and duration, per court, with the exact price. ' +
        'Optionally limited to a time window and indoor courts.',
      input: z.object({
        sport: sportSchema,
        date: dateSchema.describe('YYYY-MM-DD'),
        durationMinutes: durationSchema,
        earliestStart: timeOfDaySchema.optional().describe('Earliest start time, HH:MM'),
        latestStart: timeOfDaySchema.optional().describe('Latest start time, HH:MM'),
        indoorOnly: z.boolean().optional().describe('Only indoor (covered) courts'),
      }),
      run: async ({ sport, date, durationMinutes, earliestStart, latestStart, indoorOnly }) => {
        const outside = this.outsideBookingWindow(date);
        if (outside) return { date, options: [], note: outside };
        const [day, rules] = await Promise.all([this.bookings.availability(date, sport), this.venue.priceRules()]);
        if (!day.hours) return { date, weekday: WEEKDAYS[dayOfWeekOf(date, this.tz)], options: [], note: 'The venue is closed on this day.' };

        const options: { courtId: string; court: string; indoor: boolean; start: string; end: string; price: number }[] = [];
        for (const court of day.courts) {
          if (indoorOnly && !court.indoor) continue;
          for (const startsAt of bookableStarts(court.slots, durationMinutes)) {
            const minute = toLocalParts(startsAt, this.tz).minute;
            if (earliestStart !== undefined && minute < earliestStart) continue;
            if (latestStart !== undefined && minute > latestStart) continue;
            const price = this.priceOrNull(sport, startsAt, durationMinutes, rules);
            if (price === null) continue;
            options.push({
              courtId: court.id,
              court: court.name,
              indoor: court.indoor,
              start: formatMinute(minute),
              end: formatMinute(minute + durationMinutes),
              price,
            });
          }
        }
        options.sort((a, b) => a.start.localeCompare(b.start) || a.court.localeCompare(b.court));
        return {
          date,
          weekday: WEEKDAYS[dayOfWeekOf(date, this.tz)],
          openingHours: `${formatMinute(day.hours.openMinute)}-${formatMinute(day.hours.closeMinute)}`,
          currency: CURRENCY,
          options: options.slice(0, MAX_SLOT_OPTIONS),
          ...(options.length > MAX_SLOT_OPTIONS
            ? { note: `${options.length - MAX_SLOT_OPTIONS} more options not shown; narrow the time window.` }
            : {}),
          ...(options.length === 0 ? { note: 'No free courts for this duration and time window.' } : {}),
        };
      },
    });
  }

  private suggestOptions(suggestions: BookingSuggestion[]) {
    return defineTool({
      name: 'suggest_booking_options',
      description:
        `Show the visitor up to ${MAX_SUGGESTIONS} concrete options as cards with a "Book" button (the visitor completes ` +
        'the booking in the normal form). Use only options returned by find_available_slots. Each option is checked again; ' +
        'the result says which were shown.',
      input: z.object({
        options: z
          .array(
            z.object({
              courtId: idSchema,
              date: dateSchema.describe('YYYY-MM-DD'),
              startTime: timeOfDaySchema.describe('HH:MM'),
              durationMinutes: durationSchema,
            }),
          )
          .min(1)
          .max(MAX_SUGGESTIONS),
      }),
      run: async ({ options }) => {
        const courts = new Map((await this.courts.listActive()).map((c) => [c.id, c]));
        const rejected: { option: number; reason: string }[] = [];
        for (const [i, option] of options.entries()) {
          if (suggestions.length >= MAX_SUGGESTIONS) {
            rejected.push({ option: i + 1, reason: `At most ${MAX_SUGGESTIONS} options can be shown.` });
            continue;
          }
          const court = courts.get(option.courtId);
          const startsAt = localToUtc(option.date, option.startTime, this.tz);
          try {
            if (!court) throw new Error('Court not found.');
            const quote = await this.bookings.quote(option.courtId, startsAt, option.durationMinutes);
            suggestions.push({
              courtId: court.id,
              courtName: court.name,
              sport: court.sport,
              indoor: court.indoor,
              date: option.date,
              startTime: formatMinute(option.startTime),
              endTime: formatMinute(option.startTime + option.durationMinutes),
              startsAt: startsAt.toISOString(),
              durationMinutes: option.durationMinutes,
              price: quote.price,
              currency: quote.currency,
            });
          } catch (e) {
            rejected.push({ option: i + 1, reason: e instanceof Error ? e.message : 'Not available.' });
          }
        }
        return { shown: options.length - rejected.length, rejected };
      },
    });
  }

  private outsideBookingWindow(date: string): string | null {
    const now = new Date();
    if (date < toLocalParts(now, this.tz).date) return 'This date is in the past.';
    if (date > toLocalParts(addMinutes(now, MAX_DAYS_AHEAD * 24 * 60), this.tz).date) {
      return `Bookings open at most ${MAX_DAYS_AHEAD} days ahead.`;
    }
    return null;
  }

  private priceOrNull(
    sport: z.infer<typeof sportSchema>,
    startsAt: Date,
    durationMinutes: number,
    rules: Awaited<ReturnType<VenueService['priceRules']>>,
  ): number | null {
    try {
      return quotePrice({ sport, startsAt, durationMinutes, rules, tz: this.tz });
    } catch (e) {
      if (e instanceof MissingPriceRuleError) return null;
      throw e;
    }
  }
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}
