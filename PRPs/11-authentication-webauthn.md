# WebAuthn/Passkeys Authentication

Passwordless registration and login using WebAuthn/passkeys (biometrics, security keys, or platform authenticators), with revocable JWT-backed sessions and Next.js route protection.

## Implementation Notes — PRP11 Scaffold

**Last updated: 2026-11-13.** Auth is implemented; `/` and `/calendar` remain protected placeholders. Other PRPs and task-feature guides describe target functionality, not shipped todo/calendar features. Acceptance criteria and success metrics below remain verification targets, not recorded passes.

- **Source of truth:** `lib/webauthn.ts`, `lib/auth.ts`, `lib/session-token.ts`, `lib/db.ts`, `lib/auth-http.ts`, `lib/config.ts`, `lib/auth-client.ts`, `app/api/auth/`, `app/login/page.tsx`, `components/authenticated-shell.tsx`, and root `proxy.ts`.
- **Manifest:** Node.js >=22.13.0; Next.js 16.4.6; `@simplewebauthn/browser` 13.3.0 and `@simplewebauthn/server` 13.3.3. Browser v13 calls are `startRegistration({ optionsJSON: options })` and `startAuthentication({ optionsJSON: options })`, not the old positional examples. Server v13 uses `verifyAuthenticationResponse({ ..., credential: { id, publicKey, counter } })`, **not** the old `authenticator: { credentialID, credentialPublicKey, counter }` argument. Registration data comes from `registrationInfo.credential`.
- **Next.js 16:** root `proxy.ts` replaces `middleware.ts`; it checks JWT validity **and SQLite session activity**, matching `/` and `/calendar/:path*`. Protected APIs must independently call `getSession()`.
- **Request validation:** all auth POSTs require an `Origin` exactly equal to configured `RP_ORIGIN`, `Content-Type: application/json`, and valid JSON/schema data (maximum body 65,536 bytes). Logout also accepts a bodyless POST with no Content-Type, but still requires the matching Origin. Auth JSON responses use `Cache-Control: no-store`.
- **Challenges:** SQLite `auth_challenges` rows hold purpose, user identity, expiry, and (for reauthentication/enrollment) session binding. A random HTTP-only, SameSite=Strict `auth_challenge` cookie binds the browser; normal registration/login challenges last **five minutes**, and reauthentication lasts **two minutes**. Verification atomically consumes a valid challenge before asynchronous cryptographic verification; replay, wrong purpose, or wrong session is rejected. Starting a new ceremony replaces that browser's previous challenge.
- **Additional passkeys:** a live session is required. `login-options` and `login-verify` accept `intent: 'add-passkey'` to verify an existing credential for the **session user**, not a supplied username. Success creates a two-minute, one-use enrollment grant in `sessions.reauth_until`, returning `enrollmentExpiresAt` and `serverTime`; it does not create a new login session. The UI validates this response and uses a monotonic timer independent of client clock skew. A separate **Save new passkey** click requests `passkeys/options`, consuming the grant. The enrollment challenge keeps that grant's original deadline and is browser/user/session-bound. `passkeys/verify` atomically checks the session/deadline and saves the credential. A cancelled/failed/expired enrollment requires fresh verification.
- **Sessions:** HTTP-only, SameSite=Lax cookies (Secure in production), seven-day fixed expiry, and a random `sessionId` backed by SQLite `sessions`. Creating a session revokes the prior active session in that browser. Logout revokes the current session and its bound challenges and clears cookies; copied revoked tokens cannot restore it. Other sessions are not globally revoked.
- **Deployment:** follow [README setup](../README.md). `.env.example` uses `RP_ID=localhost`, `RP_ORIGIN=http://localhost:3000`, `RP_NAME=Todo App`, `DATABASE_PATH=todos.db`, and an empty `SESSION_SECRET` to fill with privately generated random material. Production requires an exact HTTPS origin (e.g. `RP_ID=todo.example.com`, `RP_ORIGIN=https://todo.example.com`, no path/trailing slash), a matching RP domain, and persistent writable SQLite storage on a single host, **not ephemeral serverless storage**.
- **Deferred security:** rate limiting remains out of scope per this PRP. **Production must add trusted-edge throttling before public deployment.** There is no account recovery or password fallback.

The illustrative snippets below explain the design; they are not standalone route implementations. In particular, older username-keyed challenge-store examples omit the implemented browser/session binding and must not replace the source handlers.

