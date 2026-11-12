import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AdminGuard, AuthModule } from '../auth/auth.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { dateSchema, dayTypeSchema, idSchema, minuteSchema, sportSchema } from '../common/schemas.js';
import { localToUtc } from '../common/time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { occupyingBookings } from '../bookings/active.js';

// ---------- Opening hours ----------

const dayHoursSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    openMinute: minuteSchema,
    closeMinute: minuteSchema,
    closed: z.boolean().default(false),
  })
  .refine((d) => d.closed || d.closeMinute > d.openMinute, 'closeMinute must be after openMinute');

const openingHoursSchema = z
  .array(dayHoursSchema)
  .length(7)
  .refine((days) => new Set(days.map((d) => d.dayOfWeek)).size === 7, 'Each day of the week must appear once');

// ---------- Price rules ----------

const priceRuleSchema = z
  .object({
    sport: sportSchema,
    dayType: dayTypeSchema,
    startMinute: minuteSchema,
    endMinute: minuteSchema,
    pricePerHour: z.number().int().positive().max(1_000_000),
  })
  .refine((r) => r.endMinute > r.startMinute, 'endMinute must be after startMinute');

const priceRulesSchema = z
  .array(priceRuleSchema)
  .max(100)
  .refine((rules) => {
    for (const a of rules) {
      for (const b of rules) {
        if (a === b || a.sport !== b.sport || a.dayType !== b.dayType) continue;
        if (a.startMinute < b.endMinute && b.startMinute < a.endMinute) return false;
      }
    }
    return true;
  }, 'Price rules for the same sport and day type must not overlap');

// ---------- Blocks ----------

const createBlockSchema = z
  .object({
    courtId: idSchema.nullable().default(null),
    startsAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
    endsAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
    reason: z.string().trim().min(1).max(120),
  })
  .refine((b) => b.endsAt > b.startsAt, 'endsAt must be after startsAt');

// With a date: blocks on that local day. Without: all upcoming blocks.
const blocksQuerySchema = z.object({ date: dateSchema.optional() });

@Injectable()
export class VenueService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  openingHours() {
    return this.prisma.openingHours.findMany({ orderBy: { dayOfWeek: 'asc' } });
  }

  async setOpeningHours(days: z.infer<typeof openingHoursSchema>) {
    await this.prisma.$transaction(
      days.map((d) =>
        this.prisma.openingHours.upsert({ where: { dayOfWeek: d.dayOfWeek }, create: d, update: d }),
      ),
    );
    return this.openingHours();
  }

  priceRules() {
    return this.prisma.priceRule.findMany({
      orderBy: [{ sport: 'asc' }, { dayType: 'asc' }, { startMinute: 'asc' }],
    });
  }

  async setPriceRules(rules: z.infer<typeof priceRulesSchema>) {
    await this.prisma.$transaction([this.prisma.priceRule.deleteMany(), this.prisma.priceRule.createMany({ data: rules })]);
    return this.priceRules();
  }

  upcomingBlocks() {
    return this.prisma.block.findMany({
      where: { endsAt: { gt: new Date() } },
      orderBy: { startsAt: 'asc' },
      take: 200,
      include: { court: { select: { id: true, name: true } } },
    });
  }

  blocksOn(date: string) {
    const dayStart = localToUtc(date, 0, this.config.TIMEZONE);
    const dayEnd = localToUtc(date, 24 * 60, this.config.TIMEZONE);
    return this.prisma.block.findMany({
      where: { startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
      orderBy: { startsAt: 'asc' },
      include: { court: { select: { id: true, name: true } } },
    });
  }

  async createBlock(data: z.infer<typeof createBlockSchema>) {
    if (data.courtId) {
      const court = await this.prisma.court.findUnique({ where: { id: data.courtId } });
      if (!court) throw new NotFoundException('Court not found.');
    }
    const clashing = await this.prisma.booking.count({
      where: {
        ...occupyingBookings(),
        startsAt: { lt: data.endsAt },
        endsAt: { gt: data.startsAt },
        ...(data.courtId ? { courtId: data.courtId } : {}),
      },
    });
    if (clashing > 0) {
      throw new ConflictException(`There are ${clashing} confirmed booking(s) in this time. Cancel them first.`);
    }
    return this.prisma.block.create({ data });
  }

  async deleteBlock(id: string) {
    const result = await this.prisma.block.deleteMany({ where: { id } });
    if (result.count === 0) throw new NotFoundException('Block not found.');
  }
}

@ApiTags('venue')
@Controller('venue')
export class VenueController {
  constructor(private readonly venue: VenueService) {}

  @Get('hours')
  @ApiOperation({ summary: 'Opening hours per weekday (0 = Sunday), in minutes from local midnight.' })
  hours() {
    return this.venue.openingHours();
  }

  @Get('prices')
  @ApiOperation({ summary: 'Hourly price list per sport and day type.' })
  prices() {
    return this.venue.priceRules();
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/venue')
export class AdminVenueController {
  constructor(private readonly venue: VenueService) {}

  @Put('hours')
  @ApiOperation({ summary: 'Replace opening hours for all 7 days.' })
  setHours(@Body({ schema: openingHoursSchema }) body: z.infer<typeof openingHoursSchema>) {
    return this.venue.setOpeningHours(body);
  }

  @Put('prices')
  @ApiOperation({ summary: 'Replace the whole price list.' })
  setPrices(@Body({ schema: priceRulesSchema }) body: z.infer<typeof priceRulesSchema>) {
    return this.venue.setPriceRules(body);
  }

  @Get('blocks')
  blocks(@Query({ schema: blocksQuerySchema }) query: z.infer<typeof blocksQuerySchema>) {
    return query.date ? this.venue.blocksOn(query.date) : this.venue.upcomingBlocks();
  }

  @Post('blocks')
  @ApiOperation({ summary: 'Block time on one court (or all courts when courtId is null).' })
  createBlock(@Body({ schema: createBlockSchema }) body: z.infer<typeof createBlockSchema>) {
    return this.venue.createBlock(body);
  }

  @Delete('blocks/:id')
  @HttpCode(204)
  async deleteBlock(@Param('id', { schema: idSchema }) id: string) {
    await this.venue.deleteBlock(id);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [VenueController, AdminVenueController],
  providers: [VenueService],
  exports: [VenueService],
})
export class VenueModule {}
