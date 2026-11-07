import { Global, Module } from '@nestjs/common';
import { z } from 'zod';
import { DEFAULT_TIMEZONE } from '../common/time.js';

const configSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(8 * 60 * 60),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  TIMEZONE: z.string().default(DEFAULT_TIMEZONE),
});

export type AppConfig = z.infer<typeof configSchema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration (${problems}). See api/.env.example.`);
  }
  return result.data;
}

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
