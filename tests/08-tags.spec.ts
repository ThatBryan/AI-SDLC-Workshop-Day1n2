import { randomUUID } from 'node:crypto';
import {
  AuthPage,
  createTag,
  createTodo,
  expect,
  ORIGIN,
  test,
  uniqueUsername,
  VirtualPasskeys,
} from './helpers';

test.beforeEach(async ({ page, auth, passkeys }) => {
  await page.goto('/');
  await auth.expectLogin();
  await auth.register(uniqueUsername());
  await passkeys.onlyCredential();
});

test('creates a colored tag in Manage Tags and exposes it in the todo selector', async ({
  page,
}) => {
  const name = `Color ${randomUUID()}`;
  const color = '#12AB34';
  await page.getByRole('button', { name: /Manage Tags/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Manage Tags' });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('Tag name').fill(name);
  await dialog.locator('input[type="color"]').fill(color);
  await dialog.getByRole('button', { name: 'Create Tag', exact: true }).click();
  await expect(dialog.getByRole('button', { name, exact: true }))
    .toHaveCSS('background-color', 'rgb(18, 171, 52)');
  await expect(dialog.getByRole('button', { name, exact: true }))
    .toHaveCSS('color', 'rgb(0, 0, 0)');

  const response = await page.request.get('/api/tags');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual(
    expect.arrayContaining([expect.objectContaining({ name, color })]),
  );
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
});

test('rejects invalid tag names and colors and reports duplicate names', async ({ page }) => {
  for (const name of ['', '   ']) {
    const response = await page.request.post('/api/tags', { data: { name } });
    expect(response.status()).toBe(400);
  }
  const trimmed = await page.request.post('/api/tags', {
    data: { name: '  Trimmed tag  ' },
  });
  expect(trimmed.status()).toBe(201);
  expect(await trimmed.json()).toMatchObject({
    name: 'Trimmed tag',
    color: '#3B82F6',
  });

  for (const color of ['red', '#ZZZ', '#12345']) {
    const response = await page.request.post('/api/tags', {
      data: { name: `Invalid color ${randomUUID()}`, color },
    });
    expect(response.status()).toBe(400);
  }

  const name = `Duplicate ${randomUUID()}`;
  await createTag(page, name);
  const duplicate = await page.request.post('/api/tags', {
    data: { name, color: '#123456' },
  });
  expect(duplicate.status()).toBe(409);
  expect(await duplicate.json()).toMatchObject({
    error: 'A tag with this name already exists',
  });
  const listed = await page.request.get('/api/tags');
  expect((await listed.json()).filter((tag: { name: string }) => tag.name === name))
    .toHaveLength(1);

  await page.getByRole('button', { name: /Manage Tags/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Manage Tags' });
  await dialog.getByPlaceholder('Tag name').fill(name);
  await dialog.getByRole('button', { name: 'Create Tag', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('A tag with this name already exists');
});

test('assigns multiple tags and filters by a tag, including clearing the filter', async ({
  page,
}) => {
  const work = await createTag(page, `Work ${randomUUID()}`, '#224466');
  const home = await createTag(page, `Home ${randomUUID()}`, '#AA5500');
  await page.reload();

  await page.getByRole('button', { name: work.name, exact: true }).first().click();
  await page.getByRole('button', { name: home.name, exact: true }).click();
  const sharedTodo = `Both tags ${randomUUID()}`;
  const sharedCard = await createTodo(page, sharedTodo);
  await expect(sharedCard).toContainText(work.name);
  await expect(sharedCard).toContainText(home.name);

  await page.getByRole('button', { name: work.name, exact: true }).first().click();
  const workTodo = `Work only ${randomUUID()}`;
  const workCard = await createTodo(page, workTodo);
  await expect(workCard).toContainText(work.name);
  await expect(workCard).not.toContainText(home.name);

  await page.getByRole('button', { name: home.name, exact: true }).first().click();
  const homeTodo = `Home only ${randomUUID()}`;
  const homeCard = await createTodo(page, homeTodo);
  await expect(homeCard).toContainText(home.name);
  await expect(homeCard).not.toContainText(work.name);

  await page.getByRole('combobox', { name: 'All Tags' }).selectOption({ label: work.name });
  await expect(page.getByRole('listitem').filter({ hasText: sharedTodo })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: workTodo })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: homeTodo })).toHaveCount(0);

  await page.getByRole('combobox', { name: 'All Tags' }).selectOption({ label: 'All Tags' });
  await expect(page.getByRole('listitem').filter({ hasText: sharedTodo })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: workTodo })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: homeTodo })).toBeVisible();

  await workCard.getByRole('button', { name: `Filter by ${work.name}`, exact: true }).click();
  await expect(page.getByRole('listitem').filter({ hasText: homeTodo })).toHaveCount(0);
});

