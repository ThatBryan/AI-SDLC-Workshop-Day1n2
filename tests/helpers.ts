import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Priority } from '../lib/priority.ts';

export async function createTodo(
  page: Page,
  title: string,
  options: { priority?: Priority; dueDate?: string } = {},
): Promise<Locator> {
  await page.getByLabel('Todo title').fill(title);
  if (options.dueDate) {
    await page.getByLabel('Due date and time').fill(options.dueDate);
  }
  await page.locator('#new-todo-priority').selectOption(options.priority ?? 'medium');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  const card = page.getByRole('listitem').filter({ hasText: title });
  await expect(card).toBeVisible();
  return card;
}
