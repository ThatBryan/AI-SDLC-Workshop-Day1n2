import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { POST as registerOptions } from '../app/api/auth/register-options/route';
import { POST as registerVerify } from '../app/api/auth/register-verify/route';
import { POST as loginOptions } from '../app/api/auth/login-options/route';
import { POST as loginVerify } from '../app/api/auth/login-verify/route';
import { POST as logout } from '../app/api/auth/logout/route';
import { GET as me } from '../app/api/auth/me/route';
import { POST as passkeyOptions } from '../app/api/auth/passkeys/options/route';
import { POST as passkeyVerify } from '../app/api/auth/passkeys/verify/route';
import { getDB } from '../lib/db';
import { createSession, deleteSession, getSession } from '../lib/auth';
import { signSessionToken, verifySessionToken } from '../lib/session-token';
import { proxy } from '../proxy';

// Configure the test runtime before any production module is evaluated.
await vi.hoisted(async () => {
  const { randomBytes } = await import('node:crypto');
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('DATABASE_PATH', ':memory:');
  vi.stubEnv('SESSION_SECRET', randomBytes(48).toString('base64url'));
  vi.stubEnv('RP_ID', 'localhost');
  vi.stubEnv('RP_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('RP_NAME', 'Todo');
});

// Only request cookies and the two cryptographic verifiers are mocked.
// SQLite, session signing/revocation, routes, and option generators stay real.
const browser = vi.hoisted(() => {
  type Cookie = {
    name: string;
    value: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: boolean | 'lax' | 'strict' | 'none';
    path?: string;
    maxAge?: number;
    expires?: Date;
  };
  const jar = new Map<string, Cookie>();
  return {
    jar,
    cookies: {
      get: (name: string) => jar.get(name),
      set: (nameOrCookie: string | Cookie, value?: string, options?: Omit<Cookie, 'name' | 'value'>) => {
        const cookie = typeof nameOrCookie === 'string'
          ? { ...options, name: nameOrCookie, value: value ?? '' }
          : nameOrCookie;
        if (cookie.maxAge === 0 || (cookie.expires && cookie.expires.getTime() <= Date.now())) {
          jar.delete(cookie.name);
        } else {
          jar.set(cookie.name, cookie);
        }
      },
      delete: (name: string | { name: string }) => jar.delete(typeof name === 'string' ? name : name.name),
    },
  };
});

vi.mock('next/headers', () => ({ cookies: async () => browser.cookies }));
vi.mock('@simplewebauthn/server', async (importOriginal) => ({
  ...await importOriginal<typeof import('@simplewebauthn/server')>(),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

const ORIGIN = 'http://localhost:3000';
const SESSION = 'session';
const CHALLENGE = 'auth_challenge';
const MINUTE = 60_000;
const registrationVerifier = vi.mocked(verifyRegistrationResponse);
const authenticationVerifier = vi.mocked(verifyAuthenticationResponse);
type PostHandler = (request: NextRequest) => Promise<Response>;
type Options = {
  challenge: string;
  rp?: { id: string; name: string };
  rpId?: string;
  user?: { id: string; name: string };
  allowCredentials?: { id: string; type: string }[];
  excludeCredentials?: { id: string; type: string }[];
};

function request(path: string, body: unknown = {}, origin: string | null = ORIGIN) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (origin !== null) headers.set('Origin', origin);
  return new NextRequest(`${ORIGIN}/api/auth/${path}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
}

function post(handler: PostHandler, path: string, body: unknown = {}) {
  return handler(request(path, body));
}

async function readOptions(response: Response): Promise<Options> {
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/json');
  const options = await response.json();
  expect(options.challenge).toEqual(expect.stringMatching(/^[A-Za-z0-9_-]+$/));
  return options;
}

async function expectError(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(await response.json()).toMatchObject({ error: expect.any(String) });
}

function cookie(name: string) {
  const value = browser.jar.get(name)?.value;
  expect(value, `${name} must be set`).toBeTruthy();
  return value!;
}

function restoreCookie(name: string, value: string) {
  browser.cookies.set(name, value);
}

function credentialId() {
  return randomBytes(24).toString('base64url');
}

function clientData(challenge: string, type: 'webauthn.create' | 'webauthn.get') {
  return Buffer.from(JSON.stringify({ type, challenge, origin: ORIGIN, crossOrigin: false }))
    .toString('base64url');
}

function registration(id: string, challenge: string): RegistrationResponseJSON {
  return {
    id, rawId: id, type: 'public-key',
    response: {
      clientDataJSON: clientData(challenge, 'webauthn.create'),
      attestationObject: Buffer.from('mocked-attestation').toString('base64url'),
      transports: ['internal'],
    },
    clientExtensionResults: {},
    authenticatorAttachment: 'platform',
  };
}

// userHandle:null is valid browser JSON, even though the library's TS type
// currently declares only an optional string.
function assertion(id: string, challenge: string, userHandle: string | null = null) {
  return {
    id, rawId: id, type: 'public-key',
    response: {
      clientDataJSON: clientData(challenge, 'webauthn.get'),
      authenticatorData: Buffer.from('mocked-authenticator-data').toString('base64url'),
      signature: Buffer.from('mocked-signature').toString('base64url'),
      userHandle,
    },
    clientExtensionResults: {},
    authenticatorAttachment: 'platform',
  };
}

function successfulAuthentication(id: string) {
  return {
    verified: true,
    authenticationInfo: {
      credentialID: id, newCounter: 0, userVerified: true,
      credentialDeviceType: 'singleDevice' as const, credentialBackedUp: false,
      origin: ORIGIN, rpID: 'localhost',
    },
  };
}

async function register(username = 'alice') {
  const id = credentialId();
  const options = await readOptions(await post(registerOptions, 'register-options', { username }));
  const response = await post(registerVerify, 'register-verify', {
    username, response: registration(id, options.challenge),
  });
  expect(response.ok).toBe(true);
  expect(await getSession()).toMatchObject({ username, userId: expect.any(Number) });
  return { username, id, token: cookie(SESSION) };
}

async function beginLogin(username: string) {
  return readOptions(await post(loginOptions, 'login-options', { username }));
}

async function freshAuthentication(id: string) {
  const token = cookie(SESSION);
  const options = await readOptions(await post(loginOptions, 'login-options', { intent: 'add-passkey' }));
  expect(options.allowCredentials).toEqual(expect.arrayContaining([
    expect.objectContaining({ id, type: 'public-key' }),
  ]));
  const result = await post(loginVerify, 'login-verify', {
    intent: 'add-passkey', response: assertion(id, options.challenge),
  });
  expect(result.ok).toBe(true);
  expect(cookie(SESSION)).toBe(token);
  return options;
}

function advanceTime(milliseconds: number) {
  const now = Date.now();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now + milliseconds);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  browser.jar.clear();
  vi.resetAllMocks();
  // Discover tables only for teardown; tests do not prescribe challenge storage.
  const db = getDB();
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  ).all() as { name: string }[];
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.transaction(() => {
      for (const { name } of tables) db.exec(`DELETE FROM "${name.replaceAll('"', '""')}"`);
    })();
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  registrationVerifier.mockImplementation(async ({ response }) => ({
    verified: true,
    registrationInfo: {
      fmt: 'none', aaguid: '00000000-0000-0000-0000-000000000000',
      credential: {
        id: response.id, publicKey: new Uint8Array([1, 2, 3]), counter: 0,
        transports: ['internal'],
      },
      credentialType: 'public-key', attestationObject: new Uint8Array([1]),
      userVerified: true, credentialDeviceType: 'singleDevice', credentialBackedUp: false,
      origin: ORIGIN, rpID: 'localhost',
    },
  }));
  authenticationVerifier.mockImplementation(async ({ response }) => successfulAuthentication(response.id));
});

afterEach(() => {
  vi.useRealTimers();
  browser.jar.clear();
});
afterAll(() => vi.unstubAllEnvs());

describe('registration and login routes', () => {
  it('returns real registration options directly and a private browser-binding cookie', async () => {
    const options = await readOptions(await post(registerOptions, 'register-options', { username: 'alice' }));
    expect(options.rp).toEqual({ id: 'localhost', name: 'Todo' });
    expect(options.user).toMatchObject({ name: 'alice', id: expect.any(String) });
    expect(browser.jar.get(CHALLENGE)).toMatchObject({ httpOnly: true });
    expect(cookie(CHALLENGE)).not.toBe(options.challenge);
    expect(await getSession()).toBeNull();
  });

  it('persists a v13 credential, creates a session, and allows login after logout', async () => {
    const user = await register();
    expect(browser.jar.get(SESSION)).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
    expect((await me()).status).toBe(200);
    expect((await post(logout, 'logout')).ok).toBe(true);
    expect(await getSession()).toBeNull();
    const options = await beginLogin(user.username);
    expect(options.rpId).toBe('localhost');
    expect(options.allowCredentials).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: user.id, type: 'public-key' }),
    ]));
    const response = await post(loginVerify, 'login-verify', {
      username: user.username, response: assertion(user.id, options.challenge),
    });
    expect(response.ok).toBe(true);
    expect(await getSession()).toMatchObject({ username: user.username });
    // Boundary contract, not crypto testing: the verifier must receive RP/challenge binding.
    expect(authenticationVerifier).toHaveBeenLastCalledWith(expect.objectContaining({
      expectedChallenge: options.challenge, expectedOrigin: ORIGIN, expectedRPID: 'localhost',
      credential: expect.objectContaining({ id: user.id, publicKey: expect.any(Uint8Array) }),
    }));
  });

  it('binds registration verification to the generated challenge and RP', async () => {
    const options = await readOptions(await post(registerOptions, 'register-options', { username: 'alice' }));
    expect((await post(registerVerify, 'register-verify', {
      username: 'alice', response: registration(credentialId(), options.challenge),
    })).ok).toBe(true);
    expect(registrationVerifier).toHaveBeenLastCalledWith(expect.objectContaining({
      expectedChallenge: options.challenge, expectedOrigin: ORIGIN, expectedRPID: 'localhost',
    }));
  });

  it('rejects duplicate usernames with 409 and unknown login usernames with 400', async () => {
    await register();
    await expectError(await post(registerOptions, 'register-options', { username: 'alice' }), 409);
    await expectError(await post(loginOptions, 'login-options', { username: 'nobody' }), 400);
  });

  it('rejects a duplicate username that became taken after options were issued', async () => {
    const pending = await readOptions(await post(registerOptions, 'register-options', { username: 'alice' }));
    const oldBinding = cookie(CHALLENGE);
    // A separate browser wins the registration race.
    browser.jar.clear();
    await register();
    browser.jar.clear();
    restoreCookie(CHALLENGE, oldBinding);
    await expectError(await post(registerVerify, 'register-verify', {
      username: 'alice', response: registration(credentialId(), pending.challenge),
    }), 409);
    expect(await getSession()).toBeNull();
  });

  it('rejects an assertion for another user even when the verifier would accept it', async () => {
    const alice = await register();
    const bob = await register('bob');
    await deleteSession();
    const options = await beginLogin(alice.username);
    await expectError(await post(loginVerify, 'login-verify', {
      username: alice.username, response: assertion(bob.id, options.challenge),
    }), 401);
    expect(await getSession()).toBeNull();
  });

  it('rejects unknown credentials instead of creating a session', async () => {
    await register();
    await deleteSession();
    const options = await beginLogin('alice');
    await expectError(await post(loginVerify, 'login-verify', {
      username: 'alice', response: assertion(credentialId(), options.challenge),
    }), 401);
    expect(await getSession()).toBeNull();
  });

  it.each(['registration', 'login'] as const)('%s verification cannot change the challenge owner', async (flow) => {
    const id = flow === 'login' ? (await register()).id : credentialId();
    if (flow === 'login') await register('bob');
    await deleteSession();
    const handler = flow === 'login' ? loginOptions : registerOptions;
    const path = flow === 'login' ? 'login-options' : 'register-options';
    const options = await readOptions(await post(handler, path, { username: 'alice' }));
    await expectError(await post(flow === 'login' ? loginVerify : registerVerify,
      flow === 'login' ? 'login-verify' : 'register-verify', {
        username: 'bob',
        response: flow === 'login' ? assertion(id, options.challenge) : registration(id, options.challenge),
      }), 401);
    expect(await getSession()).toBeNull();
  });
});

