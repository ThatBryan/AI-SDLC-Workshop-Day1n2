import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { createTodo } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Pending' })).toBeVisible();
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

test('allows editing an overdue todo without changing its due date', async ({ page, request }) => {
  const title = `overdue edit ${randomUUID()}`;
  const response = await request.post('/api/todos', { data: { title } });
  expect(response.status()).toBe(201);
  const todo = (await response.json()) as { id: number };
  const databasePath = process.env.TODO_DB_PATH;
  if (!databasePath) throw new Error('TODO_DB_PATH must be configured for E2E tests');
  const database = new Database(path.resolve(databasePath));
  try {
    database
      .prepare('UPDATE todos SET due_date = ? WHERE id = ?')
      .run('2020-01-01T00:00:00.000Z', todo.id);
  } finally {
    database.close();
  }

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
});

test('moves a todo into Overdue when its deadline passes while the page is open', async ({
  page,
  request,
}) => {
  await page.clock.install({ time: new Date() });
  const title = `live overdue ${randomUUID()}`;
  const response = await request.post('/api/todos', { data: { title } });
  expect(response.status()).toBe(201);
  const todo = (await response.json()) as { id: number };
  const dueDate = new Date(Date.now() + 15_000).toISOString();
  const databasePath = process.env.TODO_DB_PATH;
  if (!databasePath) throw new Error('TODO_DB_PATH must be configured for E2E tests');
  const database = new Database(path.resolve(databasePath));
  try {
    database
      .prepare('UPDATE todos SET due_date = ? WHERE id = ?')
      .run(dueDate, todo.id);
  } finally {
    database.close();
  }

  await page.reload();
  const pending = page.getByRole('region', { name: 'Pending' });
  const card = pending.getByRole('listitem').filter({ hasText: title });
  await expect(card).toBeVisible();
  await page.clock.fastForward(31_000);
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

test('requires a session for pages and API routes', async ({ browser, request }) => {
  const response = await request.get('/api/todos', {
    headers: { Cookie: '' },
  });
  expect(response.status()).toBe(401);

  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await context.close();
});

test('rejects malformed due dates at the API boundary', async ({ request }) => {
  const response = await request.post('/api/todos', {
    data: { title: `bad date ${randomUUID()}`, due_date: 'not-a-date' },
  });
  expect(response.status()).toBe(400);
});

test('persists the submitted todo fields and returns the saved record', async ({ request }) => {
  const input = {
    title: `persisted ${randomUUID()}`,
    due_date: new Date(Date.now() + 10 * 60_000).toISOString(),
    priority: 'high',
  };
  const created = await request.post('/api/todos', { data: input });
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

  const fetched = await request.get(`/api/todos/${saved.id}`);
  expect(fetched.status()).toBe(200);
  expect(await fetched.json()).toEqual(saved);
});

test('returns 404 for another user on single-todo GET, PUT, and DELETE', async ({
  browser,
  request,
}) => {
  const title = `user scoped ${randomUUID()}`;
  const created = await request.post('/api/todos', { data: { title } });
  expect(created.status()).toBe(201);
  const todo = (await created.json()) as { id: number; title: string };
  const ownerId = todo.id;
  const otherContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:3317',
    storageState: path.join(process.cwd(), 'test-results', 'other-auth-state.json'),
  });

  try {
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
    const unchanged = await request.get(`/api/todos/${ownerId}`);
    expect(unchanged.status()).toBe(200);
    expect((await unchanged.json()).title).toBe(title);
  } finally {
    await otherContext.close();
  }
});

test('deleting a todo cascades to its subtasks and tag associations', async ({ request }) => {
  const created = await request.post('/api/todos', {
    data: { title: `cascade ${randomUUID()}` },
  });
  expect(created.status()).toBe(201);
  const todo = (await created.json()) as { id: number; user_id: number };
  const databasePath = process.env.TODO_DB_PATH;
  if (!databasePath) throw new Error('TODO_DB_PATH must be configured for E2E tests');
  const database = new Database(path.resolve(databasePath));
  let tagId: number;
  try {
    database.pragma('foreign_keys = ON');
    const tag = database
      .prepare('INSERT INTO tags (user_id, name) VALUES (?, ?) RETURNING id')
      .get(todo.user_id, `cascade-${randomUUID()}`) as { id: number };
    tagId = tag.id;
    database
      .prepare('INSERT INTO subtasks (todo_id, title) VALUES (?, ?)')
      .run(todo.id, 'related subtask');
    database
      .prepare('INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)')
      .run(todo.id, tagId);
  } finally {
    database.close();
  }

  const deleted = await request.delete(`/api/todos/${todo.id}`);
  expect(deleted.status()).toBe(200);

  const verify = new Database(path.resolve(databasePath));
  try {
    expect(
      verify.prepare('SELECT COUNT(*) AS count FROM subtasks WHERE todo_id = ?')
        .get(todo.id),
    ).toEqual({ count: 0 });
    expect(
      verify.prepare('SELECT COUNT(*) AS count FROM todo_tags WHERE todo_id = ?')
        .get(todo.id),
    ).toEqual({ count: 0 });
    expect(verify.prepare('SELECT id FROM tags WHERE id = ?').get(tagId)).toBeDefined();
  } finally {
    verify.close();
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
