import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma CLI (migrate, generate) uses a direct, non-pooled connection when available.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'] ?? '',
  },
});