const posts: [string, PostHandler, unknown][] = [
  ['register-options', registerOptions, { username: 'alice' }],
  ['register-verify', registerVerify, { username: 'alice', response: registration('YWJj', 'Y2hhbGxlbmdl') }],
  ['login-options', loginOptions, { username: 'alice' }],
  ['login-verify', loginVerify, { username: 'alice', response: assertion('YWJj', 'Y2hhbGxlbmdl') }],
  ['logout', logout, {}],
  ['passkeys/options', passkeyOptions, {}],
  ['passkeys/verify', passkeyVerify, { response: registration('YWJj', 'Y2hhbGxlbmdl') }],
];

describe('request validation', () => {
  it.each(posts)('%s rejects missing and foreign Origin', async (path, handler, body) => {
    const user = await register();
    for (const origin of [null, 'https://attacker.example', 'http://localhost:3000.attacker.example']) {
      await expectError(await handler(request(path, body, origin)), 403);
    }
    expect(cookie(SESSION)).toBe(user.token);
    expect(await getSession()).toMatchObject({ username: user.username });
  });

  it.each(posts)('%s rejects malformed JSON and non-JSON content', async (path, handler) => {
    const user = await register();
    await freshAuthentication(user.id);
    for (const [contentType, body] of [['application/json', '{'], ['text/plain', '{}']]) {
      const response = await handler(new NextRequest(`${ORIGIN}/api/auth/${path}`, {
        method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': contentType }, body,
      }));
      await expectError(response, 400);
    }
  });

  it.each([null, {}, { username: '' }, { username: '   ' }, { username: 42 }, { username: [] }])(
    'rejects invalid username bodies: %j', async (body) => {
      await expectError(await post(registerOptions, 'register-options', body), 400);
      await expectError(await post(loginOptions, 'login-options', body), 400);
    },
  );

  it.each(['register', 'login'] as const)('%s rejects missing and malformed credential responses', async (flow) => {
    if (flow === 'login') {
      await register();
      await deleteSession();
    }
    for (const response of [undefined, null, {}, { id: 42 }, { id: 'YWJj', response: {} }]) {
      await readOptions(await post(flow === 'login' ? loginOptions : registerOptions,
        `${flow}-options`, { username: 'alice' }));
      await expectError(await post(flow === 'login' ? loginVerify : registerVerify,
        `${flow}-verify`, { username: 'alice', response }), 400);
      expect(await getSession()).toBeNull();
    }
  });

  it('rejects malformed extra-passkey verification without losing the current session', async () => {
    const user = await register();
    await freshAuthentication(user.id);
    await readOptions(await post(passkeyOptions, 'passkeys/options'));
    await expectError(await post(passkeyVerify, 'passkeys/verify', { response: null }), 400);
    expect(await getSession()).toMatchObject({ username: user.username });
  });

  it('me returns 401 without a session', async () => {
    await expectError(await me(), 401);
  });

  it('redirects protected requests and accepts an active signed session', async () => {
    for (const path of ['/', '/calendar']) {
      const denied = await proxy(new NextRequest(`${ORIGIN}${path}`));
      expect(denied.headers.get('location')).toBe(`${ORIGIN}/login`);
    }
    const user = await register();
    const allowed = await proxy(new NextRequest(ORIGIN, { headers: { cookie: `session=${user.token}` } }));
    expect(allowed.headers.get('x-middleware-next')).toBe('1');
    await deleteSession();
    const revoked = await proxy(new NextRequest(ORIGIN, { headers: { cookie: `session=${user.token}` } }));
    expect(revoked.headers.get('location')).toBe(`${ORIGIN}/login`);
  });
});