**Dependencies**: This is foundational infrastructure, not a downstream feature. The `session.userId` produced by `getSession()` here is required by every API route in PRPs 01–10 (`if (!session) return 401`). Per the PRP Index's Implementation Priority, it can be built in parallel with or after the other features — nothing else depends on its UI, but everything else depends on its session primitive existing before those routes can be authorized.

[← PRP Index](./README.md)

## Feature Overview

The app uses WebAuthn (passkeys) as the *only* authentication mechanism — there is no password field anywhere in the schema or UI. Users register with a username and their device's platform authenticator (Touch ID, Face ID, Windows Hello, PIN) or a roaming security key (YubiKey, etc.). Login re-authenticates the same way. A successful registration or login creates a JWT session stored in an HTTP-only cookie with a 7-day expiry and a revocable SQLite session record. `proxy.ts` protects `/` and `/calendar/:path*`, redirecting unauthenticated requests to `/login`.

## User Stories

- **As a new user**, I want to register with just a username and my fingerprint/Face ID, so that I never have to create or remember a password.
- **As a returning user**, I want to log in with the same biometric prompt I used to register, so that access is fast and frictionless.
- **As a security-conscious user**, I want my credentials to never leave my device (no password stored server-side, no shared secret to leak), so that I'm protected even if the server's database is compromised.
- **As a user on a new device**, I want to register an additional passkey (e.g. my phone, after registering on my laptop), so that I'm not locked out of my account if one device is unavailable.
- **As a logged-in user**, I want my session to persist across page reloads and browser restarts for a reasonable period, so that I don't have to re-authenticate constantly.
- **As a user**, I want a visible logout control that immediately ends my session, so that I can secure a shared or public device.

## User Flow

### Registration
1. User navigates to `/login` (or is redirected there from a protected route).
2. User enters a username and clicks **Register**.
3. Client calls `POST /api/auth/register-options` with the username.
4. Server checks the username is not already taken, generates a WebAuthn challenge via `generateRegistrationOptions`, stores it in SQLite with a browser-bound cookie and five-minute expiry, and returns the options.
5. Client calls `startRegistration({ optionsJSON: options })` from `@simplewebauthn/browser`, which prompts the browser's platform authenticator (fingerprint/Face ID/PIN/security key).
6. Browser returns an attestation response; client POSTs it to `POST /api/auth/register-verify`.
7. Server calls `verifyRegistrationResponse`, and on success creates the `users` row and the corresponding `authenticators` row, then calls `createSession(user)`.
8. Server responds 200; client redirects to `/`.

### Login
1. User navigates to `/login`, enters their username, clicks **Login**.
2. Client calls `POST /api/auth/login-options` with the username; server looks up the user's registered authenticator(s), generates an assertion challenge via `generateAuthenticationOptions`, stores it, returns options.
3. Client calls `startAuthentication({ optionsJSON: options })`, prompting the same biometric/security-key flow.
4. Client POSTs the assertion response to `POST /api/auth/login-verify`.
5. Server looks up the authenticator by `credential_id`, calls `verifyAuthenticationResponse`, updates the authenticator's `counter`, calls `createSession(user)`.
6. Server responds 200; client redirects to `/`.

### Session & Logout
1. For requests matching `/` or `/calendar/:path*`, `proxy.ts` checks the session cookie and its active SQLite session record; if missing/invalid/revoked/expired, redirects to `/login`.
2. `/login` itself checks `GET /api/auth/me`; if already authenticated, redirects to `/`.
3. User clicks **Logout** (header) → `POST /api/auth/logout` revokes the current session and clears session/challenge cookies → redirect to `/login`.

### Additional Passkey
1. While signed in, user clicks **Add passkey**.
2. Client calls `POST /api/auth/login-options` with `{ intent: 'add-passkey' }`, authenticates using an existing passkey, then calls `POST /api/auth/login-verify` with `{ intent: 'add-passkey', response }`.
3. After verification, user separately clicks **Save new passkey**; the client sends `{}` to `POST /api/auth/passkeys/options`.
4. Client calls `startRegistration({ optionsJSON: options })`, then sends `{ response }` to `POST /api/auth/passkeys/verify`.
5. Enrollment must finish within two minutes of existing-passkey verification. The one-use grant and challenge cannot be reused; restart from **Add passkey** after a failed attempt.

## Technical Requirements

### Database Schema

This scaffold owns `users`, `authenticators`, `sessions`, and `auth_challenges` in `lib/db.ts`. The user/authenticator schema is:

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  user_handle TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE authenticators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT UNIQUE NOT NULL,
  credential_public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_authenticators_user_id ON authenticators(user_id);
