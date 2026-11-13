import {
  AuthPage, ORIGIN, SESSION_SECONDS, assertionCounter, checkpoint,
  expect, postResponses, test, uniqueUsername,
} from './helpers';

test.describe('Authentication — real Chromium WebAuthn', () => {
  test('registers, displays the session user, logs out and logs in with the same passkey',
    async ({ page, auth, passkeys }, info) => {
      const username = uniqueUsername();
      await auth.register(username);
      expect((await passkeys.onlyCredential()).rpId).toBe('localhost');
      const session = await page.request.get('/api/auth/me');
      expect(session.status()).toBe(200);
      expect(await session.json()).toMatchObject({ username });

      const box = await auth.logoutButton.boundingBox();
      expect(box).not.toBeNull();
      const viewport = page.viewportSize()!;
      expect(box!.x + box!.width / 2).toBeGreaterThan(viewport.width / 2);
      expect(box!.y).toBeLessThan(viewport.height / 4);
      await checkpoint(page, info, 'registered-home');

      await auth.logout();
      expect((await page.request.get('/api/auth/me')).status()).toBe(401);
      await auth.login(username);
      await checkpoint(page, info, 'passkey-login');
    });

  test('rejects duplicate registration and leaves the original account usable',
    async ({ auth, passkeys, page }) => {
      const username = uniqueUsername();
      await auth.register(username);
      const original = await passkeys.onlyCredential();
      await auth.logout();
      await auth.username.fill(username);
      const [response] = await postResponses(page, ['/api/auth/register-options'],
        () => auth.registerButton.click());
      expect(response.status()).toBe(409);
      await expect(auth.alert).toContainText(/username.*(taken|registered|exists)/i);
      await auth.expectLogin();
      expect((await passkeys.onlyCredential()).credentialId).toBe(original.credentialId);
      expect((await page.request.get('/api/auth/me')).status()).toBe(401);
      await auth.login(username);
    });

  test('unknown username shows an accessible sign-in error', async ({ page, auth }) => {
    await auth.gotoLogin();
    await auth.username.fill(uniqueUsername());
    const [response] = await postResponses(page, ['/api/auth/login-options'],
      () => auth.loginButton.click());
    expect(response.status()).toBe(400);
    await expect(auth.alert).toContainText(/unable to sign in with that username/i);
    await auth.expectLogin();
    await expect(auth.loginButton).toBeEnabled();
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  });

  for (const path of ['/', '/calendar']) {
    test(`anonymous navigation to ${path} redirects without exposing protected content`,
      async ({ page, auth }) => {
        const response = await page.request.get(path, { maxRedirects: 0 });
        expect([302, 303, 307, 308]).toContain(response.status());
        expect(new URL(response.headers().location, ORIGIN).pathname).toBe('/login');
        await page.goto(path);
        await auth.expectLogin();
        await expect(page.getByTestId('protected-placeholder')).toHaveCount(0);
        await expect(page.getByTestId('session-user')).toHaveCount(0);
      });
  }

  test('session survives reload, allows calendar, and redirects logged-in /login to home',
    async ({ page, auth, passkeys }) => {
      const username = uniqueUsername();
      await auth.register(username);
      await passkeys.onlyCredential();
      await page.reload();
      await auth.expectHome(username);
      const calendar = await page.goto('/calendar');
      expect(calendar?.status()).toBe(200);
      await expect(page).toHaveURL(`${ORIGIN}/calendar`);
      await expect(page.getByTestId('session-user')).toContainText(username);
      await expect(auth.logoutButton).toBeVisible();
      await page.goto('/login');
      await auth.expectHome(username);
      await auth.logout();
      for (const path of ['/', '/calendar']) {
        await page.goto(path);
        await auth.expectLogin();
      }
    });

  test('persistent session survives a simulated browser restart using in-memory state',
    async ({ browser, page, context, auth, passkeys }, info) => {
      const username = uniqueUsername();
      await auth.register(username);
      await passkeys.onlyCredential();
      const state = await context.storageState(); // Never write tokens to disk.
      const cookie = state.cookies.find((item) => item.name === 'session');
      expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000);
      await context.close();

      // Do not import the old authenticator or any session/local storage. Only
      // persistent cookies from a closed context simulate a browser restart.
      const restarted = await browser.newContext({
        baseURL: ORIGIN,
        timezoneId: 'Asia/Singapore',
        storageState: {
          cookies: state.cookies.filter((item) => item.expires > Date.now() / 1000),
          origins: [],
        },
      });
      try {
        const restartedPage = await restarted.newPage();
        await restartedPage.goto('/');
        const restartedAuth = new AuthPage(restartedPage);
        await restartedAuth.expectHome(username);
        await restartedPage.reload();
        await restartedAuth.expectHome(username);
        await checkpoint(restartedPage, info, 'restored-session');
        await restartedAuth.logout();
      } finally {
        await restarted.close();
      }
      expect(page.isClosed()).toBe(true);
    });

  test('session cookie is HttpOnly, SameSite=Lax, root-scoped and expires in seven days',
    async ({ page, context, auth, passkeys }) => {
      const before = Date.now() / 1000;
      const response = await auth.register(uniqueUsername());
      const after = Date.now() / 1000;
      await passkeys.onlyCredential();
      const cookie = (await context.cookies(ORIGIN)).find((item) => item.name === 'session');
      expect(cookie).toBeDefined();
      expect(cookie).toMatchObject({
        domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax',
        secure: false, // HTTP development server; production must use Secure.
      });
      expect(cookie!.expires).toBeGreaterThanOrEqual(before + SESSION_SECONDS - 5);
      expect(cookie!.expires).toBeLessThanOrEqual(after + SESSION_SECONDS + 5);
      const header = (await response.headersArray())
        .find((item) => item.name.toLowerCase() === 'set-cookie' && item.value.startsWith('session='));
      expect(header?.value).toMatch(/;\s*Max-Age=604800(?:;|$)/i);
      expect(await page.evaluate(() => document.cookie)).not.toMatch(/(?:^|;\s*)session=/);
      // Decode only to check lifetime; this is not used to forge or seed auth.
      const payload = JSON.parse(Buffer.from(cookie!.value.split('.')[1], 'base64url').toString());
      expect(payload.exp - payload.iat).toBe(SESSION_SECONDS);

      // Model the browser having discarded an expired persistent cookie.
      await context.clearCookies({ name: 'session' });
      await page.goto('/');
      await auth.expectLogin();
    });

  test('logout revokes a previously saved persistent session, not just the browser cookie',
    async ({ browser, context, auth, passkeys }) => {
      await auth.register(uniqueUsername());
      await passkeys.onlyCredential();
      const state = await context.storageState();
      await auth.logout();
      const replay = await browser.newContext({
        baseURL: ORIGIN, timezoneId: 'Asia/Singapore', storageState: state,
      });
      try {
        expect((await replay.request.get('/api/auth/me')).status()).toBe(401);
        const page = await replay.newPage();
        await page.goto('/');
        await new AuthPage(page).expectLogin();
      } finally {
        await replay.close();
      }
    });

  test('rejects a genuinely signed stale nonzero counter, then accepts an advancing counter',
    async ({ page, auth, passkeys }) => {
      const username = uniqueUsername();
      await auth.register(username);
      await auth.logout();
      const firstLogin = await auth.login(username);
      const serverCounter = assertionCounter(firstLogin);
      expect(serverCounter).toBeGreaterThan(0);
      const credential = await passkeys.onlyCredential();
      expect(credential.signCount).toBe(serverCounter);
      await auth.logout();

      // Chromium increments before signing, so restoring N-1 emits N again.
      // This is a fresh challenge and genuine signature, NOT a replayed JSON body.
      await passkeys.replaceCounter(credential, serverCounter - 1);
      const stale = await auth.attemptLogin(username);
      expect(assertionCounter(stale)).toBe(serverCounter);
      expect(stale.status()).toBe(401);
      await expect(auth.alert).toContainText(/passkey verification failed/i);
      await auth.expectLogin();
      expect((await page.request.get('/api/auth/me')).status()).toBe(401);
      await page.goto('/');
      await auth.expectLogin();

      await passkeys.replaceCounter(credential, serverCounter);
      const recovered = await auth.login(username);
      expect(assertionCounter(recovered)).toBe(serverCounter + 1);
    });

  test('enrolls a second authenticator only after fresh in-place reauthentication and a second click',
    async ({ page, auth, passkeys }, info) => {
      const username = uniqueUsername();
      await auth.register(username);
      const first = await passkeys.onlyCredential();
      const secondId = await passkeys.addAuthenticator(false);
      const enrollmentRequests: string[] = [];
      page.on('request', (request) => {
        if (request.method() === 'POST' && request.url().startsWith(`${ORIGIN}/api/auth/`)) {
          enrollmentRequests.push(new URL(request.url()).pathname);
        }
      });
      const save = page.getByRole('button', { name: 'Save new passkey', exact: true });
      await expect(save).toBeHidden();
      const [options, verify] = await postResponses(page, [
        '/api/auth/login-options', '/api/auth/login-verify',
      ], () => page.getByRole('button', { name: 'Add passkey', exact: true }).click());
      expect(options.status()).toBe(200);
      expect(verify.status()).toBe(200);
      for (const response of [options, verify]) {
        expect(response.request().postDataJSON()).toMatchObject({ intent: 'add-passkey' });
      }
      expect(assertionCounter(verify)).toBeGreaterThan(first.signCount);
      await expect(page.getByRole('status')).toHaveText('Existing passkey verified');
      await auth.expectHome(username); // No standalone login-page navigation.
      await expect(save).toBeVisible();
      await expect(save).toBeEnabled();
      expect(enrollmentRequests).toEqual(['/api/auth/login-options', '/api/auth/login-verify']);
      expect(await passkeys.credentials(secondId)).toHaveLength(0);
      await checkpoint(page, info, 'existing-passkey-verified');

      await passkeys.activate(secondId); // First device remains present, but inactive.
      const [newOptions, newVerify] = await postResponses(page, [
        '/api/auth/passkeys/options', '/api/auth/passkeys/verify',
      ], () => save.click());
      expect(newOptions.status()).toBe(200);
      expect(newVerify.status()).toBe(200);
      await expect(page.getByRole('status')).toHaveText('Passkey added');
      expect(enrollmentRequests).toEqual([
        '/api/auth/login-options', '/api/auth/login-verify',
        '/api/auth/passkeys/options', '/api/auth/passkeys/verify',
      ]);
      const second = await passkeys.onlyCredential(secondId);
      expect(second.credentialId).not.toBe(first.credentialId);
      expect(second.userHandle).toBe(first.userHandle);
      await checkpoint(page, info, 'second-passkey-added');

      await auth.logout();
      await auth.login(username); // Only the second authenticator can respond.
      await auth.logout();
      await passkeys.activate(passkeys.primaryId);
      await auth.login(username); // Original credential still works.
    });
});

