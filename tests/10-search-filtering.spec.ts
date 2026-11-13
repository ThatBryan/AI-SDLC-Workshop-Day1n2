import { createTag, expect, test, uniqueUsername } from './helpers';

test.beforeEach(async ({ page, auth, passkeys }) => {
  await page.goto('/');
  await auth.expectLogin();
  await auth.register(uniqueUsername());
  await passkeys.onlyCredential();
  await expect(page.getByText('You have no todos yet.')).toBeVisible();
});

test('debounces case-insensitive title and subtask search and clears immediately', async ({ page }) => {
  const first = await page.request.post('/api/todos', { data: { title: 'Team meeting' } });
  const second = await page.request.post('/api/todos', { data: { title: 'Shopping' } });
  expect(first.status()).toBe(201);
  const shopping = await second.json() as { id: number };
  await page.route('**/api/todos', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const todos = await response.json() as Array<{ id: number; subtasks: unknown[] }>;
    const item = todos.find((todo) => todo.id === shopping.id);
    if (item) item.subtasks = [{ id: 1, todo_id: shopping.id, title: 'Discuss MEETING notes', completed: false, position: 0, created_at: '' }];
    await route.fulfill({ response, json: todos });
  });
  await page.reload();
  await expect(page.getByText('Team meeting')).toBeVisible();
  const search = page.getByLabel('Search todos and subtasks');
  await search.fill('notes');
  await expect(page.getByRole('button', { name: 'Clear search' })).toBeVisible();
  await page.waitForTimeout(250);
  await expect(page.getByText('Team meeting')).toBeVisible();
  await page.waitForTimeout(75);
  await expect(page.getByText('Team meeting')).toHaveCount(0);
  await expect(page.getByText('Shopping')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.getByText('Team meeting')).toBeVisible();
  await search.fill('missing');
  await page.waitForTimeout(200);
  await search.fill('notes');
  await page.waitForTimeout(250);
  await expect(page.getByText('Team meeting')).toBeVisible();
  await page.waitForTimeout(75);
  await expect(page.getByText('Team meeting')).toHaveCount(0);
  await expect(page.getByText('Shopping')).toBeVisible();
  await search.fill('MEETING');
  await page.waitForTimeout(350);
  await expect(page.getByText('Team meeting')).toBeVisible();
  await expect(page.getByText('Shopping')).toBeVisible();
});

