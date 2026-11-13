import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebAuthnError } from '@simplewebauthn/browser';
import { enrollmentRemainingMs, passkeyMessage, postAuth, RequestError } from '../lib/auth-client';

afterEach(() => vi.unstubAllGlobals());

describe('authentication client errors', () => {
  it.each([undefined, { success: true }, { success: true, enrollmentExpiresAt: 'later', serverTime: 1 }])(
    'rejects incomplete enrollment authorization: %j', (data) => {
      expect(() => enrollmentRemainingMs(data, 0)).toThrow('Invalid passkey authorization');
    },
  );

  it.each([-300_000, 300_000])('does not depend on client clock skew (%i ms)', (skew) => {
    vi.stubGlobal('Date', class extends Date { static now() { return 1_000_000 + skew; } });
    const grant = { success: true, serverTime: 1_000_000, enrollmentExpiresAt: 1_120_000 };
    expect(enrollmentRemainingMs(grant, 500)).toBe(119_500);
    expect(enrollmentRemainingMs(grant, 120_001)).toBe(0);
  });

  it('posts JSON and returns the verified server result', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ success: true }));
    vi.stubGlobal('fetch', fetch);
    expect(await postAuth('logout')).toEqual({ success: true });
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({
      method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' },
    }));
  });

  it('preserves API status and safe error messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Not authenticated' }, { status: 401 })));
    await expect(postAuth('passkeys/options')).rejects.toMatchObject({
      message: 'Not authenticated', status: 401,
    });
  });

  it('handles a non-JSON gateway error without exposing parsing internals', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 })));
    await expect(postAuth('login-options')).rejects.toMatchObject({
      message: 'Authentication is unavailable. Please try again.', status: 502,
    });
  });

  it.each(['null', '{"error":42}', '[]', 'not json'])('rejects an unexpected successful response: %s', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    await expect(postAuth('login-options')).rejects.toBeInstanceOf(RequestError);
  });

  it('handles network failures with retry guidance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(postAuth('login-options')).rejects.toThrow('Check your connection');
  });

  it('uses a generic message for an API error without an error string', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({}, { status: 500 })));
    await expect(postAuth('login-options')).rejects.toThrow('Authentication failed');
  });

  it('identifies wrapped browser cancellation without exposing raw exceptions', () => {
    const cause = new DOMException('Internal platform message', 'NotAllowedError');
    const wrapped = new WebAuthnError({
      message: cause.message, code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', cause,
    });
    expect(passkeyMessage(wrapped)).toMatch(/cancelled.*try again/i);
    expect(passkeyMessage(cause)).toMatch(/cancelled.*try again/i);
  });

  it('provides retry guidance for aborts and unsupported authenticators', () => {
    const cause = new Error('Internal details');
    expect(passkeyMessage(new WebAuthnError({
      message: cause.message, code: 'ERROR_CEREMONY_ABORTED', cause,
    }))).toMatch(/cancelled/i);
    expect(passkeyMessage(new WebAuthnError({
      message: cause.message, code: 'ERROR_AUTHENTICATOR_GENERAL_ERROR', cause,
    }))).toMatch(/another authenticator/i);
    expect(passkeyMessage(new Error('Network unavailable'))).toBe('Network unavailable');
    expect(passkeyMessage(null)).toMatch(/try again/i);
  });
});
