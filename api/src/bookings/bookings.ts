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
import { addMinutes, dayOfWeekOf, localToUtc } from '../common/time.js';
import { isOverlapViolation, isUniqueViolation, PrismaService } from '../prisma/prisma.service.js';
import { generateBookingCode, generateCancelToken } from './domain/codes.js';
import { MissingPriceRuleError, quotePrice } from './domain/pricing.js';
import {
  ALLOWED_DURATIONS,
  checkBookingRequest,
  courtDaySlots,
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
});
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/, 'Invalid token');
const adminBookingsQuerySchema = z.object({ date: dateSchema });

type CreateBookingDto = z.infer<typeof createBookingSchema>;

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private get tz() {
    return this.config.TIMEZONE;
  }

  private async hoursMap(): Promise<(dow: number) => DayHours | null> {
    const rows = await this.prisma.openingHours.findMany();
    const byDay = new Map(rows.map((r) => [r.dayOfWeek, r]));
    return (dow) => byDay.get(dow) ?? null;
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
        where: { status: 'CONFIRMED', courtId: { in: courtIds }, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
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
        where: { courtId, status: 'CONFIRMED', startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
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
          },
        });
        return {
          code: booking.code,
          cancelToken: booking.cancelToken,
          court: { id: court.id, name: court.name, sport: court.sport },
          startsAt: booking.startsAt,
          endsAt: booking.endsAt,
          price: booking.price,
          currency: CURRENCY,
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

  async findByToken(token: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { cancelToken: token },
      include: { court: { select: { name: true, sport: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found.');
    return {
      code: booking.code,
      court: booking.court,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      price: booking.price,
      currency: CURRENCY,
      status: booking.status,
      customerName: booking.customerName,
      canCancel: booking.status === 'CONFIRMED' && this.beforeCutoff(booking.startsAt),
      cancelCutoffMinutes: CANCEL_CUTOFF_MINUTES,
    };
  }

  async cancelByToken(token: string) {
    const booking = await this.prisma.booking.findUnique({ where: { cancelToken: token } });
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.status === 'CANCELLED') return { status: booking.status };
    if (!this.beforeCutoff(booking.startsAt)) {
      throw new BadRequestException(
        `Online cancellation is possible until ${CANCEL_CUTOFF_MINUTES / 60} hours before the start.`,
      );
    }
    return this.markCancelled(booking.id);
  }

  listForDay(date: string) {
    const dayStart = localToUtc(date, 0, this.tz);
    const dayEnd = localToUtc(date, 24 * 60, this.tz);
    return this.prisma.booking.findMany({
      where: { startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
      orderBy: [{ startsAt: 'asc' }],
      select: {
        id: true,
        code: true,
        startsAt: true,
        endsAt: true,
        price: true,
        status: true,
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
    if (booking.status === 'CANCELLED') return { status: booking.status };
    return this.markCancelled(id);
  }

  private async markCancelled(id: string) {
    const updated = await this.prisma.booking.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    return { status: updated.status };
  }

  private beforeCutoff(startsAt: Date) {
    return startsAt.getTime() - Date.now() > CANCEL_CUTOFF_MINUTES * 60_000;
  }
}

@ApiTags('bookings')
@Controller()
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

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
  @ApiOperation({ summary: 'Create a booking. Returns a booking code and a token for the manage/cancel link.' })
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
  imports: [AuthModule],
  controllers: [BookingsController, AdminBookingsController],
  providers: [BookingsService],
})
export class BookingsModule {}
