import { expect, type Page } from '@playwright/test';

export const API_URL = process.env.API_URL ?? 'http://localhost:3000/api';
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'demo@example.com';
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'court-demo-2026'; // pragma: allowlist secret (public demo login)
export const VENUE_TZ = 'Europe/Belgrade';

/** The venue's date (YYYY-MM-DD) `days` days from today. */
export function venueDate(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: VENUE_TZ }).format(d);
}

/** HH:MM in the venue's time zone. */
export function venueTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: VENUE_TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** Opens the booking page in English with nothing remembered from earlier tests. */
export async function openBookingPage(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Book a court', level: 1 })).toBeVisible();
}

/** Picks a day in the month calendar, moving to the next month when needed. */
export async function pickDay(page: Page, date: string): Promise<void> {
  if (date.slice(0, 7) !== venueDate(0).slice(0, 7)) {
    await page.getByRole('button', { name: 'Next month' }).click();
  }
  const day = Number(date.slice(8, 10));
  const button = page.getByRole('grid').getByRole('button', { name: new RegExp(`^${day}\\. `) });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}
