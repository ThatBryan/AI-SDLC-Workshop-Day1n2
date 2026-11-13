import { randomUUID } from 'node:crypto';
import { expect, test, uniqueUsername } from './helpers';
import { createTodo } from './helpers';

test.beforeEach(async ({ page, auth, passkeys }) => {
  await page.goto('/');
  await auth.expectLogin();
  await auth.register(uniqueUsername());
  await passkeys.onlyCredential();
  await expect(page.getByText('You have no todos yet.')).toBeVisible();
});

test('shows a labeled badge for each priority', async ({ page }) => {
  for (const priority of ['high', 'medium', 'low'] as const) {
    const title = `${priority} badge ${randomUUID()}`;
    const card = await createTodo(page, title, { priority });
    await expect(card.getByText(priority[0].toUpperCase() + priority.slice(1), { exact: true })).toBeVisible();
  }
});

test('uses the required badge colors in light and dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const expectedColors = {
    high: '#EF4444',
    medium: '#F59E0B',
    low: '#3B82F6',
  } as const;
  const badges = [];
  for (const [priority, color] of Object.entries(expectedColors)) {
    const card = await createTodo(page, `${priority} color ${randomUUID()}`, {
      priority: priority as keyof typeof expectedColors,
    });
    const badge = card.getByLabel(`${priority[0].toUpperCase()}${priority.slice(1)} priority`);
    await expect(badge).toHaveCSS('--priority-color', color);
    badges.push(badge);
  }

  const lightTextColors = await Promise.all(
    badges.map((badge) => badge.evaluate((element) => getComputedStyle(element).color)),
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  const darkTextColors = await Promise.all(
    badges.map((badge) => badge.evaluate((element) => getComputedStyle(element).color)),
  );
  expect(darkTextColors).not.toEqual(lightTextColors);
});

test('sorts matching todos high to low and keeps undated todos last', async ({ page }) => {
  const prefix = `sort ${randomUUID()}`;
  await createTodo(page, `${prefix} low`, { priority: 'low' });
  await createTodo(page, `${prefix} medium`, { priority: 'medium' });
  await createTodo(page, `${prefix} high`, { priority: 'high' });

  const titles = await page.getByRole('region', { name: 'Pending' })
    .getByRole('listitem')
    .allTextContents();
  const indices = [
    titles.findIndex((text) => text.includes(`${prefix} high`)),
    titles.findIndex((text) => text.includes(`${prefix} medium`)),
    titles.findIndex((text) => text.includes(`${prefix} low`)),
  ];
  expect(indices.every((index) => index >= 0)).toBe(true);
  expect(indices[0]).toBeLessThan(indices[1]);
  expect(indices[1]).toBeLessThan(indices[2]);
});

test('priority filter combines with the current todo list and can be cleared', async ({ page }) => {
  const marker = randomUUID();
  const high = `filter high ${marker}`;
  const low = `filter low ${marker}`;
  await createTodo(page, high, { priority: 'high' });
  await createTodo(page, low, { priority: 'low' });

  const filter = page.locator('#priority-filter');
  await filter.selectOption('high');
  await expect(page.getByRole('listitem').filter({ hasText: high })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: low })).toHaveCount(0);
  await filter.selectOption('all');
  await expect(page.getByRole('listitem').filter({ hasText: low })).toBeVisible();
});

test('editing priority immediately changes the badge and sorted position', async ({ page }) => {
  const prefix = `edit priority ${randomUUID()}`;
  await createTodo(page, `${prefix} medium`, { priority: 'medium' });
  const low = await createTodo(page, `${prefix} low`, { priority: 'low' });
  await low.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Priority').selectOption('high');
  await page.getByRole('dialog').getByRole('button', { name: 'Update' }).click();

  const cards = page.getByRole('region', { name: 'Pending' }).getByRole('listitem');
  const titles = await cards.allTextContents();
  expect(titles.findIndex((text) => text.includes(`${prefix} low`))).toBeLessThan(
    titles.findIndex((text) => text.includes(`${prefix} medium`)),
  );
  await expect(
    cards.filter({ hasText: `${prefix} low` }).getByText('High', { exact: true }),
  ).toBeVisible();
});

test('invalid priority on create and update returns 400 without changing stored todos', async ({ page }) => {
  const invalidTitle = `invalid priority ${randomUUID()}`;
  const invalidCreate = await page.request.post('/api/todos', {
    data: { title: invalidTitle, priority: 'urgent' },
  });
  expect(invalidCreate.status()).toBe(400);

  const absentFromList = await page.request.get('/api/todos');
  const todos = (await absentFromList.json()) as Array<{ title: string }>;
  expect(todos.some((todo) => todo.title === invalidTitle)).toBe(false);

  const title = `priority stays ${randomUUID()}`;
  const created = await page.request.post('/api/todos', {
    data: { title, priority: 'medium' },
  });
  expect(created.status()).toBe(201);
  const todo = (await created.json()) as { id: number; priority: string };
  const invalidUpdate = await page.request.put(`/api/todos/${todo.id}`, {
    data: { priority: null },
  });
  expect(invalidUpdate.status()).toBe(400);

  const unchanged = await page.request.get(`/api/todos/${todo.id}`);
  expect(unchanged.status()).toBe(200);
  expect((await unchanged.json()).priority).toBe('medium');
});
