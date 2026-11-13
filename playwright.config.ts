import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:3317';
const jwtSecret = randomBytes(32).toString('hex');
const databasePath = path.join(process.cwd(), 'test-results', 'playwright-todos.db');

process.env.JWT_SECRET = jwtSecret;
process.env.TODO_DB_PATH = databasePath;
process.env.PLAYWRIGHT_BASE_URL = baseURL;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  workers: 1,
  globalSetup: './tests/global-setup.ts',
  reporter: 'list',
  use: {
    baseURL,
    storageState: 'test-results/auth-state.json',
    timezoneId: 'Asia/Singapore',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3317',
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      JWT_SECRET: jwtSecret,
      TODO_DB_PATH: databasePath,
    },
  },
});
