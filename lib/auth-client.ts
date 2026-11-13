'use client';

import { useSyncExternalStore } from 'react';
import { browserSupportsWebAuthn, WebAuthnError } from '@simplewebauthn/browser';
import { z } from 'zod';

export class RequestError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

const enrollmentAuthorization = z.object({
  success: z.literal(true),
  enrollmentExpiresAt: z.number().int().positive(),
  serverTime: z.number().int().positive(),
}).refine((data) => data.enrollmentExpiresAt > data.serverTime);

export function enrollmentRemainingMs(data: unknown, elapsedMs: number): number {
  const result = enrollmentAuthorization.safeParse(data);
  if (!result.success) throw new RequestError('Invalid passkey authorization response. Please verify again.', 200);
  return Math.max(0, result.data.enrollmentExpiresAt - result.data.serverTime - elapsedMs);
}

export async function postAuth<T>(path: string, body: object = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/auth/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not connect. Check your connection and try again.');
  }
  const data = await response.json().catch(() => {
    throw new RequestError('Authentication is unavailable. Please try again.', response.status);
  });
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new RequestError('Unexpected authentication response. Please try again.', response.status);
  }
  if (!response.ok) {
    throw new RequestError(
      typeof data.error === 'string' ? data.error : 'Authentication failed. Please try again.',
      response.status,
    );
  }
  if (data.success !== true && typeof data.challenge !== 'string') {
    throw new RequestError('Unexpected authentication response. Please try again.', response.status);
  }
  return data;
}

export function passkeyMessage(error: unknown): string {
  if (error instanceof Error && (error.name === 'NotAllowedError' ||
      (error.cause instanceof Error && error.cause.name === 'NotAllowedError'))) {
    return 'Passkey prompt cancelled or timed out. You can try again.';
  }
  if (error instanceof WebAuthnError) {
    if (error.code === 'ERROR_CEREMONY_ABORTED') return 'Passkey prompt cancelled. You can try again.';
    return 'Unable to use that passkey. Try another authenticator or check your browser settings.';
  }
  return error instanceof Error ? error.message : 'Unable to use passkeys. Please try again.';
}

const subscribe = () => () => {};
function supportSnapshot() {
  return browserSupportsWebAuthn() && window.isSecureContext &&
    typeof navigator.credentials?.create === 'function' &&
    typeof navigator.credentials?.get === 'function' ? 'supported' : 'unsupported';
}
export function usePasskeySupport() {
  return useSyncExternalStore(subscribe, supportSnapshot, () => 'checking');
}
