import { randomUUID } from 'node:crypto';
import { AuthPage, expect, ORIGIN, test, uniqueUsername, VirtualPasskeys } from './helpers';
import { createTodo } from './helpers';

test.beforeEach(async ({ page, auth, passkeys }) => {
  await page.goto('/');
  await auth.expectLogin();
  await auth.register(uniqueUsername());
  await passkeys.onlyCredential();
  await expect(page.getByText('You have no todos yet.')).toBeVisible();
});

test('creates a title-only todo with medium priority in Pending', async ({ page }) => {
  const title = `quick task ${randomUUID()}`;
  const card = await createTodo(page, title);

  await expect(card.getByText('Medium', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Pending' })).toContainText(title);
});

test('rejects whitespace titles and past or malformed due dates', async ({ page }) => {
  await page.getByLabel('Todo title').fill('   ');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Title is required', { exact: true })).toBeVisible();

  const pastTitle = `past task ${randomUUID()}`;
  await page.getByLabel('Todo title').fill(pastTitle);
  await page.getByLabel('Due date and time').fill('2020-01-01T12:00');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(
    page.getByText('Due date must be at least 1 minute in the future', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(pastTitle)).toHaveCount(0);
});

test('edits fields and re-sections todos after completion toggles', async ({ page }) => {
  const title = `editable task ${randomUUID()}`;
  const card = await createTodo(page, title);
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Title').fill(`${title} updated`);
  await page.getByRole('dialog').getByLabel('Priority').selectOption('high');
  await page.getByRole('dialog').getByRole('button', { name: 'Update' }).click();

  const updatedCard = page.getByRole('listitem').filter({ hasText: `${title} updated` });
  await expect(updatedCard.getByText('High', { exact: true })).toBeVisible();
  await page.getByLabel(`Mark "${title} updated" as complete`).click();
  await expect(page.getByRole('region', { name: 'Completed' })).toContainText(
    `${title} updated`,
  );
  await page.getByLabel(`Mark "${title} updated" as incomplete`).click();
  await expect(page.getByRole('region', { name: 'Pending' })).toContainText(
    `${title} updated`,
  );
});

test('allows editing an overdue todo without changing its due date', async ({ page }) => {
  const now = new Date();
  await page.clock.install({ time: now });
  const title = `overdue edit ${randomUUID()}`;
  const dueAt = new Date(now.getTime() + 180_000);
  dueAt.setSeconds(0, 0);
  const dueDate = dueAt.toISOString();
  const response = await page.request.post('/api/todos', {
    data: { title, due_date: dueDate },
  });
  expect(response.status()).toBe(201);
  await page.clock.fastForward(181_000);
  await page.reload();
  const card = page.getByRole('region', { name: 'Overdue' })
    .getByRole('listitem')
    .filter({ hasText: title });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Title').fill(`${title} updated`);
  await page.getByRole('dialog').getByRole('button', { name: 'Update' }).click();
  await expect(page.getByRole('region', { name: 'Overdue' })).toContainText(
    `${title} updated`,
  );
  const todo = (await response.json()) as { id: number };
  const updated = await page.request.get(`/api/todos/${todo.id}`);
  expect((await updated.json()).due_date).toBe(dueDate);
});

test('moves a todo into Overdue when its deadline passes while the page is open', async ({
  page,
}) => {
  const now = new Date();
  await page.clock.install({ time: now });
  const title = `live overdue ${randomUUID()}`;
  const dueAt = new Date(now.getTime() + 180_000);
  dueAt.setSeconds(0, 0);
  const dueDate = dueAt.toISOString();
  const response = await page.request.post('/api/todos', {
    data: { title, due_date: dueDate },
  });
  expect(response.status()).toBe(201);
  await page.reload();
  const pending = page.getByRole('region', { name: 'Pending' });
  const card = pending.getByRole('listitem').filter({ hasText: title });
  await expect(card).toBeVisible();
  await page.clock.fastForward(181_000);
  await expect(page.getByRole('region', { name: 'Overdue' })).toContainText(title);
  await expect(card).toHaveCount(0);
});

test('cancels edits on Escape and deletes without confirmation', async ({ page }) => {
  const title = `removable task ${randomUUID()}`;
  const card = await createTodo(page, title);
  await card.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('dialog').getByLabel('Title').fill('discard this');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('listitem').filter({ hasText: title })).toBeVisible();

  await page.getByRole('listitem').filter({ hasText: title })
    .getByRole('button', { name: `Delete "${title}"` })
    .click();
  await expect(page.getByRole('listitem').filter({ hasText: title })).toHaveCount(0);
});

test('requires a session for pages and API routes', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: ORIGIN });
  try {
    const response = await context.request.get('/api/todos');
    expect(response.status()).toBe(401);
    const anonymousPage = await context.newPage();
    await anonymousPage.goto('/');
    await expect(anonymousPage).toHaveURL(/\/login$/);
  } finally {
    await context.close();
  }
});

