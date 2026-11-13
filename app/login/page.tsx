'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  startAuthentication, startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { passkeyMessage, postAuth, usePasskeySupport } from '@/lib/auth-client';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const support = usePasskeySupport();
  const router = useRouter();

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/me', { cache: 'no-store', signal: controller.signal })
      .then((response) => {
        if (response.ok) router.replace('/');
        else if (response.status !== 401) setError('Unable to check your session. Please try again.');
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof Error && failure.name === 'AbortError')) {
          setError('Could not connect. Check your connection and try again.');
        }
      });
    return () => controller.abort();
  }, [router]);

  async function authenticate(mode: 'register' | 'login') {
    if (pending.current) return;
    const name = username.trim();
    if (!name) { setError('Enter a username to continue.'); return; }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') {
        const options = await postAuth<PublicKeyCredentialCreationOptionsJSON>('register-options', { username: name });
        const response = await startRegistration({ optionsJSON: options });
        await postAuth('register-verify', { username: name, response });
      } else {
        const options = await postAuth<PublicKeyCredentialRequestOptionsJSON>('login-options', { username: name });
        const response = await startAuthentication({ optionsJSON: options });
        await postAuth('login-verify', { username: name, response });
      }
      router.replace('/');
      router.refresh();
    } catch (failure) {
      setError(passkeyMessage(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const message = support === 'unsupported' ? 'Passkeys are not supported in this browser or context. Use a modern browser with HTTPS or localhost.' : error;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <section className="panel w-full max-w-md shadow-lg" aria-labelledby="login-title">
        <p className="mb-3 text-sm font-semibold tracking-widest text-indigo-600 dark:text-indigo-300">SIMPLE. SECURE. YOURS.</p>
        <h1 id="login-title" className="text-3xl font-bold">Todo App</h1>
        <p className="muted mt-3 mb-8">One less thing to remember. Sign in with a passkey, not a password.</p>
        <form onSubmit={(event) => { event.preventDefault(); void authenticate('login'); }} aria-busy={busy}>
          <label htmlFor="username" className="mb-2 block font-semibold">Username</label>
          <input
            id="username" name="username" autoComplete="username webauthn" maxLength={64}
            value={username} onChange={(event) => setUsername(event.target.value)}
            disabled={busy} placeholder="Your username"
            className="mb-5 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
          />
          {message && <p role="alert" className="error mb-5">{message}</p>}
          <div className="flex gap-3">
            <button type="submit" className="flex-1" disabled={busy || support !== 'supported'}>Login</button>
            <button type="button" className="secondary flex-1" disabled={busy || support !== 'supported'}
              onClick={() => void authenticate('register')}>Register</button>
          </div>
          {busy && <p role="status" className="muted mt-4">Follow your device&apos;s passkey prompt...</p>}
        </form>
        <p className="muted mt-8 text-sm">Use Windows Hello, Touch ID, Face ID, a synced passkey, or a security key.</p>
        <p className="muted mt-3 text-sm">Keep a backup passkey. Account recovery is not available if all your passkeys are lost.</p>
      </section>
    </main>
  );
}