test.describe('Browser capability and cancellation UX — browser-only mocks', () => {
  test('unsupported credential methods explain the problem instead of crashing',
    async ({ page, auth }) => {
      await page.addInitScript(() => {
        Object.defineProperties(navigator.credentials, {
          create: { configurable: true, value: undefined },
          get: { configurable: true, value: undefined },
        });
      });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await auth.gotoLogin();
      await expect(auth.alert).toContainText(/(passkey|webauthn).*(not supported|unsupported|unavailable)/i);
      await expect(auth.registerButton).toBeDisabled();
      await expect(auth.loginButton).toBeDisabled();
      expect(errors).toEqual([]);
    });

  for (const operation of ['Register', 'Login'] as const) {
    test(`${operation} cancellation is actionable and allows a genuine retry`,
      async ({ page, auth, passkeys }) => {
        const username = uniqueUsername();
        if (operation === 'Login') {
          await auth.register(username);
          await passkeys.onlyCredential();
          await auth.logout();
        } else {
          await auth.gotoLogin();
        }
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        // One-shot browser cancellation only; all API traffic remains real.
        await page.evaluate<void, 'create' | 'get'>((method) => {
          const original = navigator.credentials[method].bind(navigator.credentials);
          Object.defineProperty(navigator.credentials, method, {
            configurable: true,
            value: () => {
              Object.defineProperty(navigator.credentials, method, {
                configurable: true, value: original,
              });
              return Promise.reject(new DOMException('The user cancelled the request.', 'NotAllowedError'));
            },
          });
        }, operation === 'Register' ? 'create' : 'get');

        const verifyRequests: string[] = [];
        page.on('request', (request) => {
          if (request.method() === 'POST' && /\/api\/auth\/(?:register|login)-verify$/.test(request.url())) {
            verifyRequests.push(request.url());
          }
        });
        await auth.username.fill(username);
        await page.getByRole('button', { name: operation, exact: true }).click();
        await expect(auth.alert).toContainText(/cancelled|canceled|not allowed|try again/i);
        await auth.expectLogin();
        await expect(auth.registerButton).toBeEnabled();
        await expect(auth.loginButton).toBeEnabled();
        expect(verifyRequests).toEqual([]);
        expect(errors).toEqual([]);
        expect((await page.request.get('/api/auth/me')).status()).toBe(401);
        if (operation === 'Register') await auth.register(username);
        else await auth.login(username);
      });
  }
});