test('rejects malformed due dates at the API boundary', async ({ page }) => {
  const response = await page.request.post('/api/todos', {
    data: { title: `bad date ${randomUUID()}`, due_date: 'not-a-date' },
  });
  expect(response.status()).toBe(400);
});

test('persists the submitted todo fields and returns the saved record', async ({ page }) => {
  const input = {
    title: `persisted ${randomUUID()}`,
    due_date: new Date(Date.now() + 10 * 60_000).toISOString(),
    priority: 'high',
  };
  const created = await page.request.post('/api/todos', { data: input });
  expect(created.status()).toBe(201);
  const saved = (await created.json()) as {
    id: number;
    title: string;
    due_date: string | null;
    priority: string;
    completed: boolean;
    user_id: number;
  };
  expect(saved).toMatchObject({
    ...input,
    due_date: new Date(input.due_date).toISOString(),
    completed: false,
  });
  expect(saved.id).toBeGreaterThan(0);
  expect(saved.user_id).toBeGreaterThan(0);

  const fetched = await page.request.get(`/api/todos/${saved.id}`);
  expect(fetched.status()).toBe(200);
  expect(await fetched.json()).toEqual(saved);
});

test('returns 404 for another user on single-todo GET, PUT, and DELETE', async ({
  browser,
  page,
}) => {
  const title = `user scoped ${randomUUID()}`;
  const created = await page.request.post('/api/todos', { data: { title } });
  expect(created.status()).toBe(201);
  const todo = (await created.json()) as { id: number; title: string };
  const ownerId = todo.id;
  const otherContext = await browser.newContext({
    baseURL: ORIGIN,
    timezoneId: 'Asia/Singapore',
  });

  try {
    const otherPage = await otherContext.newPage();
    const otherPasskeys = await VirtualPasskeys.create(otherPage);
    const otherAuth = new AuthPage(otherPage);
    await otherAuth.gotoLogin();
    await otherAuth.register(uniqueUsername());
    await otherPasskeys.onlyCredential();
    const otherRequest = otherContext.request;
    expect((await otherRequest.get(`/api/todos/${ownerId}`)).status()).toBe(404);
    expect(
      (
        await otherRequest.put(`/api/todos/${ownerId}`, {
          data: { title: 'unauthorized update' },
        })
      ).status(),
    ).toBe(404);
    expect((await otherRequest.delete(`/api/todos/${ownerId}`)).status()).toBe(404);
    const unchanged = await page.request.get(`/api/todos/${ownerId}`);
    expect(unchanged.status()).toBe(200);
    expect((await unchanged.json()).title).toBe(title);
    await otherPasskeys.dispose();
  } finally {
    await otherContext.close();
  }
});

test('rolls back optimistic create, edit, and delete when API requests fail', async ({
  page,
}) => {
  const failedCreateTitle = `failed create ${randomUUID()}`;
  await page.route('**/api/todos', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Create unavailable' }),
    });
  });

  await page.getByLabel('Todo title').fill(failedCreateTitle);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(failedCreateTitle)).toHaveCount(0);
  await expect(page.getByText('Create unavailable', { exact: true })).toBeVisible();
  await page.unroute('**/api/todos');

  const originalTitle = `failed update ${randomUUID()}`;
  const card = await createTodo(page, originalTitle);
  await page.route('**/api/todos/*', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Update unavailable' }),
      });
      return;
    }
    if (route.request().method() === 'DELETE') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Delete unavailable' }),
      });
      return;
    }
    await route.continue();
  });
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Title').fill(`${originalTitle} changed`);
  await page.getByRole('dialog').getByRole('button', { name: 'Update' }).click();
  await expect(page.getByText(`${originalTitle} changed`)).toHaveCount(0);
  await expect(page.getByRole('listitem').filter({ hasText: originalTitle })).toBeVisible();
  await expect(page.getByText('Update unavailable', { exact: true })).toBeVisible();

  await page.getByRole('listitem').filter({ hasText: originalTitle })
    .getByRole('button', { name: `Delete "${originalTitle}"` })
    .click();
  await expect(page.getByRole('listitem').filter({ hasText: originalTitle })).toBeVisible();
  await expect(
    page.getByText('Could not delete todo. Please try again.', { exact: true }),
  ).toBeVisible();
});
