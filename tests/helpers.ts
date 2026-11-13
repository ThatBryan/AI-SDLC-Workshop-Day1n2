import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  test as base, expect,
  type CDPSession, type FullConfig, type Locator, type Page,
  type Response, type TestInfo,
} from '@playwright/test';
import type { Priority } from '../lib/priority';

export { expect };
export const ORIGIN = 'http://localhost:3100';
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export type VirtualCredential = Awaited<ReturnType<VirtualPasskeys['credentials']>>[number];

export function uniqueUsername(): string {
  return `e2e-${randomUUID()}`;
}

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

export async function createTag(
  page: Page,
  name: string,
  color = '#3B82F6',
): Promise<{ id: number; name: string; color: string }> {
  const response = await page.request.post('/api/tags', { data: { name, color } });
  expect(response.status()).toBe(201);
  return await response.json() as { id: number; name: string; color: string };
}

/**
 * Only this run's four exact SQLite filenames may be removed. No app DB import,
 * glob, directory deletion, shell command, or externally supplied DATABASE_PATH.
 * Exit-time cleanup also works with Playwright's explicit process.exit() on
 * Windows, after its server process tree has been terminated.
 */
export default async function globalTeardown(config: FullConfig): Promise<void> {
  const owned = config.metadata.authE2E as {
    runId: string; databasePath: string;
  } | undefined;
  if (!owned || !/^[0-9a-f-]{36}$/i.test(owned.runId) ||
      owned.databasePath !== join(tmpdir(), `todo-auth-e2e-${owned.runId}.sqlite`)) {
    throw new Error('Refusing cleanup of an unowned E2E database');
  }
  process.once('exit', () => {
    for (const suffix of ['-wal', '-shm', '-journal', '']) {
      for (let attempt = 0; ; attempt++) {
        try {
          unlinkSync(owned.databasePath + suffix);
          break;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') break;
          if (['EBUSY', 'EPERM', 'EACCES'].includes(code ?? '') && attempt < 20) {
            // Bounded synchronous retry: asynchronous work cannot run at exit.
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
            continue;
          }
          console.error('Could not remove owned E2E SQLite file:', error);
          process.exitCode = 1;
          break;
        }
      }
    }
  });
}

export class VirtualPasskeys {
  readonly authenticatorIds: string[] = [];
  primaryId!: string;

  private constructor(readonly cdp: CDPSession) {}

  static async create(page: Page): Promise<VirtualPasskeys> {
    const keys = new VirtualPasskeys(await page.context().newCDPSession(page));
    await keys.cdp.send('WebAuthn.enable', { enableUI: false });
    keys.primaryId = await keys.addAuthenticator();
    return keys;
  }

  async addAuthenticator(active = true): Promise<string> {
    const { authenticatorId } = await this.cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'usb',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: false,
      },
    });
    this.authenticatorIds.push(authenticatorId);
    if (active) await this.activate(authenticatorId);
    return authenticatorId;
  }

  async activate(id: string): Promise<void> {
    if (!this.authenticatorIds.includes(id)) throw new Error('Unknown authenticator');
    // Disable all devices first so no request can select the wrong passkey.
    for (const authenticatorId of this.authenticatorIds) {
      await this.cdp.send('WebAuthn.setAutomaticPresenceSimulation', {
        authenticatorId, enabled: false,
      });
    }
    await this.cdp.send('WebAuthn.setAutomaticPresenceSimulation', {
      authenticatorId: id, enabled: true,
    });
  }

  async credentials(id = this.primaryId) {
    const { credentials } = await this.cdp.send('WebAuthn.getCredentials', {
      authenticatorId: id,
    });
    return credentials;
  }

  async onlyCredential(id = this.primaryId): Promise<VirtualCredential> {
    const credentials = await this.credentials(id);
    expect(credentials).toHaveLength(1);
    return credentials[0];
  }

  async replaceCounter(credential: VirtualCredential, signCount: number,
    id = this.primaryId): Promise<void> {
    await this.cdp.send('WebAuthn.removeCredential', {
      authenticatorId: id, credentialId: credential.credentialId,
    });
    // Preserve the real RP, ID, private key and user handle. Only the physical
    // authenticator's counter changes; the server DB is never modified.
    await this.cdp.send('WebAuthn.addCredential', {
      authenticatorId: id, credential: { ...credential, signCount },
    });
  }

  async dispose(): Promise<void> {
    for (const authenticatorId of this.authenticatorIds) {
      await this.cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    }
    await this.cdp.send('WebAuthn.disable');
    await this.cdp.detach();
  }
}

