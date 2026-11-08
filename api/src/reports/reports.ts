import { Controller, Get, Inject, Injectable, Module, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AdminGuard, AuthModule } from '../auth/auth.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { dateSchema, idSchema, sportSchema } from '../common/schemas.js';
import { localToUtc } from '../common/time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildRevenueReport, changePct, datesBetween, GROUP_BY, previousPeriod, type GroupBy } from './domain/revenue.js';

const MAX_REPORT_DAYS = 366;

const revenueQuerySchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
    sport: sportSchema.optional(),
    courtId: idSchema.optional(),
    groupBy: z.enum(GROUP_BY as [GroupBy, ...GroupBy[]]).default('day'),
  })
  .refine((q) => q.from <= q.to, 'from must not be after to')
  .refine((q) => datesBetween(q.from, q.to).length <= MAX_REPORT_DAYS, `At most ${MAX_REPORT_DAYS} days per report`);

type RevenueQuery = z.infer<typeof revenueQuerySchema>;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private async compute(q: RevenueQuery & { from: string; to: string }) {
    const tz = this.config.TIMEZONE;
    const courts = await this.prisma.court.findMany({
      where: { ...(q.sport ? { sport: q.sport } : {}), ...(q.courtId ? { id: q.courtId } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, sport: true, active: true },
    });
    const [bookings, hours] = await Promise.all([
      this.prisma.booking.findMany({
        where: {
          courtId: { in: courts.map((c) => c.id) },
          startsAt: { gte: localToUtc(q.from, 0, tz), lt: localToUtc(q.to, 24 * 60, tz) },
        },
        select: { courtId: true, startsAt: true, endsAt: true, price: true, status: true },
      }),
      this.prisma.openingHours.findMany(),
    ]);
    const byDay = new Map(hours.map((h) => [h.dayOfWeek, h]));
    return buildRevenueReport({
      from: q.from,
      to: q.to,
      groupBy: q.groupBy,
      courts,
      bookings,
      hoursFor: (dow) => byDay.get(dow) ?? null,
      now: new Date(),
      tz,
    });
  }

  async revenue(q: RevenueQuery) {
    const current = await this.compute(q);
    const prevRange = previousPeriod(q.from, q.to);
    const previous = await this.compute({ ...q, ...prevRange, groupBy: 'day' });
    return {
      from: q.from,
      to: q.to,
      sport: q.sport ?? null,
      courtId: q.courtId ?? null,
      groupBy: q.groupBy,
      currency: 'RSD',
      generatedAt: new Date().toISOString(),
      totals: current.totals,
      rows: current.rows,
      previous: {
        ...prevRange,
        total: previous.totals.total,
        bookings: previous.totals.bookings,
        occupancyPct: previous.totals.occupancyPct,
        changePct: changePct(current.totals.total, previous.totals.total),
      },
    };
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('revenue')
  @ApiOperation({
    summary: 'Revenue report: realized (played) and estimated (upcoming) revenue, cancellations and occupancy, grouped by day, week, month, court or sport.',
  })
  revenue(@Query({ schema: revenueQuerySchema }) q: RevenueQuery) {
    return this.reports.revenue(q);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
