import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.js';
import { BookingsModule } from './bookings/bookings.js';
import { ConfigModule } from './config/config.js';
import { CourtsModule } from './courts/courts.js';
import { HealthController } from './health.js';
import { PrismaModule } from './prisma/prisma.service.js';
import { VenueModule } from './venue/venue.js';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    // Basic protection against abuse: 120 requests per minute per IP (stricter on login and booking).
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }],
      // Automated tests send many requests from one IP; production never sets NODE_ENV=test.
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    AuthModule,
    CourtsModule,
    VenueModule,
    BookingsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
