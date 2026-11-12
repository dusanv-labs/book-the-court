import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { AdminGuard, AuthModule } from '../auth/auth.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { dateSchema, idSchema, sportSchema } from '../common/schemas.js';
import { addMinutes, dayOfWeekOf, localToUtc, toLocalParts } from '../common/time.js';
import type { Booking } from '../generated/prisma/client.js';
import { HOLD_MINUTES, PaymentsModule, PaymentsService } from '../payments/payments.js';
import { isOverlapViolation, isUniqueViolation, PrismaService } from '../prisma/prisma.service.js';
import { occupyingBookings } from './active.js';
import { generateBookingCode, generateCancelToken } from './domain/codes.js';
import { MissingPriceRuleError, quotePrice } from './domain/pricing.js';
import {
  ALLOWED_DURATIONS,
  checkBookingRequest,
  countBookableStarts,
  courtDaySlots,
  dayStatus,
  type DayStatus,
  MAX_DAYS_AHEAD,
  type DayHours,
  type Interval,
  REJECTION_MESSAGES,
  SLOT_MINUTES,
} from './domain/slots.js';

/** Customers can cancel online until this many minutes before the start. */
export const CANCEL_CUTOFF_MINUTES = 120;
const CURRENCY = 'RSD';

const durationSchema = z.coerce
  .number()
  .int()
  .refine((d) => (ALLOWED_DURATIONS as readonly number[]).includes(d), `Allowed durations: ${ALLOWED_DURATIONS.join(', ')}`);
const startsAtSchema = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const availabilityQuerySchema = z.object({ date: dateSchema, sport: sportSchema });
const MAX_SUMMARY_DAYS = 62;
const daysQuerySchema = z
  .object({ sport: sportSchema, from: dateSchema, to: dateSchema })
  .refine((q) => q.from <= q.to, 'from must not be after to')
  .refine(
    (q) => (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) / 86_400_000 < MAX_SUMMARY_DAYS,
    `At most ${MAX_SUMMARY_DAYS} days per request`,
  );
const quoteQuerySchema = z.object({ courtId: idSchema, startsAt: startsAtSchema, durationMinutes: durationSchema });
const createBookingSchema = z.object({
  courtId: idSchema,
  startsAt: startsAtSchema,
  durationMinutes: durationSchema,
  customerName: z.string().trim().min(2).max(80),
  customerEmail: z.email().max(200).transform((e) => e.toLowerCase()),
  customerPhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()/-]{6,20}$/, 'Invalid phone number'),
  /** "online" opens a Stripe payment page; the court is held until the payment is finished. */
  payment: z.enum(['venue', 'online']).default('venue'),
});
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/, 'Invalid token');
const adminBookingsQuerySchema = z.object({ date: dateSchema });