```

A user may have multiple rows in `authenticators` (one per registered device) — this is a one-to-many relationship, not one-to-one.

`sessions` stores `id`, `user_id`, `expires_at`, and nullable `reauth_until`; `auth_challenges` stores `id`, `purpose`, `challenge`, `username`, `user_id`, `user_handle`, `session_id`, and `expires_at`. Expiries are epoch milliseconds; creation timestamps are supplied by the application. See `lib/db.ts` for complete DDL, expiry indexes, atomic consumption, and transactional registration.

### Types

```typescript
export interface User {
  id: number;
  username: string;
  user_handle: string;
  created_at: string;
}

export interface Authenticator {
  id: number;
  user_id: number;
  credential_id: string;
  credential_public_key: Buffer;
  counter: number;
  created_at: string;
}

export interface Session {
  userId: number;
  username: string;
  sessionId: string;
}
```

### `lib/auth.ts`

```typescript
export async function createSession(user: User): Promise<void>;
// Signs a JWT { userId, username, sessionId }, creates its SQLite session row,
// and sets an HTTP-only, SameSite=Lax, Secure-in-production cookie (7 days).

export async function getSession(): Promise<Session | null>;
// Verifies the JWT and active SQLite session/user; returns null if
// absent/invalid/expired/revoked. Call first in every protected API route.

export async function deleteSession(): Promise<void>;
// Revokes the current SQLite session and its bound challenges; clears the cookie.
```

### API Endpoints

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/auth/register-options` | Generate a WebAuthn registration challenge for a username |
| POST | `/api/auth/register-verify` | Verify the registration attestation, create `users`/`authenticators` rows, create session |
| POST | `/api/auth/login-options` | `{ username }` for login, or `{ intent: 'add-passkey' }` for current-session reauthentication |
| POST | `/api/auth/login-verify` | Login: `{ username, response }` creates a session; `{ intent: 'add-passkey', response }` grants enrollment after verification; both update `counter` |
| POST | `/api/auth/passkeys/options` | `{}`; require active session, consume one-use enrollment grant, return registration options |
| POST | `/api/auth/passkeys/verify` | `{ response }`; require active session and consume bound challenge to save another credential |
| POST | `/api/auth/logout` | Revoke current session and clear cookies; accept `{}` or a bodyless request |
| GET | `/api/auth/me` | Return the current session's user, or 401 |

`me` returns `{ userId, username }`, not the internal session ID. Registration options take `{ username }`; registration verification takes `{ username, response }`. See Implementation Notes for Origin/JSON validation on every POST.

### WebAuthn Flow (4 steps, applies to both register and login)

1. Client requests options from the server (`*-options` endpoint) → server generates and persists a random challenge.
2. Client hands the options to `@simplewebauthn/browser`'s `startRegistration()`/`startAuthentication()`, which drives the platform authenticator UI.
3. Client POSTs the browser's response to the `*-verify` endpoint.
4. Server verifies the response against the stored challenge using `@simplewebauthn/server`, persists/updates the authenticator, and establishes a session.

```typescript
// app/api/auth/register-options/route.ts
export async function POST(request: NextRequest) {
  const { username } = await request.json();
  if (userDB.findByUsername(username)) {
    return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
  }
  const options = await generateRegistrationOptions({
    rpName: process.env.RP_NAME!,
    rpID: process.env.RP_ID!,
    userName: username,
    attestationType: 'none',
  });
  await challengeStore.save(username, options.challenge);
  return NextResponse.json(options);
}
```

```typescript
// app/api/auth/login-verify/route.ts
export async function POST(request: NextRequest) {
  const { username, response } = await request.json();
  const authenticator = authenticatorDB.findByCredentialId(response.id);
  if (!authenticator) {
    return NextResponse.json({ error: 'Authenticator not recognized' }, { status: 401 });
  }

  const expectedChallenge = await challengeStore.get(username);
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: process.env.RP_ORIGIN!,
    expectedRPID: process.env.RP_ID!,
    credential: {
      id: authenticator.credential_id,
      publicKey: new Uint8Array(authenticator.credential_public_key),
      // Always coalesce — counter can be undefined on some authenticator records.
      counter: authenticator.counter ?? 0,
    },
  });

  if (!verification.verified) {
    return NextResponse.json({ error: 'Verification failed' }, { status: 401 });
  }

  if (!authenticatorDB.updateCounter(
    authenticator.id, authenticator.counter ?? 0,
    verification.authenticationInfo.newCounter ?? 0,
  )) {
    return NextResponse.json({ error: 'Verification failed' }, { status: 401 });
  }
  const user = userDB.findById(authenticator.user_id);
  await createSession(user);
  return NextResponse.json({ success: true });
}
```

