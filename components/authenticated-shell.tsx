'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  startAuthentication, startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { z } from 'zod';
import { enrollmentRemainingMs, passkeyMessage, postAuth, RequestError, usePasskeySupport } from '@/lib/auth-client';

const currentUser = z.object({ userId: z.number(), username: z.string() });

export function AuthenticatedShell({
  calendar = false,
  children,
}: {
  calendar?: boolean;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [user, setUser] = useState<z.infer<typeof currentUser> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [enrollmentDeadline, setEnrollmentDeadline] = useState<number | null>(null);
  const pending = useRef(false);
  const support = usePasskeySupport();

  useEffect(() => {
    const controller = new AbortController();
    async function loadUser() {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store', signal: controller.signal });
        if (response.status === 401) { router.replace('/login'); return; }
        if (!response.ok) throw new Error('Unable to load your session. Reload to try again.');
        setUser(currentUser.parse(await response.json()));
      } catch (failure) {
        if (!(failure instanceof Error && failure.name === 'AbortError')) {
          setError('Unable to load your session. Reload to try again.');
        }
      }
    }
    void loadUser();
    return () => controller.abort();
  }, [router]);

  useEffect(() => {
    if (!enrollmentDeadline) return;
    const timer = setTimeout(() => {
      setEnrollmentDeadline(null);
      setStatus('Passkey verification expired. Select Add passkey to verify again.');
    }, Math.max(0, enrollmentDeadline - performance.now()));
    return () => clearTimeout(timer);
  }, [enrollmentDeadline]);

  async function act(operation: 'logout' | 'reauth' | 'enroll') {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setStatus('');
    setEnrollmentDeadline(null);
    try {
      if (operation === 'logout') {
        await postAuth('logout');
        router.replace('/login');
        router.refresh();
      } else if (operation === 'reauth') {
        const options = await postAuth<PublicKeyCredentialRequestOptionsJSON>('login-options', { intent: 'add-passkey' });
        const response = await startAuthentication({ optionsJSON: options });
        const startedAt = performance.now();
        const verified = await postAuth<unknown>(
          'login-verify', { intent: 'add-passkey', response },
        );
        const remaining = enrollmentRemainingMs(verified, performance.now() - startedAt);
        if (remaining === 0) throw new Error('Passkey verification expired. Please verify again.');
        setEnrollmentDeadline(performance.now() + remaining);
        setStatus('Existing passkey verified');
      } else {
        const options = await postAuth<PublicKeyCredentialCreationOptionsJSON>('passkeys/options');
        const response = await startRegistration({ optionsJSON: options });
        await postAuth('passkeys/verify', { response });
        setStatus('Passkey added');
      }
    } catch (failure) {
      setError(passkeyMessage(failure));
      if (failure instanceof RequestError && failure.status === 401) {
        setError(`${passkeyMessage(failure)} Sign in again if your session has expired.`);
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="text-xl font-bold">Todo App</Link>
        <nav aria-label="Main navigation" className="flex items-center gap-3">
          <Link className="button secondary" href={calendar ? '/' : '/calendar'}>{calendar ? 'My todos' : 'Calendar'}</Link>
          <button type="button" disabled={busy} onClick={() => void act('logout')}>Logout</button>
        </nav>
      </header>
      <main>
        {user && <p data-testid="session-user" className="muted mb-2">Signed in as {user.username}</p>}
        {!children && <h1 className="mb-6 text-3xl font-bold">{calendar ? 'Calendar' : 'My todos'}</h1>}
        {children ?? (
          <section className="panel mb-6" data-testid="protected-placeholder">
            <h2 className="mb-2 text-xl font-semibold">Your secure workspace is ready</h2>
            <p className="muted">{calendar ? 'The calendar view' : 'Todo creation and management'} will be implemented in a later feature. Passkey authentication is available now.</p>
          </section>
        )}
        <section className="panel" aria-labelledby="passkey-title" aria-busy={busy}>
          <h2 id="passkey-title" className="mb-2 text-xl font-semibold">Protect your access</h2>
          <p className="muted mb-5">Add a backup passkey on another device or security key. First verify an existing passkey, then save the new one within two minutes.</p>
          {error && <p role="alert" className="error mb-4">{error}</p>}
          {support === 'unsupported' && <p role="alert" className="error mb-4">Passkeys are not supported in this browser.</p>}
          {status && <p role="status" className="mb-4 font-semibold">{status}</p>}
          {enrollmentDeadline ? (
            <button disabled={busy} onClick={() => void act('enroll')}>Save new passkey</button>
          ) : (
            <button disabled={busy || !user || support !== 'supported'} onClick={() => void act('reauth')}>Add passkey</button>
          )}
          {busy && <p className="muted mt-3">Please complete the prompt on your device...</p>}
          <p className="muted mt-5 text-sm">No recovery codes or password reset are available. Keep at least one working passkey.</p>
        </section>
      </main>
    </div>
  );
}