type CreateBookingDto = z.infer<typeof createBookingSchema>;

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly payments: PaymentsService,
  ) {}

  private get tz() {
    return this.config.TIMEZONE;
  }

  private async hoursMap(): Promise<(dow: number) => DayHours | null> {
    const rows = await this.prisma.openingHours.findMany();
    const byDay = new Map(rows.map((r) => [r.dayOfWeek, r]));
    return (dow) => byDay.get(dow) ?? null;
  }

  /** Per-day status for a calendar: available / limited / full / closed / past / unavailable. */
  async daysSummary(sport: z.infer<typeof sportSchema>, from: string, to: string) {
    const hoursFor = await this.hoursMap();
    const rangeStart = localToUtc(from, 0, this.tz);
    const rangeEnd = localToUtc(to, 24 * 60, this.tz);
    const courts = await this.prisma.court.findMany({ where: { active: true, sport }, select: { id: true } });
    const courtIds = courts.map((c) => c.id);
    const [bookings, blocks] = await Promise.all([
      this.prisma.booking.findMany({
        where: { ...occupyingBookings(), courtId: { in: courtIds }, startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } },
        select: { courtId: true, startsAt: true, endsAt: true },
      }),
      this.prisma.block.findMany({
        where: { OR: [{ courtId: { in: courtIds } }, { courtId: null }], startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } },
        select: { courtId: true, startsAt: true, endsAt: true },
      }),
    ]);
    const now = new Date();
    const lastBookable = toLocalParts(addMinutes(now, MAX_DAYS_AHEAD * 24 * 60), this.tz).date;

    const days: { date: string; status: DayStatus; freeStarts: number }[] = [];
    for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      if (date > lastBookable) {
        days.push({ date, status: 'unavailable', freeStarts: 0 });
        continue;
      }
      const hours = hoursFor(dayOfWeekOf(date, this.tz));
      const open = !!hours && !hours.closed && courtIds.length > 0;
      let freeStarts = 0;
      let remainingStarts = 0;
      if (open) {
        const dayStart = localToUtc(date, 0, this.tz);
        const dayEnd = localToUtc(date, 24 * 60, this.tz);
        const inDay = (i: Interval) => i.startsAt < dayEnd && i.endsAt > dayStart;
        for (const courtId of courtIds) {
          const slots = courtDaySlots({
            date,
            hours,
            bookings: bookings.filter((b) => b.courtId === courtId && inDay(b)),
            blocks: blocks.filter((b) => (b.courtId === null || b.courtId === courtId) && inDay(b)),
            now,
            tz: this.tz,
          });
          freeStarts += countBookableStarts(slots);
          remainingStarts += countBookableStarts(slots.map((s) => ({ ...s, status: s.status === 'past' ? 'past' : 'free' })));
        }
      }
      days.push({ date, status: dayStatus({ open, freeStarts, remainingStarts }), freeStarts });
    }
    return { sport, from, to, maxDaysAhead: MAX_DAYS_AHEAD, days };
  }

  async availability(date: string, sport: z.infer<typeof sportSchema>) {
    const hoursFor = await this.hoursMap();
    const hours = hoursFor(dayOfWeekOf(date, this.tz));
    const dayStart = localToUtc(date, 0, this.tz);
    const dayEnd = localToUtc(date, 24 * 60, this.tz);
    const courts = await this.prisma.court.findMany({
      where: { active: true, sport },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, indoor: true },
    });
    const courtIds = courts.map((c) => c.id);
    const [bookings, blocks, rules] = await Promise.all([
      this.prisma.booking.findMany({
        where: { ...occupyingBookings(), courtId: { in: courtIds }, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
        select: { courtId: true, startsAt: true, endsAt: true },
      }),
      this.prisma.block.findMany({
        where: { OR: [{ courtId: { in: courtIds } }, { courtId: null }], startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
        select: { courtId: true, startsAt: true, endsAt: true },
      }),
      this.prisma.priceRule.findMany({ where: { sport } }),
    ]);
    const now = new Date();
    return {
      date,
      sport,
      timezone: this.tz,
      slotMinutes: SLOT_MINUTES,
      durations: ALLOWED_DURATIONS,
      currency: CURRENCY,
      onlinePayment: this.payments.enabled,
      hours: hours && !hours.closed ? { openMinute: hours.openMinute, closeMinute: hours.closeMinute } : null,
      prices: rules.map(({ dayType, startMinute, endMinute, pricePerHour }) => ({ dayType, startMinute, endMinute, pricePerHour })),
      courts: courts.map((court) => ({
        ...court,
        slots: courtDaySlots({
          date,
          hours,
          bookings: bookings.filter((b) => b.courtId === court.id),
          blocks: blocks.filter((b) => b.courtId === null || b.courtId === court.id),
          now,
          tz: this.tz,
        }),
      })),
    };
  }

  /** Validates a requested booking against current data and returns its price. Throws HTTP errors. */
  private async evaluate(courtId: string, startsAt: Date, durationMinutes: number) {
    const court = await this.prisma.court.findFirst({ where: { id: courtId, active: true } });
    if (!court) throw new NotFoundException('Court not found.');
    const endsAt = addMinutes(startsAt, durationMinutes);
    const [hoursFor, bookings, blocks, rules] = await Promise.all([
      this.hoursMap(),
      this.prisma.booking.findMany({
        where: { ...occupyingBookings(), courtId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
        select: { startsAt: true, endsAt: true },
      }),
      this.prisma.block.findMany({
        where: { OR: [{ courtId }, { courtId: null }], startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
        select: { startsAt: true, endsAt: true },
      }),
      this.prisma.priceRule.findMany({ where: { sport: court.sport } }),
    ]);
    const check = checkBookingRequest({
      startsAt,
      durationMinutes,
      hoursForDay: hoursFor,
      bookings: bookings as Interval[],
      blocks: blocks as Interval[],
      now: new Date(),
      tz: this.tz,
    });
    if (!check.ok) {
      const message = REJECTION_MESSAGES[check.reason];
      if (check.reason === 'CONFLICT' || check.reason === 'BLOCKED') throw new ConflictException(message);
      throw new BadRequestException(message);
    }
    let price: number;
    try {
      price = quotePrice({ sport: court.sport, startsAt, durationMinutes, rules, tz: this.tz });
    } catch (e) {
      if (e instanceof MissingPriceRuleError) throw new BadRequestException('No price is defined for this time.');
      throw e;
    }
    return { court, endsAt: check.endsAt, price };
  }

  async quote(courtId: string, startsAt: Date, durationMinutes: number) {
    const { endsAt, price } = await this.evaluate(courtId, startsAt, durationMinutes);
    return { courtId, startsAt, endsAt, durationMinutes, price, currency: CURRENCY };
  }

  async create(dto: CreateBookingDto) {
    const online = dto.payment === 'online';
    if (online && !this.payments.enabled) throw new BadRequestException('Online payment is not available.');
    // Courts held for payments that were never finished must not block this booking.
    await this.payments.releaseExpiredHolds();
    const { court, endsAt, price } = await this.evaluate(dto.courtId, dto.startsAt, dto.durationMinutes);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const booking = await this.prisma.booking.create({
          data: {
            code: generateBookingCode(),
            cancelToken: generateCancelToken(),
            courtId: court.id,
            startsAt: dto.startsAt,
            endsAt,
            customerName: dto.customerName,
            customerEmail: dto.customerEmail,
            customerPhone: dto.customerPhone,
            price,
            // An online booking holds the court until the payment is finished (or the hold runs out).
            ...(online ? { status: 'PENDING', paymentStatus: 'UNPAID', holdExpiresAt: addMinutes(new Date(), HOLD_MINUTES) } : {}),
          },
        });
        const checkoutUrl = online
          ? await this.payments.startCheckout(booking, this.paymentDescription(booking, court.name), CURRENCY)
          : null;
        return {
          code: booking.code,
          cancelToken: booking.cancelToken,
          court: { id: court.id, name: court.name, sport: court.sport },
          startsAt: booking.startsAt,
          endsAt: booking.endsAt,
          price: booking.price,
          currency: CURRENCY,
          status: booking.status,
          paymentStatus: booking.paymentStatus,
          checkoutUrl,
        };
      } catch (e) {
        // The database is the final guard against double booking (two requests at the same moment).
        if (isOverlapViolation(e)) throw new ConflictException(REJECTION_MESSAGES.CONFLICT);
        if (isUniqueViolation(e)) continue; // extremely rare code collision: try a new code
        throw e;
      }
    }
    throw new ConflictException('Could not create the booking. Please try again.');
  }

  private paymentDescription(booking: Booking, courtName: string) {
    const { date, minute } = toLocalParts(booking.startsAt, this.tz);
    const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    return `${courtName}, ${date} ${time} (booking ${booking.code})`;
  }

  async findByToken(token: string) {
    const find = () =>
      this.prisma.booking.findUnique({
        where: { cancelToken: token },
        include: { court: { select: { name: true, sport: true } } },
      });
    let booking = await find();
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.paymentStatus === 'UNPAID') {
      // The player may be back from the payment page before Stripe's webhook arrives: ask Stripe directly.
      await this.payments.refresh(booking);
      booking = (await find()) ?? booking;
    }
    const holding = booking.status === 'PENDING' && !!booking.holdExpiresAt && booking.holdExpiresAt > new Date();
    return {
      code: booking.code,
      court: booking.court,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      price: booking.price,
      currency: CURRENCY,
      status: holding || booking.status !== 'PENDING' ? booking.status : 'EXPIRED',
      paymentStatus: booking.paymentStatus,
      // Shown while the court is held, so the player can go back to the payment page.
      checkoutUrl: holding ? booking.checkoutUrl : null,
      holdExpiresAt: holding ? booking.holdExpiresAt : null,
      customerName: booking.customerName,
      canCancel: (booking.status === 'CONFIRMED' || holding) && this.beforeCutoff(booking.startsAt),
      cancelCutoffMinutes: CANCEL_CUTOFF_MINUTES,
    };
  }

  async cancelByToken(token: string) {
    const booking = await this.prisma.booking.findUnique({ where: { cancelToken: token } });
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.status === 'CANCELLED' || booking.status === 'EXPIRED') return { status: booking.status };
    if (!this.beforeCutoff(booking.startsAt)) {
      throw new BadRequestException(
        `Online cancellation is possible until ${CANCEL_CUTOFF_MINUTES / 60} hours before the start.`,
      );
    }
    return this.cancel(booking);
  }

  listForDay(date: string) {
    const dayStart = localToUtc(date, 0, this.tz);
    const dayEnd = localToUtc(date, 24 * 60, this.tz);
    return this.prisma.booking.findMany({
      // Unfinished online payments that released their court are left out.
      where: { startsAt: { lt: dayEnd }, endsAt: { gt: dayStart }, status: { not: 'EXPIRED' } },
      orderBy: [{ startsAt: 'asc' }],
      select: {
        id: true,
        code: true,
        startsAt: true,
        endsAt: true,
        price: true,
        status: true,
        paymentStatus: true,
        holdExpiresAt: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        createdAt: true,
        court: { select: { id: true, name: true, sport: true } },
      },
    });
  }

  async cancelById(id: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.status === 'CANCELLED' || booking.status === 'EXPIRED') return { status: booking.status };
    return this.cancel(booking);
  }

  /** Cancels a booking; one paid online is refunded first, one still being paid has its payment page closed. */
  private async cancel(booking: Booking, attempt = 0): Promise<{ status: Booking['status'] }> {
    if (booking.paymentStatus === 'PAID') {
      // Refund first: if it fails, the booking stays as it was and the player can simply try again.
      await this.payments.refundPaid(booking);
      const updated = await this.prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), paymentStatus: 'REFUNDED', refundedAt: new Date() },
      });
      return { status: updated.status };
    }
    // Only if nothing changed meanwhile (a payment could arrive at this very moment).
    const { count } = await this.prisma.booking.updateMany({
      where: { id: booking.id, status: booking.status, paymentStatus: booking.paymentStatus },
      data: { status: 'CANCELLED', cancelledAt: new Date(), holdExpiresAt: null },
    });
    if (count === 0) {
      const current = await this.prisma.booking.findUnique({ where: { id: booking.id } });
      if (!current || current.status === 'CANCELLED' || current.status === 'EXPIRED' || attempt > 0) {
        return { status: current?.status ?? 'CANCELLED' };
      }
      return this.cancel(current, attempt + 1);
    }
    if (booking.paymentStatus === 'UNPAID') await this.payments.closeCheckout(booking);
    return { status: 'CANCELLED' };
  }

  private beforeCutoff(startsAt: Date) {
    return startsAt.getTime() - Date.now() > CANCEL_CUTOFF_MINUTES * 60_000;
  }
}

