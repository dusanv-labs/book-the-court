import { StandardSchemaValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { APP_CONFIG, type AppConfig } from './config/config.js';

/** Shared app setup, used by main.ts and the end-to-end tests. */
export function setupApp(app: NestExpressApplication): void {
  const config = app.get<AppConfig>(APP_CONFIG);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  // Behind a hosting proxy (Render), so rate limiting sees the real client IP.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.enableCors({
    origin: config.CORS_ORIGINS.split(',').map((o) => o.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  const docConfig = new DocumentBuilder()
    .setTitle('BookTheCourt API')
    .setDescription('Sports court booking system: availability, pricing, bookings and venue administration.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, docConfig));
}
