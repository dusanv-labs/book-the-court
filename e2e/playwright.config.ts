import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the whole app (web + API + PostgreSQL), started with `docker compose up`.
 * APP_URL and API_URL can point the tests at another running copy of the app.
 */
export default defineConfig({
  testDir: './tests',
  // The tests share one database and the API rate limits per IP, so they run one at a time.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.APP_URL ?? 'http://localhost:8080/',
    // The venue is in Belgrade; English is picked from the browser language.
    timezoneId: 'Europe/Belgrade',
    locale: 'en-GB',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /booking\.spec\.ts/ },
  ],
});