/** Waiters are installed before clicks, including very fast error responses. */
export async function postResponses(
  page: Page, paths: string[], action: () => Promise<unknown>,
): Promise<Response[]> {
  const responses = paths.map((path) => page.waitForResponse((response) =>
    response.url() === `${ORIGIN}${path}` && response.request().method() === 'POST'));
  const results = await Promise.all([action(), ...responses]);
  return results.slice(1) as Response[];
}

export function assertionCounter(response: Response): number {
  const body = response.request().postDataJSON();
  const bytes = Buffer.from(body.response.response.authenticatorData, 'base64url');
  expect(bytes.length).toBeGreaterThanOrEqual(37);
  // authenticatorData = rpIdHash[32] | flags[1] | signCount[4] | ...
  return bytes.readUInt32BE(33);
}

export async function checkpoint(page: Page, info: TestInfo, name: string): Promise<void> {
  await info.attach(name, {
    body: await page.screenshot({ fullPage: true }), contentType: 'image/png',
  });
}

/**
 * Tests-first UI contract:
 * /login: heading Todo App, label Username, Register/Login buttons, role alert.
 * Protected shell: session-user test ID, Logout button at top right.
 * /: heading My todos and the authenticated todo-title input.
 * Enrollment: Add passkey -> status Existing passkey verified ->
 * Save new passkey (separate click) -> status Passkey added.
 */
export class AuthPage {
  readonly username: Locator;
  readonly registerButton: Locator;
  readonly loginButton: Locator;
  readonly logoutButton: Locator;
  readonly alert: Locator;

  constructor(readonly page: Page) {
    this.username = page.getByLabel('Username', { exact: true });
    this.registerButton = page.getByRole('button', { name: 'Register', exact: true });
    this.loginButton = page.getByRole('button', { name: 'Login', exact: true });
    this.logoutButton = page.getByRole('button', { name: 'Logout', exact: true });
    this.alert = page.getByRole('main').getByRole('alert');
  }

  async gotoLogin(): Promise<void> {
    await this.page.goto('/login');
    await this.expectLogin();
  }

  async expectLogin(): Promise<void> {
    await expect(this.page).toHaveURL(`${ORIGIN}/login`);
    await expect(this.page.getByRole('heading', { name: 'Todo App', exact: true })).toBeVisible();
    await expect(this.username).toBeVisible();
    await expect(this.registerButton).toBeVisible();
    await expect(this.loginButton).toBeVisible();
  }

  async expectHome(username: string): Promise<void> {
    await expect(this.page).toHaveURL(`${ORIGIN}/`);
    await expect(this.page.getByRole('heading', { name: 'My todos', exact: true })).toBeVisible();
    await expect(this.page.getByLabel('Todo title')).toBeVisible();
    await expect(this.page.getByTestId('session-user')).toContainText(username);
    await expect(this.logoutButton).toBeVisible();
  }

  async register(username: string): Promise<Response> {
    await this.gotoLogin();
    await this.username.fill(username);
    const [options, verify] = await postResponses(this.page, [
      '/api/auth/register-options', '/api/auth/register-verify',
    ], () => this.registerButton.click());
    expect(options.status()).toBe(200);
    expect(verify.status()).toBe(200);
    await this.expectHome(username);
    return verify;
  }

  async attemptLogin(username: string): Promise<Response> {
    await this.username.fill(username);
    const [options, verify] = await postResponses(this.page, [
      '/api/auth/login-options', '/api/auth/login-verify',
    ], () => this.loginButton.click());
    expect(options.status()).toBe(200);
    return verify;
  }

  async login(username: string): Promise<Response> {
    const verify = await this.attemptLogin(username);
    expect(verify.status()).toBe(200);
    await this.expectHome(username);
    return verify;
  }

  async logout(): Promise<void> {
    const [response] = await postResponses(this.page, ['/api/auth/logout'],
      () => this.logoutButton.click());
    expect(response.status()).toBe(200);
    await this.expectLogin();
    expect((await this.page.context().cookies()).some((cookie) => cookie.name === 'session')).toBe(false);
  }
}

export const test = base.extend<{ auth: AuthPage; passkeys: VirtualPasskeys }>({
  auth: async ({ page }, provide) => { await provide(new AuthPage(page)); },
  passkeys: async ({ page }, provide) => {
    const keys = await VirtualPasskeys.create(page);
    try {
      await provide(keys);
    } finally {
      // A restart test may deliberately close the entire original context.
      if (!page.isClosed()) await keys.dispose();
    }
  },
});
