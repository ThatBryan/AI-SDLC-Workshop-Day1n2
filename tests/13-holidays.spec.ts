import { expect, test, uniqueUsername } from './helpers';

test.beforeEach(async ({ page, auth, passkeys }) => {
  await page.goto('/');
  await auth.expectLogin();
  await auth.register(uniqueUsername());
  await passkeys.onlyCredential();
});

test('shows a seeded Singapore public holiday in its calendar cell and day details', async ({ page }, testInfo) => {
  const metadata = testInfo.config.metadata as {
    authE2E?: { databasePath?: unknown };
  };
  const databasePath = metadata.authE2E?.databasePath;
  if (typeof databasePath !== 'string') {
    throw new Error('The E2E database path is unavailable');
  }
  process.env.TODO_DB_PATH = databasePath;
  process.env.DATABASE_PATH = databasePath;
  const { holidayDB } = await import('../lib/db.ts');
  holidayDB.upsertMany([{ date: '2026-12-25', name: 'Christmas Day' }]);

  await page.goto('/calendar?month=2026-12');
  const christmas = page.getByRole('gridcell', { name: /2026-12-25/ });
  await expect(christmas.getByText('Christmas Day', { exact: true })).toBeVisible();
  await christmas.click();

  await expect(page.getByRole('dialog')).toContainText('Christmas Day');
});