**Critical pitfall — `counter ?? 0`:** Keep the fallback when passing, updating, or storing counters. `authenticatorDB.updateCounter(id, previous, next)` performs a compare-and-update. The implemented verifier in `lib/webauthn.ts` also checks credential ownership and user handles; the abbreviated example above omits those checks and the actual challenge-consumption flow.

**v13 encoding requirement:** `credential.id` and allow/exclude credential IDs are base64url **strings**; `credential.publicKey` is a `Uint8Array` converted from the SQLite BLOB. `isoBase64URL.toBuffer(user.user_handle)` supplies the registration `userID`. Do not convert credential IDs to the old `credentialID` buffer argument.

### Route Protection (`proxy.ts`, Next.js 16)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { sessionFromToken } from '@/lib/auth';

export async function proxy(request: NextRequest) {
  const session = await sessionFromToken(request.cookies.get('session')?.value);
  if (!session) return NextResponse.redirect(new URL('/login', request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/calendar/:path*'],
};
```

Every other feature's API routes follow the same first-line pattern:

```typescript
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  // use session.userId for all DB queries
}
```

## UI Components

### `/login` page

```tsx
'use client';
import { useState } from 'react';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleRegister() {
    setError(null);
    const optionsRes = await fetch('/api/auth/register-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    if (!optionsRes.ok) return setError((await optionsRes.json()).error);
    const options = await optionsRes.json();

    const attestation = await startRegistration({ optionsJSON: options });

    const verifyRes = await fetch('/api/auth/register-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, response: attestation }),
    });
    if (!verifyRes.ok) return setError((await verifyRes.json()).error);
    router.push('/');
  }

  async function handleLogin() {
    setError(null);
    const optionsRes = await fetch('/api/auth/login-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    if (!optionsRes.ok) return setError((await optionsRes.json()).error);
    const options = await optionsRes.json();

    const assertion = await startAuthentication({ optionsJSON: options });

    const verifyRes = await fetch('/api/auth/login-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, response: assertion }),
    });
    if (!verifyRes.ok) return setError((await verifyRes.json()).error);
    router.push('/');
  }

  return (
    <div>
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
      />
      {error && <p role="alert">{error}</p>}
      <button onClick={handleRegister}>Register</button>
      <button onClick={handleLogin}>Login</button>
    </div>
  );
}
```

### Logout button

```tsx
async function handleLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  router.push('/login');
}
// Rendered top-right of the main app layout, visible on all authenticated pages.
```

## Edge Cases

- **Username already taken on register** → `register-options` returns 409 before a challenge is even generated.
- **Login with unregistered username** → `login-options` returns 400 with "Unable to sign in with that username". This is not an account-enumeration prevention guarantee; duplicate registration returns 409.
- **No authenticator found for a `credential_id` on login-verify** → 401, generic "Authenticator not recognized" message.
- **Authenticator counter regression** — `verifyAuthenticationResponse` rejects if the assertion's counter is not greater than the stored counter (a classic sign of a cloned authenticator), *except* when both are 0, since some authenticators (e.g. certain platform authenticators) never increment the counter and always report 0.
- **`counter` is `undefined`** on a freshly-read authenticator row — always guard with `?? 0` (see Technical Requirements).
- **JWT cookie expired, tampered, or revoked** — `getSession()` returns `null` for an invalid token or inactive session so the proxy and API routes treat it as unauthenticated.
- **Browser/device does not support WebAuthn** — `startRegistration`/`startAuthentication` throw; catch and show a clear "your browser/device doesn't support passkeys" message rather than a raw exception.
- **User cancels the biometric/security-key prompt** — the promise from `startRegistration`/`startAuthentication` rejects (`NotAllowedError`); treat as a cancellation, not an error, and let the user retry without wiping their typed username.
- **Multiple authenticators per user** — a user registering a second device (e.g. phone after laptop) creates a second `authenticators` row for the same `user_id`; login must succeed with *any* of the user's registered authenticators, and `login-options` should include all of the user's `credential_id`s as `allowCredentials`.
- **Challenge replay/expiry** — a stored registration/login challenge must be single-use and short-lived; reject verification attempts against an already-consumed or expired challenge.
- **Race between register and route protection** — a user completing registration must have `createSession` succeed *before* the client redirects to `/`, or the proxy will bounce them back to `/login`.

## Acceptance Criteria

- [ ] Registration creates a `users` row and at least one `authenticators` row on success
- [ ] Registration rejects duplicate usernames with a 409 before generating a challenge
- [ ] Login succeeds only with a previously-registered authenticator for that username
- [ ] Login updates the authenticator's `counter` on every successful assertion
- [ ] `counter` is never read or written without a `?? 0` fallback anywhere in the auth code path
- [ ] A successful register or login sets an HTTP-only session cookie with a 7-day expiry
- [ ] `GET /api/auth/me` returns the current user when authenticated, 401 otherwise
- [ ] `POST /api/auth/logout` revokes the current session and clears cookies; replay of the old session cookie is rejected
- [ ] `proxy.ts` redirects unauthenticated requests to `/` and `/calendar/:path*` to `/login`
- [ ] `/login` redirects an already-authenticated user to `/`
- [ ] A user can register a second authenticator (second device) and log in with either
- [ ] Enrollment requires a live session, fresh existing-passkey verification, a separate save action, and a single-use grant completed within two minutes
- [ ] Session persists across a full page reload and a browser restart within the 7-day window

## Testing Requirements

Existing files: `tests/auth.test.ts`, `tests/auth-client.test.ts`, and `tests/01-authentication.spec.ts`. `tests/helpers.ts` creates **virtual WebAuthn authenticators** through Chromium DevTools Protocol. `playwright.config.ts` selects Chromium with `timezoneId: 'Asia/Singapore'`, runs a separate dev server on localhost:3100, and supplies a per-run temporary SQLite database and generated test secret.

Manifest scripts: `npm test` (`vitest run`), `npm run test:coverage` (`vitest run --coverage`), `npm run test:e2e` (`playwright test`), `npm run build` (`next build`), `npm run lint` (`eslint .`), and `npm run typecheck` (`tsc --noEmit`). Vitest enforces 80% line/statement/function/branch thresholds. PRP11 validation passed: 100 unit/integration tests, 14 Chromium E2E tests, lint, typecheck, and build. Coverage: 95.49% statements, 83.09% branches, 94.59% functions, and 96.11% lines. `tests/webauthn-counter.test.ts` verifies genuinely signed zero/stale counters without mocking the verifier. Physical-device compatibility and the under-five-second biometric timing target still need manual validation.

**E2E tests:**
- [ ] Register a new user with a virtual authenticator, verify redirect to `/`
- [ ] Register with a username that already exists, verify error message shown, no navigation
- [ ] Login with a previously-registered virtual authenticator, verify redirect to `/`
- [ ] Login with an unregistered username, verify error shown
- [ ] Logout, verify redirect to `/login` and that navigating back to `/` redirects to `/login` again
- [ ] Reload the page after login, verify session persists (still on `/`, not bounced to `/login`)
- [ ] Navigate directly to `/calendar` while unauthenticated, verify redirect to `/login`
- [ ] Navigate to `/login` while already authenticated, verify redirect to `/`
- [ ] Register a second authenticator for the same username, verify login succeeds with either

**Unit tests:**
- [ ] `createSession`/`getSession`/`deleteSession` round-trip (create → read back matches → delete → read returns null)
- [ ] JWT verification rejects a tampered token
- [ ] JWT verification rejects an expired token
- [ ] Counter-regression check rejects a replayed assertion with a stale (non-zero, non-incrementing) counter
- [ ] Counter comparison logic correctly allows repeated `0` counters (authenticators that don't support counting)

## Out of Scope

- Password-based login as a fallback or alternative to passkeys
- Social/OAuth login (Google, GitHub, etc.)
- Multi-factor authentication beyond the passkey itself
- Account recovery when a user loses their only registered passkey — this is a real, currently-unaddressed gap (no recovery codes, no email-based reset) and should be flagged to stakeholders rather than silently assumed solved
- Email verification or email-based communication of any kind
- Admin/user-management UI (listing, disabling, or deleting other users' accounts)
- Rate limiting / brute-force protection on the auth endpoints is explicitly deferred by this PRP; production must add trusted-edge throttling before public deployment

## Success Metrics

- Registration and login flows each complete in under 5 seconds end-to-end, including the biometric/security-key prompt
- Zero session-fixation or replay vulnerabilities in security review (counter-regression check verified effective)
- 7-day session expiry is enforced consistently — no session remains valid past 7 days; explicit revocation may end it earlier
- 100% of protected-route API requests without a valid session return 401, with no data leakage in the response body
- Users can register and authenticate from at least two different device/authenticator combinations without errors
