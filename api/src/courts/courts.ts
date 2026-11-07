import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AdminGuard, AuthModule } from '../auth/auth.js';
import { idSchema, sportSchema } from '../common/schemas.js';
import { PrismaService } from '../prisma/prisma.service.js';

const courtFields = {
  name: z.string().trim().min(1).max(60),
  sport: sportSchema,
  indoor: z.boolean(),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
};
const createCourtSchema = z.object({
  ...courtFields,
  indoor: courtFields.indoor.default(false),
  active: courtFields.active.default(true),
  sortOrder: courtFields.sortOrder.default(0),
});
// No defaults here, so a partial update never resets fields that were not sent.
const updateCourtSchema = z.object(courtFields).partial();
const listQuerySchema = z.object({ sport: sportSchema.optional() });

type CreateCourtDto = z.infer<typeof createCourtSchema>;
type UpdateCourtDto = z.infer<typeof updateCourtSchema>;

@Injectable()
export class CourtsService {
  constructor(private readonly prisma: PrismaService) {}

  listActive(sport?: z.infer<typeof sportSchema>) {
    return this.prisma.court.findMany({
      where: { active: true, ...(sport ? { sport } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, sport: true, indoor: true },
    });
  }

  listAll() {
    return this.prisma.court.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  create(data: CreateCourtDto) {
    return this.prisma.court.create({ data });
  }

  async update(id: string, data: UpdateCourtDto) {
    await this.ensureExists(id);
    return this.prisma.court.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    const bookings = await this.prisma.booking.count({ where: { courtId: id } });
    if (bookings > 0) {
      throw new ConflictException('This court has bookings. Deactivate it instead of deleting it.');
    }
    await this.prisma.court.delete({ where: { id } });
  }

  private async ensureExists(id: string) {
    const court = await this.prisma.court.findUnique({ where: { id }, select: { id: true } });
    if (!court) throw new NotFoundException('Court not found.');
  }
}

@ApiTags('courts')
@Controller('courts')
export class CourtsController {
  constructor(private readonly courts: CourtsService) {}

  @Get()
  @ApiOperation({ summary: 'Active courts, optionally filtered by sport.' })
  list(@Query({ schema: listQuerySchema }) query: z.infer<typeof listQuerySchema>) {
    return this.courts.listActive(query.sport);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/courts')
export class AdminCourtsController {
  constructor(private readonly courts: CourtsService) {}

  @Get()
  @ApiOperation({ summary: 'All courts, including inactive ones.' })
  list() {
    return this.courts.listAll();
  }

  @Post()
  create(@Body({ schema: createCourtSchema }) body: CreateCourtDto) {
    return this.courts.create(body);
  }

  @Patch(':id')
  update(@Param('id', { schema: idSchema }) id: string, @Body({ schema: updateCourtSchema }) body: UpdateCourtDto) {
    return this.courts.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', { schema: idSchema }) id: string) {
    await this.courts.remove(id);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [CourtsController, AdminCourtsController],
  providers: [CourtsService],
})
export class CourtsModule {}
