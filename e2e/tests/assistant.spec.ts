import { expect, test, type Route } from '@playwright/test';
import { API_URL, openBookingPage, venueDate, venueTime } from './helpers';

// The real model is never called from tests: the assistant's two endpoints are answered by the
// test itself, so the widget is checked with a known reply. Availability and the booking form
// still use the real API.

interface Slot {
  startsAt: string;
  endsAt: string;
  status: string;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

const json = (route: Route, body: unknown) =>
  route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: CORS })
    : route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });

test('the assistant shows suggestions whose Book button opens the booking form', async ({ page, request }) => {
  // A real free hour on a tennis court, so the suggestion can be booked.
  const date = venueDate(9);
  const res = await request.get(`${API_URL}/availability`, { params: { date, sport: 'TENNIS' } });
  expect(res.ok()).toBeTruthy();
  const availability = (await res.json()) as { courts: { id: string; name: string; indoor: boolean; slots: Slot[] }[] };
  const court = availability.courts[0];
  const i = court.slots.findIndex((s, n) => s.status === 'free' && court.slots[n + 1]?.status === 'free');
  expect(i).toBeGreaterThanOrEqual(0);
  const start = court.slots[i];
  const end = court.slots[i + 1];
  const suggestion = {
    courtId: court.id,
    courtName: court.name,
    sport: 'TENNIS',
    indoor: court.indoor,
    date,
    startTime: venueTime(start.startsAt),
    endTime: venueTime(end.endsAt),
    startsAt: start.startsAt,
    durationMinutes: 60,
    price: 1500,
    currency: 'RSD',
  };

  const sent: unknown[] = [];
  const reply = `${court.name} is free at ${suggestion.startTime}.`;
  await page.route('**/api/assistant/status', (route) => json(route, { enabled: true, available: true }));
  // The streaming answer: pieces of text, a tool call, then the final reply with the cards.
  await page.route('**/api/assistant/chat/stream', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    sent.push(route.request().postDataJSON());
    const lines = [
      { type: 'tool', name: 'find_available_slots' },
      ...reply.split(/(?<= )/).map((text) => ({ type: 'text', text })),
      { type: 'tool', name: 'suggest_booking_options' },
      { type: 'done', reply, suggestions: [suggestion] },
    ];
    return route.fulfill({
      status: 200,
      headers: CORS,
      contentType: 'application/x-ndjson',
      body: lines.map((line) => JSON.stringify(line)).join('\n') + '\n',
    });
  });

  await openBookingPage(page);
  await page.getByRole('button', { name: 'Ask the AI assistant' }).click();
  const panel = page.getByRole('dialog', { name: 'Booking assistant' });
  await expect(panel).toContainText('Hi! Ask me about free courts');

  await panel.getByRole('textbox').fill('Is there a free tennis court?');
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(panel).toContainText(reply);
  await expect(panel).not.toContainText('Checking free courts');
  expect(sent).toEqual([{ language: 'en', messages: [{ role: 'user', content: 'Is there a free tennis court?' }] }]);

  const card = panel.getByRole('listitem').filter({ hasText: court.name });
  await expect(card).toContainText(`${suggestion.startTime}–${suggestion.endTime}`);
  await card.getByRole('button', { name: /Book/ }).click();

  const form = page.getByRole('dialog', { name: `Book ${court.name}` });
  await expect(form).toBeVisible();
  await expect(form).toContainText(`starts at ${suggestion.startTime}`);
});

test('a limit error from the API is shown in the chat', async ({ page }) => {
  await page.route('**/api/assistant/status', (route) => json(route, { enabled: true, available: true }));
  await page.route('**/api/assistant/chat/stream', (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill({
          status: 429,
          headers: CORS,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: 429, code: 'IP_LIMIT', message: 'You have reached the daily number of questions.' }),
        }),
  );
  await openBookingPage(page);
  await page.getByRole('button', { name: 'Ask the AI assistant' }).click();
  const panel = page.getByRole('dialog', { name: 'Booking assistant' });
  await panel.getByRole('textbox').fill('Tennis tomorrow?');
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(panel.getByText('Tennis tomorrow?')).toBeVisible();
  await expect(panel).toContainText("You've reached today's number of questions.");
});

test('the assistant button is hidden when the API has no AI key', async ({ page, request }) => {
  const status = (await (await request.get(`${API_URL}/assistant/status`)).json()) as { enabled: boolean };
  test.skip(status.enabled, 'this copy of the API has an AI key');
  await openBookingPage(page);
  await expect(page.getByRole('heading', { name: 'Book a court', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask the AI assistant' })).toHaveCount(0);
});