describe.each(['register', 'login'] as const)('%s challenge lifecycle', (flow) => {
  async function begin() {
    const id = flow === 'login' ? (await register()).id : credentialId();
    if (flow === 'login') await deleteSession();
    const options = await readOptions(await post(flow === 'login' ? loginOptions : registerOptions,
      `${flow}-options`, { username: 'alice' }));
    const binding = cookie(CHALLENGE);
    const body = {
      username: 'alice',
      response: flow === 'login' ? assertion(id, options.challenge) : registration(id, options.challenge),
    };
    return {
      binding,
      verify: () => post(flow === 'login' ? loginVerify : registerVerify, `${flow}-verify`, body),
    };
  }

  it('rejects missing or forged browser binding despite valid-shaped credentials', async () => {
    const attempt = await begin();
    browser.jar.delete(CHALLENGE);
    await expectError(await attempt.verify(), 401);
    restoreCookie(CHALLENGE, randomBytes(32).toString('base64url'));
    await expectError(await attempt.verify(), 401);
    expect(await getSession()).toBeNull();
  });

  it('consumes successful challenges once, even if the old cookie is restored', async () => {
    const attempt = await begin();
    expect((await attempt.verify()).ok).toBe(true);
    await deleteSession();
    restoreCookie(CHALLENGE, attempt.binding);
    await expectError(await attempt.verify(), 401);
    expect(await getSession()).toBeNull();
  });

  it.each(['false', 'throw'] as const)('consumes failed verification (%s), preventing retry', async (failure) => {
    const attempt = await begin();
    if (flow === 'register') {
      if (failure === 'throw') registrationVerifier.mockRejectedValueOnce(new Error('Invalid attestation'));
      else registrationVerifier.mockResolvedValueOnce({ verified: false });
    } else {
      if (failure === 'throw') authenticationVerifier.mockRejectedValueOnce(new Error('Invalid assertion'));
      else authenticationVerifier.mockResolvedValueOnce({
        ...successfulAuthentication('YWJj'), verified: false,
      });
    }
    await expectError(await attempt.verify(), 401);
    expect(await getSession()).toBeNull();
    restoreCookie(CHALLENGE, attempt.binding);
    // The default verifier now succeeds; challenge reuse must still fail.
    await expectError(await attempt.verify(), 401);
    expect(await getSession()).toBeNull();
    if (flow === 'register') {
      // A rejected attestation must not leave a partially created account.
      await expectError(await post(loginOptions, 'login-options', { username: 'alice' }), 400);
    }
  });

  it('invalidates the previous challenge when options replace it', async () => {
    const attempt = await begin();
    await readOptions(await post(flow === 'login' ? loginOptions : registerOptions,
      `${flow}-options`, { username: 'alice' }));
    expect(cookie(CHALLENGE)).not.toBe(attempt.binding);
    restoreCookie(CHALLENGE, attempt.binding);
    await expectError(await attempt.verify(), 401);
    expect(await getSession()).toBeNull();
  });

  it('allows verification just before five minutes', async () => {
    const attempt = await begin();
    advanceTime(5 * MINUTE - 1);
    expect((await attempt.verify()).ok).toBe(true);
  });

  it('rejects verification at the five-minute expiry, retaining the browser cookie', async () => {
    const attempt = await begin();
    advanceTime(5 * MINUTE);
    await expectError(await attempt.verify(), 401);
    expect(await getSession()).toBeNull();
  });

  it('allows only one winner for simultaneous verification requests', async () => {
    const attempt = await begin();
    const responses = await Promise.all([attempt.verify(), attempt.verify()]);
    expect(responses.filter((response) => response.ok)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 401)).toHaveLength(1);
  });
});