test('updates a tag through Manage Tags and propagates it to existing todos', async ({ page }) => {
  const initialName = `Old ${randomUUID()}`;
  const tag = await createTag(page, initialName, '#114477');
  await page.reload();
  await page.getByRole('button', { name: initialName, exact: true }).click();
  const title = `Existing todo ${randomUUID()}`;
  const card = await createTodo(page, title);
  await expect(card).toContainText(initialName);

  await page.getByRole('button', { name: /Manage Tags/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Manage Tags' });
  const row = dialog.getByRole('listitem').filter({ hasText: initialName });
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  const updatedName = `Renamed ${randomUUID()}`;
  await dialog.getByLabel('Tag name', { exact: true }).fill(updatedName);
  await dialog.locator('input[type="color"]').first().fill('#778899');
  await dialog.getByRole('button', { name: 'Update', exact: true }).click();

  await expect(card).toContainText(updatedName);
  await expect(card).not.toContainText(initialName);
  const todosResponse = await page.request.get('/api/todos');
  const todos = await todosResponse.json() as Array<{
    id: number;
    title: string;
    tags: Array<{ id: number; name: string; color: string }>;
  }>;
  const updatedTodo = todos.find((todo) => todo.title === title);
  expect(updatedTodo?.tags).toEqual([
    expect.objectContaining({ id: tag.id, name: updatedName, color: '#778899' }),
  ]);
  const updatedTags = await page.request.get('/api/tags');
  expect(await updatedTags.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: tag.id, name: updatedName, color: '#778899' }),
    ]),
  );
});

test('deleting a tag cascades from todos while retaining their other tags', async ({ page }) => {
  const removed = await createTag(page, `Delete ${randomUUID()}`);
  const retained = await createTag(page, `Retain ${randomUUID()}`);
  await page.reload();
  await page.getByRole('button', { name: removed.name, exact: true }).click();
  await page.getByRole('button', { name: retained.name, exact: true }).click();
  const title = `Cascade ${randomUUID()}`;
  const card = await createTodo(page, title);
  await expect(card).toContainText(removed.name);
  await expect(card).toContainText(retained.name);

  const tagFilter = page.getByRole('combobox', { name: 'All Tags' });
  await tagFilter.selectOption({ label: removed.name });
  await page.getByRole('button', { name: /Manage Tags/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Manage Tags' });
  const row = dialog.getByRole('listitem').filter({ hasText: removed.name });
  page.once('dialog', (confirmation) => confirmation.accept());
  await row.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(page.getByRole('listitem').filter({ hasText: title })).not.toContainText(removed.name);
  await expect(page.getByRole('listitem').filter({ hasText: title })).toContainText(retained.name);
  await expect(tagFilter).toHaveValue('all');
  expect((await page.request.get('/api/tags')).status()).toBe(200);
});

test('tag endpoints require authentication', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: ORIGIN });
  try {
    const unauthenticated = context.request;
    expect((await unauthenticated.get('/api/tags')).status()).toBe(401);
    expect((await unauthenticated.post('/api/tags', {
      data: { name: 'Unauthenticated' },
    })).status()).toBe(401);
    expect((await unauthenticated.put('/api/tags/1', {
      data: { name: 'Unauthenticated' },
    })).status()).toBe(401);
    expect((await unauthenticated.delete('/api/tags/1')).status()).toBe(401);
    expect((await unauthenticated.post('/api/todos/1/tags', {
      data: { tag_id: 1 },
    })).status()).toBe(401);
    expect((await unauthenticated.delete('/api/todos/1/tags', {
      data: { tag_id: 1 },
    })).status()).toBe(401);
  } finally {
    await context.close();
  }
});

test('attach and detach requests are idempotent', async ({ page }) => {
  const tag = await createTag(page, `Toggle ${randomUUID()}`);
  const createTodoResponse = await page.request.post('/api/todos', {
    data: { title: `Toggle todo ${randomUUID()}` },
  });
  expect(createTodoResponse.status()).toBe(201);
  const todo = await createTodoResponse.json() as { id: number };
  const path = `/api/todos/${todo.id}/tags`;

  expect((await page.request.post(path, { data: { tag_id: tag.id } })).ok()).toBe(true);
  expect((await page.request.post(path, { data: { tag_id: tag.id } })).ok()).toBe(true);
  expect((await page.request.delete(path, { data: { tag_id: tag.id } })).ok()).toBe(true);
  expect((await page.request.delete(path, { data: { tag_id: tag.id } })).ok()).toBe(true);
  const saved = await page.request.get(`/api/todos/${todo.id}`);
  expect((await saved.json()).tags).toEqual([]);
});

test('returns 404 for cross-user tag and todo-tag access', async ({ browser, page }) => {
  const tag = await createTag(page, `Private ${randomUUID()}`);
  const todoResponse = await page.request.post('/api/todos', {
    data: { title: `Private todo ${randomUUID()}` },
  });
  const todo = await todoResponse.json() as { id: number };

  const otherContext = await browser.newContext({
    baseURL: ORIGIN,
    timezoneId: 'Asia/Singapore',
  });
  let otherPasskeys: VirtualPasskeys | undefined;
  try {
    const otherPage = await otherContext.newPage();
    otherPasskeys = await VirtualPasskeys.create(otherPage);
    const otherAuth = new AuthPage(otherPage);
    await otherAuth.gotoLogin();
    await otherAuth.register(uniqueUsername());
    await otherPasskeys.onlyCredential();

    expect(await (await otherPage.request.get('/api/tags')).json()).toEqual([]);
    expect((await otherPage.request.put(`/api/tags/${tag.id}`, {
      data: { name: 'Stolen tag' },
    })).status()).toBe(404);
    expect((await otherPage.request.delete(`/api/tags/${tag.id}`)).status()).toBe(404);
    expect((await otherPage.request.post(`/api/todos/${todo.id}/tags`, {
      data: { tag_id: tag.id },
    })).status()).toBe(404);
    expect((await otherPage.request.delete(`/api/todos/${todo.id}/tags`, {
      data: { tag_id: tag.id },
    })).status()).toBe(404);
  } finally {
    await otherPasskeys?.dispose();
    await otherContext.close();
  }
});
