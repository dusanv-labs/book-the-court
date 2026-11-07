import { Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({ adapter: new PrismaPg({ connectionString: config.DATABASE_URL }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}

/** True when Postgres rejected an insert/update because of the bookings_no_overlap exclusion constraint. */
export function isOverlapViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  const visit = (e: unknown): boolean => {
    if (!e || typeof e !== 'object' || seen.has(e)) return false;
    seen.add(e);
    const rec = e as Record<string, unknown>;
    const text = [rec.code, rec.message, JSON.stringify(rec.meta ?? null)].map(String).join(' ');
    if (text.includes('23P01') || text.includes('bookings_no_overlap')) return true;
    return visit(rec.cause) || visit(rec.meta);
  };
  return visit(error);
}

/** True when a unique constraint failed (Prisma P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: string }).code === 'P2002';
}