describe('real session helpers and signed tokens', () => {
  it('createSession/getSession/deleteSession round-trip and deletion revoke the original token', async () => {
    await register();
    const session = await getSession();
    expect(session).not.toBeNull();
    const user = getDB().prepare('SELECT * FROM users WHERE id = ?').get(session!.userId) as Parameters<typeof createSession>[0];
    await deleteSession();
    await createSession(user);
    const token = cookie(SESSION);
    expect(await getSession()).toMatchObject({
      userId: user.id, username: user.username, sessionId: expect.any(String),
    });
    await deleteSession();
    expect(browser.jar.get(SESSION)?.value).toBeFalsy();
    restoreCookie(SESSION, token);
    expect(await getSession()).toBeNull();
    await expectError(await me(), 401);
  });

  it('logout revokes the database session, not just the browser cookie', async () => {
    const user = await register();
    expect((await post(logout, 'logout')).ok).toBe(true);
    expect(browser.jar.get(SESSION)?.value).toBeFalsy();
    restoreCookie(SESSION, user.token);
    expect(await getSession()).toBeNull();
    await expectError(await me(), 401);
  });

  it('accepts bodyless same-origin logout and revokes the session', async () => {
    const user = await register();
    const response = await logout(new NextRequest(`${ORIGIN}/api/auth/logout`, {
      method: 'POST', headers: { Origin: ORIGIN },
    }));
    expect(response.status).toBe(200);
    restoreCookie(SESSION, user.token);
    expect(await getSession()).toBeNull();
  });

  it.each(['', 'not-a-jwt', 'a.b.c'])('rejects invalid session token %j', async (token) => {
    expect(await verifySessionToken(token)).toBeNull();
    restoreCookie(SESSION, token);
    expect(await getSession()).toBeNull();
    await expectError(await me(), 401);
  });

  it('round-trips token payloads and rejects tampered signatures', async () => {
    const payload = { userId: 7, username: '用户-🙂', sessionId: randomBytes(24).toString('base64url') };
    const token = await signSessionToken(payload, Date.now() + MINUTE);
    expect(await verifySessionToken(token)).toEqual(payload);
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    const tampered = parts.join('.');
    expect(await verifySessionToken(tampered)).toBeNull();
    restoreCookie(SESSION, tampered);
    expect(await getSession()).toBeNull();
  });

  it('rejects expired signed tokens even when their database session is active', async () => {
    await register();
    const session = await getSession();
    const token = await signSessionToken(session!, Date.now() - MINUTE);
    expect(await verifySessionToken(token)).toBeNull();
    restoreCookie(SESSION, token);
    expect(await getSession()).toBeNull();
    await expectError(await me(), 401);
  });

  it('does not accept a valid signature for a nonexistent/revoked database session', async () => {
    await register();
    const session = await getSession();
    const payload = { ...session!, sessionId: randomBytes(24).toString('base64url') };
    const token = await signSessionToken(payload, Date.now() + MINUTE);
    expect(await verifySessionToken(token)).toEqual(payload);
    restoreCookie(SESSION, token);
    expect(await getSession()).toBeNull();
  });
});

