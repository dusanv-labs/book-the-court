import { expect, test, type Page, type Route } from '@playwright/test';
import { openBookingPage, pickDay, venueDate } from './helpers';

// Stripe is never called from tests. The copy of the API used here has no Stripe key, so the test
// switches online payment on in the availability answer and answers the booking endpoints itself.
// The API's side of payments (holding the court, webhooks, refunds) is covered by the API tests.

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const TOKEN = 'pw-payment-test-token-0123456789'.slice(0, 32);

const fulfillJson = (route: Route, body: unknown, status = 200) =>
  route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: CORS })
    : route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });

/** Real availability, with online payment switched on. */
async function enableOnlinePayment(page: Page) {
  await page.route(
    (url) => url.pathname.endsWith('/api/availability'),
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), onlinePayment: true } });
    },
  );
}

const managed = (overrides: object) => ({
  code: 'PAY123',
  court: { name: 'Tennis Court 1', sport: 'TENNIS' },
  startsAt: `${venueDate(10)}T16:00:00.000Z`,
  endsAt: `${venueDate(10)}T17:00:00.000Z`,
  price: 1500,
  currency: 'RSD',
  status: 'PENDING',
  paymentStatus: 'UNPAID',
  checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_playwright',
  holdExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  customerName: 'Playwright Payer',
  canCancel: true,
  cancelCutoffMinutes: 120,
  ...overrides,
});

test('a player pays online and comes back to a confirmed booking', async ({ page, baseURL }) => {
  await enableOnlinePayment(page);
  const sent: Record<string, unknown>[] = [];
  await page.route('**/api/bookings', (route) => {
    if (route.request().method() === 'POST') sent.push(route.request().postDataJSON());
    // Stands in for Stripe: the "payment page" sends the player straight back as if they had paid.
    return fulfillJson(
      route,
      {
        code: 'PAY123',
        cancelToken: TOKEN,
        court: { id: 'x', name: 'Tennis Court 1', sport: 'TENNIS' },
        startsAt: managed({}).startsAt,
        endsAt: managed({}).endsAt,
        price: 1500,
        currency: 'RSD',
        status: 'PENDING',
        paymentStatus: 'UNPAID',
        checkoutUrl: `${baseURL}#/manage/${TOKEN}?payment=done`,
      },
      201,
    );
  });
  // The first check still sees the payment as open, the next one as paid (like a webhook arriving).
  let checks = 0;
  await page.route(`**/api/bookings/manage/${TOKEN}`, (route) =>
    fulfillJson(
      route,
      route.request().method() === 'OPTIONS' || checks++ === 0
        ? managed({})
        : managed({ status: 'CONFIRMED', paymentStatus: 'PAID', checkoutUrl: null, holdExpiresAt: null }),
    ),
  );

  await openBookingPage(page);
  await page.getByRole('radiogroup', { name: 'Sport' }).getByRole('radio', { name: /Tennis/ }).click();
  await pickDay(page, venueDate(10));
  const freeTime = page.getByRole('group', { name: 'Choose a start time' }).locator('button:enabled').first();
  const time = (await freeTime.textContent())!.trim();
  await freeTime.click();
  await page.getByRole('button', { name: new RegExp(`^Book .+ at ${time}$`) }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: /Pay now by card/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog).toContainText('4242 4242 4242 4242');
  await dialog.getByLabel('Full name').fill('Playwright Payer');
  await dialog.getByLabel('Email').fill('payer@example.com');
  await dialog.getByLabel('Phone').fill('+381 64 000 0000');
  await dialog.getByRole('button', { name: /^Pay .+ and book$/ }).click();

  await expect(page.getByRole('heading', { name: 'Your booking' })).toBeVisible();
  await expect(page.getByText('Payment received. Your booking is confirmed.')).toBeVisible();
  await expect(page.getByText('Paid online by card')).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ payment: 'online', customerName: 'Playwright Payer' });
});

test('a player who leaves the payment page can go back to it', async ({ page }) => {
  await page.route(`**/api/bookings/manage/${TOKEN}`, (route) => fulfillJson(route, managed({})));
  await page.goto(`/#/manage/${TOKEN}?payment=cancelled`);
  await expect(page.getByText('The payment was not finished.')).toBeVisible();
  await expect(page.getByText('Awaiting payment', { exact: true })).toBeVisible();
  await expect(page.getByText(/The court is held for you until \d\d:\d\d/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Continue to payment/ })).toBeVisible();
});