@ApiTags('bookings')
@Controller()
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get('availability/days')
  @ApiOperation({ summary: 'Day-by-day status for a calendar (available, limited, full, closed, past, unavailable).' })
  days(@Query({ schema: daysQuerySchema }) q: z.infer<typeof daysQuerySchema>) {
    return this.bookings.daysSummary(q.sport, q.from, q.to);
  }

  @Get('availability')
  @ApiOperation({ summary: 'Courts × 30-minute slots for one sport and day, with free/booked/blocked/past status.' })
  availability(@Query({ schema: availabilityQuerySchema }) q: z.infer<typeof availabilityQuerySchema>) {
    return this.bookings.availability(q.date, q.sport);
  }

  @Get('bookings/quote')
  @ApiOperation({ summary: 'Check that a booking is possible and get its price.' })
  quote(@Query({ schema: quoteQuerySchema }) q: z.infer<typeof quoteQuerySchema>) {
    return this.bookings.quote(q.courtId, q.startsAt, q.durationMinutes);
  }

  @Post('bookings')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Create a booking. Returns a booking code and a token for the manage/cancel link. With payment "online" it also returns a Stripe payment page (checkoutUrl) and holds the court until the payment is finished.',
  })
  create(@Body({ schema: createBookingSchema }) body: CreateBookingDto) {
    return this.bookings.create(body);
  }

  @Get('bookings/manage/:token')
  @ApiOperation({ summary: 'Booking details for the manage/cancel link.' })
  manage(@Param('token', { schema: tokenSchema }) token: string) {
    return this.bookings.findByToken(token);
  }

  @Post('bookings/manage/:token/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a booking via its manage link.' })
  cancel(@Param('token', { schema: tokenSchema }) token: string) {
    return this.bookings.cancelByToken(token);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  @ApiOperation({ summary: 'All bookings of one local day, with customer details.' })
  list(@Query({ schema: adminBookingsQuerySchema }) q: z.infer<typeof adminBookingsQuerySchema>) {
    return this.bookings.listForDay(q.date);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', { schema: idSchema }) id: string) {
    return this.bookings.cancelById(id);
  }
}

@Module({
  imports: [AuthModule, PaymentsModule],
  controllers: [BookingsController, AdminBookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
