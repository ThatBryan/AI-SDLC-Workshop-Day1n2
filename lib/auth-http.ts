import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { relyingParty } from './config';

export class AuthError extends Error {
  constructor(message: string, public readonly status = 401) {
    super(message);
  }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function authResponse(work: () => Promise<NextResponse>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AuthError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return json({ error: 'Invalid request. Check the username and passkey response.' }, 400);
    }
    if (error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return json({ error: 'Username or passkey already registered' }, 409);
    }
    console.error('Authentication request failed', { errorType: error instanceof Error ? error.name : 'Unknown' });
    return json({ error: 'Authentication is unavailable. Please try again.' }, 500);
  }
}

async function readJson(request: NextRequest, allowEmpty: boolean): Promise<unknown> {
  if (request.headers.get('origin') !== relyingParty().origin) {
    throw new AuthError('Request origin not allowed', 403);
  }
  if (allowEmpty && !request.body && !request.headers.has('content-type')) return {};
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    throw new AuthError('Expected a JSON request', 400);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError('Missing request body', 400);
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65_536) {
      await reader.cancel();
      throw new AuthError('Request too large', 413);
    }
    text += decoder.decode(value, { stream: true });
  }
  return JSON.parse(text + decoder.decode());
}

export function postRoute(work: (body: unknown) => Promise<NextResponse>, allowEmpty = false) {
  return (request: NextRequest) => authResponse(async () => work(await readJson(request, allowEmpty)));
}

export const usernameSchema = z.string().trim().min(1).max(64)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), 'Username contains unsupported characters');
export const usernameBody = z.object({ username: usernameSchema });
const base64url = z.string().min(1).max(32_768).regex(/^[A-Za-z0-9_-]+$/);
const credentialBase = {
  id: base64url,
  rawId: base64url,
  type: z.literal('public-key'),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults: z.object({}),
};
export const registrationSchema = z.object({
  ...credentialBase,
  response: z.object({
    clientDataJSON: base64url,
    attestationObject: base64url,
    transports: z.array(z.enum(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'])).optional(),
  }),
}).refine((value) => value.id === value.rawId);
export const authenticationSchema = z.object({
  ...credentialBase,
  response: z.object({
    clientDataJSON: base64url,
    authenticatorData: base64url,
    signature: base64url,
    userHandle: base64url.nullish().transform((value) => value ?? undefined),
  }),
}).refine((value) => value.id === value.rawId);

export const loginBody = z.union([
  z.object({ intent: z.literal('add-passkey') }),
  z.object({ username: usernameSchema, intent: z.undefined().optional() }),
]);
export const loginVerifyBody = z.intersection(loginBody, z.object({ response: authenticationSchema }));
