import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers';

test('admin pages need a login', async ({ page }) => {
  await page.goto('/#/admin/reports');
  await expect(page.getByRole('heading', { name: 'Admin login' })).toBeVisible();
});

test('a wrong password is rejected', async ({ page }) => {
  await page.goto('/#/admin/login');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill('not-the-password'); // pragma: allowlist secret (wrong on purpose)
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Invalid email or password.')).toBeVisible();
});

test('the venue admin logs in and opens the revenue report', async ({ page }) => {
  await page.goto('/#/admin/login');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Venue admin', level: 1 })).toBeVisible();

  // The demo data has 60 days of played bookings, so last month has rows.
  await page.getByRole('link', { name: 'Revenue report' }).click();
  await page.getByRole('button', { name: 'Last month' }).click();
  const table = page.getByRole('table', { name: 'Revenue report' });
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr').first()).toBeVisible();
  expect(await table.locator('tbody tr').count()).toBeGreaterThan(1);

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Admin login' })).toBeVisible();
});
