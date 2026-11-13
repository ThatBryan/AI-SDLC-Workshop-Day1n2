import { randomUUID } from 'node:crypto';
import { expect, test, uniqueUsername } from './helpers';

function monthParam({ year, month }: { year: number; month: number }): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function shiftMonth(
  { year, month }: { year: number; month: number },
  delta: number,
): { year: number; month: number } {
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

async function futureSingaporeDate(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const date = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const pad = (value: number) => String(value).padStart(2, '0');
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hour = pad(date.getHours());
    const minute = pad(date.getMinutes());
    return {
      input: `${date.getFullYear()}-${month}-${day}T${hour}:${minute}`,
      date: `${date.getFullYear()}-${month}-${day}`,
      month: `${date.getFullYear()}-${month}`,
    };
  });
}

test.beforeEach(async ({ page, auth, passkeys }) => {
  await page.goto('/');
  await auth.expectLogin();
  await auth.register(uniqueUsername());
  await passkeys.onlyCredential();
});

test('opens the current Singapore month with a six-row calendar grid', async ({ page }) => {
  await page.goto('/calendar');

  const currentMonth = await page.evaluate(() => {
    const now = new Date();
    return new Intl.DateTimeFormat('en-SG', {
      timeZone: 'Asia/Singapore',
      month: 'long',
      year: 'numeric',
    }).format(now);
  });
  await expect(page.getByRole('heading', { name: currentMonth })).toBeVisible();
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(7);
  await expect(page.getByRole('columnheader')).toHaveCount(7);
});

test('renders a future todo in the correct Singapore-local date cell and opens its day modal', async ({ page }) => {
  const due = await futureSingaporeDate(page);
  const title = `Calendar todo ${randomUUID()}`;
  const response = await page.request.post('/api/todos', {
    data: { title, due_date: due.input, priority: 'high' },
  });
  expect(response.status()).toBe(201);

  await page.goto(`/calendar?month=${due.month}`);
  const cell = page.getByRole('gridcell', { name: new RegExp(due.date) });
  await expect(cell.getByText(title, { exact: true })).toBeVisible();
  await cell.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(title, { exact: true })).toBeVisible();
  await expect(dialog.getByText('High', { exact: true })).toBeVisible();
});

test('collapses todos beyond three into an overflow count and lists all in the day modal', async ({ page }) => {
  const due = await futureSingaporeDate(page);
  const titles = Array.from({ length: 4 }, (_, index) => `Overflow ${index} ${randomUUID()}`);
  for (const title of titles) {
    const response = await page.request.post('/api/todos', {
      data: { title, due_date: due.input, priority: 'medium' },
    });
    expect(response.status()).toBe(201);
  }

  await page.goto(`/calendar?month=${due.month}`);
  const cell = page.getByRole('gridcell', { name: new RegExp(due.date) });
  await expect(cell.getByText('+1 more', { exact: true })).toBeVisible();
  const visibleTitles = await Promise.all(
    titles.map(async (title) =>
      cell.getByText(title, { exact: true }).isVisible().catch(() => false),
    ),
  );
  expect(visibleTitles.filter(Boolean)).toHaveLength(3);
  expect(visibleTitles.filter((visible) => !visible)).toHaveLength(1);

  await cell.click();
  const dialog = page.getByRole('dialog');
  for (const title of titles) {
    await expect(dialog.getByText(title, { exact: true })).toBeVisible();
  }
});

test('month controls update URL state and Today returns to the current Singapore month', async ({ page }) => {
  const current = await page.evaluate(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const next = shiftMonth(current, 1);
  const previous = shiftMonth(current, -1);

  await page.goto(`/calendar?month=${monthParam(current)}`);
  await page.getByRole('button', { name: /next month/i }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]month=${monthParam(next)}$`));
  await page.getByRole('button', { name: /previous month/i }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]month=${monthParam(current)}$`));
  await page.getByRole('button', { name: /previous month/i }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]month=${monthParam(previous)}$`));
  await page.getByRole('button', { name: /^today$/i }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]month=${monthParam(current)}$`));
});

test('invalid month query falls back to the current month', async ({ page }) => {
  const currentMonth = await page.evaluate(() => {
    const now = new Date();
    return new Intl.DateTimeFormat('en-SG', {
      timeZone: 'Asia/Singapore',
      month: 'long',
      year: 'numeric',
    }).format(now);
  });

  await page.goto('/calendar?month=2026-13');

  await expect(page.getByRole('heading', { name: currentMonth })).toBeVisible();
  await expect(page.getByRole('grid')).toBeVisible();
});

test('redirects unauthenticated visitors from the calendar to login', async ({ page, auth }) => {
  await page.context().clearCookies();
  await page.goto('/calendar');
  await auth.expectLogin();
});

test('requires authentication for the holidays API', async ({ page }) => {
  await page.context().clearCookies();

  const response = await page.request.get('/api/holidays?year=2026&month=12');

  expect(response.status()).toBe(401);
});
