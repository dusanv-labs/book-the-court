import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { APP_CONFIG, type AppConfig } from './config/config.js';
import { setupApp } from './setup-app.js';

async function bootstrap() {
  // rawBody: Stripe webhooks are verified against the exact bytes Stripe sent.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  setupApp(app);
  app.enableShutdownHooks();
  const { PORT } = app.get<AppConfig>(APP_CONFIG);
  await app.listen(PORT);
}
await bootstrap();