test('combines all filters, hides empty sections and clears all', async ({ page }) => {
  const tag = await createTag(page, 'Work');
  for (const data of [
    { title: 'Team meeting', priority: 'high', due_date: '2099-11-02T00:30:00+08:00', tag_ids: [tag.id] },
    { title: 'Other meeting', priority: 'low', due_date: '2099-11-02T12:00:00+08:00', tag_ids: [tag.id] },
    { title: 'No date', priority: 'high', tag_ids: [tag.id] },
  ]) {
    expect((await page.request.post('/api/todos', { data })).status()).toBe(201);
  }
  await page.reload();
  await expect(page.getByRole('region', { name: 'Pending' })).toContainText('Team meeting');
  await page.getByLabel('Search todos and subtasks').fill('MEETING');
  await page.locator('#priority-filter').selectOption('high');
  await page.getByLabel('All Tags').selectOption(String(tag.id));
  const toggle = page.getByRole('button', { name: /Advanced/ });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.getByLabel('Completion Status').selectOption('incomplete');
  await page.getByLabel('Due Date From').fill('2099-11-02');
  await page.getByLabel('Due Date To').fill('2099-11-02');
  await expect(page.getByText('Team meeting')).toBeVisible();
  await expect(page.getByText('Other meeting')).toHaveCount(0);
  await expect(page.getByText('No date')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Pending' })).toContainText('Pending (1)');
  await expect(page.getByRole('region', { name: 'Completed' })).toHaveCount(0);
  await page.getByLabel('Completion Status').selectOption('completed');
  await expect(page.getByText('No todos match your filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear All' }).click();
  await expect(page.getByText('No date')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Filter' })).toHaveCount(0);
  await expect(page.getByLabel('Due Date From')).toHaveValue('');
  await expect(page.getByLabel('All Tags')).toHaveValue('all');
  await expect(page.getByLabel('Completion Status')).toHaveValue('all');
});

test('saves, reloads, applies and deletes a full preset and degrades a missing tag', async ({ page }) => {
  const tag = await createTag(page, 'Saved tag');
  expect((await page.request.post('/api/todos', { data: {
    title: 'Preset meeting', priority: 'high', due_date: '2099-11-02T12:00:00+08:00', tag_ids: [tag.id],
  } })).status()).toBe(201);
  await page.reload();
  await page.getByLabel('Search todos and subtasks').fill('meeting');
  await page.locator('#priority-filter').selectOption('high');
  await page.getByLabel('All Tags').selectOption(String(tag.id));
  await page.getByRole('button', { name: /Advanced/ }).click();
  await page.getByLabel('Completion Status').selectOption('incomplete');
  await page.getByLabel('Due Date From').fill('2099-11-01');
  await page.getByLabel('Due Date To').fill('2099-11-03');
  await page.getByRole('button', { name: 'Save Filter' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save Filter' });
  await expect(dialog).toContainText('Search: "meeting"');
  await expect(dialog).toContainText('Tag: Saved tag');
  await dialog.getByLabel('Filter name').fill('My preset');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: /Advanced/ }).click();
  await page.getByLabel('Search todos and subtasks').fill('stale search');
  await page.locator('#priority-filter').selectOption('low');
  await page.getByLabel('All Tags').selectOption('all');
  await page.getByLabel('Completion Status').selectOption('completed');
  await page.getByLabel('Due Date From').fill('2100-01-01');
  await page.getByLabel('Due Date To').fill('2100-01-02');
  await page.getByRole('button', { name: 'My preset', exact: true }).click();
  await expect(page.getByLabel('Search todos and subtasks')).toHaveValue('meeting');
  await expect(page.locator('#priority-filter')).toHaveValue('high');
  await expect(page.getByLabel('All Tags')).toHaveValue(String(tag.id));
  await expect(page.getByLabel('Completion Status')).toHaveValue('incomplete');
  await expect(page.getByLabel('Due Date From')).toHaveValue('2099-11-01');
  await expect(page.getByLabel('Due Date To')).toHaveValue('2099-11-03');
  await expect(page.getByText('Preset meeting')).toBeVisible();
  expect((await page.request.delete(`/api/tags/${tag.id}`)).status()).toBe(200);
  await page.reload();
  await page.getByRole('button', { name: /Advanced/ }).click();
  await page.getByRole('button', { name: 'My preset', exact: true }).click();
  await expect(page.getByLabel('All Tags')).toHaveValue('all');
  await expect(page.getByText('The saved tag no longer exists; showing all tags.')).toBeVisible();
  page.once('dialog', (confirmation) => confirmation.accept());
  await page.getByRole('button', { name: 'Delete preset My preset' }).click();
  await page.reload();
  await page.getByRole('button', { name: /Advanced/ }).click();
  await expect(page.getByRole('button', { name: 'My preset', exact: true })).toHaveCount(0);
});

test('handles corrupt storage and reports a quota failure', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('todo-app:filter-presets', '[{"filters":{}}]'));
  await page.reload();
  await expect(page.getByText(/Could not load saved filters/)).toBeVisible();
  await page.getByLabel('Search todos and subtasks').fill('something');
  await page.getByRole('button', { name: 'Save Filter' }).click();
  await page.getByLabel('Filter name').fill('Cannot save');
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  });
  await page.getByRole('dialog', { name: 'Save Filter' }).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Could not save preset — storage full.')).toBeVisible();
});
