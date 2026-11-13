import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FullConfig } from '@playwright/test';

export default async function globalSetup(config: FullConfig) {
  const project = config.projects[0];
  const baseURL = project?.use.baseURL;
  if (typeof baseURL !== 'string') {
    throw new Error('Playwright baseURL must be configured');
  }

  const hostname = new URL(baseURL).hostname;
  await mkdir(path.join(process.cwd(), 'test-results'), { recursive: true });
  const output = execFileSync(
    process.execPath,
    [
      '--conditions=react-server',
      '--experimental-strip-types',
      path.join(process.cwd(), 'tests', 'create-e2e-session.mjs'),
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: process.env,
    },
  );
  const { token, otherToken } = JSON.parse(output) as {
    token: string;
    otherToken: string;
  };
  if (!token || !otherToken) {
    throw new Error('Could not create the Playwright session tokens');
  }

  const createStorageState = (sessionToken: string) =>
    JSON.stringify({
      cookies: [
        {
          name: 'todo_session',
          value: sessionToken,
          domain: hostname,
          path: '/',
          expires: Math.floor(Date.now() / 1000) + 60 * 60,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    });
  await Promise.all([
    writeFile(
      path.join(process.cwd(), 'test-results', 'auth-state.json'),
      createStorageState(token),
    ),
    writeFile(
      path.join(process.cwd(), 'test-results', 'other-auth-state.json'),
      createStorageState(otherToken),
    ),
  ]);
}