describe('fresh, session-bound extra passkey enrollment', () => {
  it('denies every enrollment step without a session', async () => {
    await expectError(await post(loginOptions, 'login-options', { intent: 'add-passkey' }), 401);
    await expectError(await post(loginVerify, 'login-verify', {
      intent: 'add-passkey', response: assertion(credentialId(), 'Y2hhbGxlbmdl'),
    }), 401);
    await expectError(await post(passkeyOptions, 'passkeys/options'), 401);
    await expectError(await post(passkeyVerify, 'passkeys/verify', {
      response: registration(credentialId(), 'Y2hhbGxlbmdl'),
    }), 401);
  });

  it('requires fresh authentication even immediately after initial registration', async () => {
    await register();
    await expectError(await post(passkeyOptions, 'passkeys/options'), 401);
  });

  it('ordinary login creates a session but does not grant extra-passkey enrollment', async () => {
    const user = await register();
    await deleteSession();
    const options = await beginLogin(user.username);
    expect((await post(loginVerify, 'login-verify', {
      username: user.username, response: assertion(user.id, options.challenge),
    })).ok).toBe(true);
    await expectError(await post(passkeyOptions, 'passkeys/options'), 401);
  });

  it('adds a second usable passkey without rotating the session, then requires new freshness', async () => {
    const user = await register();
    const before = await getSession();
    await freshAuthentication(user.id);
    expect(await getSession()).toEqual(before);
    const options = await readOptions(await post(passkeyOptions, 'passkeys/options'));
    expect(options.user).toMatchObject({ name: user.username });
    expect(options.excludeCredentials).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: user.id }),
    ]));
    const binding = cookie(CHALLENGE);
    const extraId = credentialId();
    const body = { response: registration(extraId, options.challenge) };
    expect((await post(passkeyVerify, 'passkeys/verify', body)).ok).toBe(true);
    expect(cookie(SESSION)).toBe(user.token);
    expect(await getSession()).toEqual(before);
    restoreCookie(CHALLENGE, binding);
    await expectError(await post(passkeyVerify, 'passkeys/verify', body), 401);
    await expectError(await post(passkeyOptions, 'passkeys/options'), 401);
    await deleteSession();
    const login = await beginLogin(user.username);
    expect(login.allowCredentials).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: user.id }), expect.objectContaining({ id: extraId }),
    ]));
    expect((await post(loginVerify, 'login-verify', {
      username: user.username, response: assertion(extraId, login.challenge),
    })).ok).toBe(true);
    expect(await getSession()).toMatchObject({ username: user.username });
  });

  it('uses the active session identity, not a supplied username, for fresh options', async () => {
    const alice = await register();
    browser.jar.clear();
    await register('bob');
    restoreCookie(SESSION, alice.token);
    const options = await readOptions(await post(loginOptions, 'login-options', {
      intent: 'add-passkey', username: 'bob',
    }));
    expect(options.allowCredentials?.map(({ id }) => id)).toEqual([alice.id]);
  });

  it('rejects fresh authentication with another user’s credential', async () => {
    const alice = await register();
    browser.jar.clear();
    const bob = await register('bob');
    restoreCookie(SESSION, alice.token);
    const options = await readOptions(await post(loginOptions, 'login-options', { intent: 'add-passkey' }));
    await expectError(await post(loginVerify, 'login-verify', {
      intent: 'add-passkey', response: assertion(bob.id, options.challenge),
    }), 401);
    await expectError(await post(passkeyOptions, 'passkeys/options'), 401);
    expect(cookie(SESSION)).toBe(alice.token);
  });

  it('does not turn a normal login challenge into enrollment freshness', async () => {
    const user = await register();
    const options = await beginLogin(user.username);
    await expectError(await post(loginVerify, 'login-verify', {
      intent: 'add-passkey', response: assertion(user.id, options.challenge),
    }), 401);
    await expectError(await post(passkeyOptions, 'passkeys/options'), 401);
  });

  it('consumes a freshness grant atomically under simultaneous options requests', async () => {
    const user = await register();
    await freshAuthentication(user.id);
    const results = await Promise.all([
      post(passkeyOptions, 'passkeys/options'), post(passkeyOptions, 'passkeys/options'),
    ]);
    expect(results.filter((response) => response.ok)).toHaveLength(1);
    expect(results.filter((response) => response.status === 401)).toHaveLength(1);
  });

  it('cannot replay fresh authentication to mint a second grant', async () => {
    const user = await register();
    const options = await readOptions(await post(loginOptions, 'login-options', { intent: 'add-passkey' }));
    const binding = cookie(CHALLENGE);
    const body = { intent: 'add-passkey', response: assertion(user.id, options.challenge) };
    expect((await post(loginVerify, 'login-verify', body)).ok).toBe(true);
    await readOptions(await post(passkeyOptions, 'passkeys/options'));
    restoreCookie(CHALLENGE, binding);
    await expectError(await post(loginVerify, 'login-verify', body), 401);
    await expectError(await post(passkeyOptions, 'passkeys/options'), 401);
  });

  it.each(['false', 'throw'] as const)('failed fresh authentication (%s) consumes its challenge without rotating the session', async (failure) => {
    const user = await register();
    const options = await readOptions(await post(loginOptions, 'login-options', { intent: 'add-passkey' }));
    const binding = cookie(CHALLENGE);
    const body = { intent: 'add-passkey', response: assertion(user.id, options.challenge) };
    if (failure === 'throw') authenticationVerifier.mockRejectedValueOnce(new Error('Invalid assertion'));
    else authenticationVerifier.mockResolvedValueOnce({
      ...successfulAuthentication(user.id), verified: false,
    });
    await expectError(await post(loginVerify, 'login-verify', body), 401);
    restoreCookie(CHALLENGE, binding);
    await expectError(await post(loginVerify, 'login-verify', body), 401);
    await expectError(await post(passkeyOptions, 'passkeys/options'), 401);
    expect(cookie(SESSION)).toBe(user.token);
    expect(await getSession()).toMatchObject({ username: user.username });
  });

  it('requires the private enrollment challenge cookie, not just the public challenge and session', async () => {
    const user = await register();
    await freshAuthentication(user.id);
    const options = await readOptions(await post(passkeyOptions, 'passkeys/options'));
    browser.jar.delete(CHALLENGE);
    await expectError(await post(passkeyVerify, 'passkeys/verify', {
      response: registration(credentialId(), options.challenge),
    }), 401);
    expect(cookie(SESSION)).toBe(user.token);
  });

  it('failed extra registration consumes both the challenge and freshness', async () => {
    const user = await register();
    await freshAuthentication(user.id);
    const options = await readOptions(await post(passkeyOptions, 'passkeys/options'));
    const binding = cookie(CHALLENGE);
    const body = { response: registration(credentialId(), options.challenge) };
    registrationVerifier.mockResolvedValueOnce({ verified: false });
    await expectError(await post(passkeyVerify, 'passkeys/verify', body), 401);
    restoreCookie(CHALLENGE, binding);
    await expectError(await post(passkeyVerify, 'passkeys/verify', body), 401);
    await expectError(await post(passkeyOptions, 'passkeys/options'), 401);
    expect(cookie(SESSION)).toBe(user.token);
    // Only a genuinely new authentication can authorize another attempt.
    await freshAuthentication(user.id);
    await readOptions(await post(passkeyOptions, 'passkeys/options'));
  });

  it('expires fresh-authentication challenges after two minutes', async () => {
    const user = await register();
    const options = await readOptions(await post(loginOptions, 'login-options', { intent: 'add-passkey' }));
    advanceTime(2 * MINUTE);
    await expectError(await post(loginVerify, 'login-verify', {
      intent: 'add-passkey', response: assertion(user.id, options.challenge),
    }), 401);
    await expectError(await post(passkeyOptions, 'passkeys/options'), 401);
  });

  it('expires unused freshness after two minutes', async () => {
    const user = await register();
    await freshAuthentication(user.id);
    advanceTime(2 * MINUTE);
    await expectError(await post(passkeyOptions, 'passkeys/options'), 401);
  });

  it.each([2 * MINUTE - 1, 2 * MINUTE])('enrollment challenge enforces its two-minute boundary (%i ms)', async (elapsed) => {
    const user = await register();
    await freshAuthentication(user.id);
    const options = await readOptions(await post(passkeyOptions, 'passkeys/options'));
    advanceTime(elapsed);
    const result = await post(passkeyVerify, 'passkeys/verify', {
      response: registration(credentialId(), options.challenge),
    });
    if (elapsed < 2 * MINUTE) expect(result.ok).toBe(true);
    else await expectError(result, 401);
  });

  it.each(['fresh-challenge', 'grant', 'enrollment-challenge'] as const)(
    'binds %s to the exact session, not merely the user', async (phase) => {
      const user = await register();
      let options: Options | undefined;
      if (phase === 'fresh-challenge') {
        options = await readOptions(await post(loginOptions, 'login-options', { intent: 'add-passkey' }));
      } else {
        await freshAuthentication(user.id);
        if (phase === 'enrollment-challenge') {
          options = await readOptions(await post(passkeyOptions, 'passkeys/options'));
        }
      }
      const session = await getSession();
      const dbUser = getDB().prepare('SELECT * FROM users WHERE id = ?').get(session!.userId) as Parameters<typeof createSession>[0];
      await createSession(dbUser);
      expect((await getSession())?.sessionId).not.toBe(session!.sessionId);
      if (phase === 'fresh-challenge') {
        await expectError(await post(loginVerify, 'login-verify', {
          intent: 'add-passkey', response: assertion(user.id, options!.challenge),
        }), 401);
      } else if (phase === 'enrollment-challenge') {
        await expectError(await post(passkeyVerify, 'passkeys/verify', {
          response: registration(credentialId(), options!.challenge),
        }), 401);
      }
      await expectError(await post(passkeyOptions, 'passkeys/options'), 401);
    },
  );

  it('rejects enrollment after session revocation even with saved session and challenge cookies', async () => {
    const user = await register();
    await freshAuthentication(user.id);
    const options = await readOptions(await post(passkeyOptions, 'passkeys/options'));
    const binding = cookie(CHALLENGE);
    await deleteSession();
    restoreCookie(SESSION, user.token);
    restoreCookie(CHALLENGE, binding);
    await expectError(await post(passkeyVerify, 'passkeys/verify', {
      response: registration(credentialId(), options.challenge),
    }), 401);
  });

  it('cannot commit enrollment if logout occurs during verification', async () => {
    const user = await register();
    await freshAuthentication(user.id);
    const options = await readOptions(await post(passkeyOptions, 'passkeys/options'));
    const verify = registrationVerifier.getMockImplementation()!;
    registrationVerifier.mockImplementationOnce(async (input) => {
      await deleteSession();
      return verify(input);
    });
    await expectError(await post(passkeyVerify, 'passkeys/verify', {
      response: registration(credentialId(), options.challenge),
    }), 401);
    const login = await beginLogin(user.username);
    expect(login.allowCredentials).toHaveLength(1);
  });

  it('cannot commit enrollment if its deadline passes during verification', async () => {
    const user = await register();
    await freshAuthentication(user.id);
    const options = await readOptions(await post(passkeyOptions, 'passkeys/options'));
    const verify = registrationVerifier.getMockImplementation()!;
    registrationVerifier.mockImplementationOnce(async (input) => {
      advanceTime(2 * MINUTE);
      return verify(input);
    });
    await expectError(await post(passkeyVerify, 'passkeys/verify', {
      response: registration(credentialId(), options.challenge),
    }), 401);
    const login = await beginLogin(user.username);
    expect(login.allowCredentials).toHaveLength(1);
  });
});
