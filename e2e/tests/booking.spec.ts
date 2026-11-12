import { expect, test } from '@playwright/test';
import { openBookingPage, pickDay, venueDate } from './helpers';

test('a player books a court and cancels it with the private link', async ({ page }) => {
  await openBookingPage(page);

  // Sport → day → duration → start time → court.
  await page.getByRole('radiogroup', { name: 'Sport' }).getByRole('radio', { name: /Tennis/ }).click();
  await pickDay(page, venueDate(8));
  await page.getByRole('radiogroup', { name: 'Duration' }).getByRole('radio', { name: '60 min' }).click();

  const freeTime = page.getByRole('group', { name: 'Choose a start time' }).locator('button:enabled').first();
  const time = (await freeTime.textContent())!.trim();
  await freeTime.click();
  await page.getByRole('button', { name: new RegExp(`^Book .+ at ${time}$`) }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: /^Book / })).toBeVisible();
  await expect(dialog).toContainText(`starts at ${time}`);

  // Required fields are checked before anything is sent.
  const submit = dialog.getByRole('button', { name: /^Confirm booking/ });
  await submit.click();
  await expect(dialog.getByText('Please enter your name')).toBeVisible();

  await dialog.getByLabel('Full name').fill('Playwright Test');
  await dialog.getByLabel('Email').fill('playwright@example.com');
  await dialog.getByLabel('Phone').fill('+381 64 000 0000');
  await submit.click();

  // Confirmation with the booking code and the private manage link.
  await expect(page.getByRole('heading', { name: "You're booked!" })).toBeVisible();
  await expect(page.getByText(time).first()).toBeVisible();
  const link = await page.getByRole('textbox', { name: 'Manage or cancel your booking' }).inputValue();
  expect(link).toMatch(/#\/manage\/.+/);

  // The manage page cancels the booking after a confirmation.
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Your booking' })).toBeVisible();
  await expect(page.getByText('Confirmed')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel booking' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Cancel this booking?');
  await confirm.getByRole('button', { name: 'Cancel booking' }).click();
  await expect(page.getByText('Your booking has been cancelled.')).toBeVisible();
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
});

test('the language can be switched to Serbian and is remembered', async ({ page }) => {
  await openBookingPage(page);
  await page.getByRole('group', { name: 'Language' }).getByRole('button', { name: /sr/i }).click();
  await expect(page.getByRole('heading', { name: 'Rezerviši teren', level: 1 })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Rezerviši teren', level: 1 })).toBeVisible();
});

for (const lang of ['en', 'sr']) {
  test(`the page fits the screen without sideways scrolling (${lang})`, async ({ page }) => {
    await page.addInitScript((l) => localStorage.setItem('btc_lang', l), lang);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
}
