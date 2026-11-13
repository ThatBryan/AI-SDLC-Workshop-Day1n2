import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const runId = randomUUID();
const databasePath = join(tmpdir(), `todo-auth-e2e-${runId}.sqlite`);
const baseURL = 'http://localhost:3100';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
  ],
  metadata: { authE2E: { runId, databasePath } },
  // helpers defers deletion until process exit, AFTER webServer releases SQLite
  // handles. Playwright runs globalTeardown before stopping its webServer.
  globalTeardown: './tests/helpers.ts',
  use: {
    baseURL,
    timezoneId: 'Asia/Singapore',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev -- --hostname localhost --port 3100',
    // Port probing fails even if the existing listener doesn't serve HTTP.
    port: 3100,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: 'development',
      SESSION_SECRET: randomBytes(48).toString('base64url'),
      RP_NAME: 'Todo App',
      RP_ID: 'localhost',
      RP_ORIGIN: baseURL,
      DATABASE_PATH: databasePath,
      TZ: 'Asia/Singapore',
    },
  },
});
