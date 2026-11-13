import { randomUUID } from 'node:crypto';
import { expect, test, uniqueUsername } from './helpers';
import { createTodo } from './helpers';

type ExportTodo = {
  title: string;
  completed: boolean;
  due_date: string | null;
  priority: 'high' | 'medium' | 'low';
  is_recurring: boolean;
  recurrence_pattern: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
  reminder_minutes: number | null;
  created_at: string;
  subtasks: Array<{ title: string; completed: boolean; position: number }>;
  tags: Array<{ name: string; color: string }>;
};

function envelope(todos: ExportTodo[]) {
  return {
    version: 1,
    exported_at: '2026-01-01T00:00:00.000Z',
    todos,
  };
}

function exportTodo(title: string): ExportTodo {
  return {
    title,
    completed: false,
    due_date: null,
    priority: 'medium',
    is_recurring: false,
    recurrence_pattern: null,
    reminder_minutes: null,
    created_at: '2026-01-01T00:00:00.000Z',
    subtasks: [{ title: 'Imported subtask', completed: false, position: 0 }],
    tags: [{ name: `import-${randomUUID()}`, color: '#3B82F6' }],
  };
}

async function uploadJson(page: import('@playwright/test').Page, payload: unknown): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'todos.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload)),
  });
}

async function downloadText(download: import('@playwright/test').Download): Promise<string> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Download stream was unavailable');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function getTodos(page: import('@playwright/test').Page): Promise<Array<{ title: string }>> {
  const response = await page.request.get('/api/todos');
  expect(response.ok()).toBe(true);
  const body: unknown = await response.json();
  if (Array.isArray(body)) return body as Array<{ title: string }>;
  if (body && typeof body === 'object' && 'todos' in body && Array.isArray(body.todos)) {
    return body.todos as Array<{ title: string }>;
  }
  throw new Error('Todo list response did not contain a todo array');
}

test.beforeEach(async ({ page, auth, passkeys }) => {
  await page.goto('/');
  await auth.expectLogin();
  await auth.register(uniqueUsername());
  await passkeys.onlyCredential();
});

test('exports a versioned JSON backup with related collections and Singapore filename', async ({ page }) => {
  const title = `JSON export ${randomUUID()}`;
  await createTodo(page, title);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^todos-\d{4}-\d{2}-\d{2}\.json$/);
  const backup = JSON.parse(await downloadText(download)) as {
    version: number;
    exported_at: string;
    todos: Array<{ title: string; subtasks: unknown[]; tags: unknown[] }>;
  };
  expect(backup.version).toBe(1);
  expect(Number.isNaN(Date.parse(backup.exported_at))).toBe(false);
  const exported = backup.todos.find((todo) => todo.title === title);
  expect(exported).toBeDefined();
  expect(exported?.subtasks).toEqual([]);
  expect(exported?.tags).toEqual([]);
});

test('exports CSV with the required header, filename, and escaped field values', async ({ page }) => {
  const title = `CSV, "quoted"\nsecond line ${randomUUID()}`;
  const created = await page.request.post('/api/todos', {
    data: { title, priority: 'high' },
  });
  expect(created.status()).toBe(201);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^todos-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await downloadText(download);
  expect(csv.split(/\r?\n/, 1)[0]).toBe(
    'ID,Title,Completed,Due Date,Priority,Recurring,Pattern,Reminder',
  );
  expect(csv).toContain(`"${title.replaceAll('"', '""')}"`);
});

test('imports JSON with subtasks and tags, remapping relationships and reporting success', async ({ page }) => {
  const title = `Imported ${randomUUID()}`;
  const payload = envelope([exportTodo(title)]);

  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await uploadJson(page, payload);

  await expect(page.getByText('Successfully imported 1 todos')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: title })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const exported = JSON.parse(await downloadText(await downloadPromise)) as {
    todos: Array<{
      title: string;
      subtasks: Array<{ title: string; completed: boolean; position: number }>;
      tags: Array<{ name: string; color: string }>;
    }>;
  };
  const restored = exported.todos.find((todo) => todo.title === title);
  expect(restored?.subtasks).toEqual([
    { title: 'Imported subtask', completed: false, position: 0 },
  ]);
  expect(restored?.tags).toEqual(payload.todos[0].tags);
});

test('rejects invalid JSON and structurally invalid data without partial imports', async ({ page }) => {
  const before = await getTodos(page);

  await page.locator('input[type="file"]').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{not json'),
  });
  await expect(page.getByText('Invalid JSON format')).toBeVisible();

  await uploadJson(page, { version: 1, exported_at: '2026-01-01T00:00:00.000Z' });
  await expect(
    page.getByText('Failed to import todos. Please check the file format.'),
  ).toBeVisible();
  expect(await getTodos(page)).toHaveLength(before.length);
});

test('re-importing a valid backup adds duplicate todos instead of merging', async ({ page }) => {
  const title = `Duplicate import ${randomUUID()}`;
  const payload = envelope([exportTodo(title)]);

  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await uploadJson(page, payload);
  await expect(page.getByText('Successfully imported 1 todos')).toBeVisible();

  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await uploadJson(page, payload);
  await expect(page.getByText('Successfully imported 1 todos')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: title })).toHaveCount(2);
});

test('requires authentication for JSON export, CSV export, and import endpoints', async ({ page }) => {
  await page.context().clearCookies();

  const jsonExport = await page.request.get('/api/todos/export?format=json');
  const csvExport = await page.request.get('/api/todos/export?format=csv');
  const importRequest = await page.request.post('/api/todos/import', {
    data: envelope([]),
  });

  expect(jsonExport.status()).toBe(401);
  expect(csvExport.status()).toBe(401);
  expect(importRequest.status()).toBe(401);
});
