export interface Session {
  userId: number;
  username: string;
}

export interface SessionUser {
  id: number;
  username: string;
}

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return null;

  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return encodeBase64Url(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

function decodeJson(value: string): unknown {
  const bytes = decodeBase64Url(value);
  if (bytes === null) return null;

  try {
    return JSON.parse(textDecoder.decode(bytes));
  } catch {
    return null;
  }
}

function getSigningKey(secret: string): Promise<CryptoKey> {
  const keyBytes = textEncoder.encode(secret);
  if (keyBytes.byteLength < 32) {
    throw new Error('JWT_SECRET must be at least 32 bytes');
  }

  return globalThis.crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyBytes),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function createSessionToken(
  user: SessionUser,
  secret: string,
  issuedAtSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  if (!Number.isSafeInteger(user.id) || user.id <= 0) {
    throw new TypeError('Session user id must be a positive safe integer');
  }
  if (typeof user.username !== 'string' || user.username.trim().length === 0) {
    throw new TypeError('Session username must not be empty');
  }
  if (!Number.isSafeInteger(issuedAtSeconds) || issuedAtSeconds < 0) {
    throw new TypeError('Session issue time must be a non-negative integer');
  }

  const header = encodeBase64Url(
    textEncoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
  );
  const payload = encodeBase64Url(
    textEncoder.encode(
      JSON.stringify({
        userId: user.id,
        username: user.username,
        iat: issuedAtSeconds,
        exp: issuedAtSeconds + SESSION_TTL_SECONDS,
      }),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const key = await getSigningKey(secret);
  const signature = new Uint8Array(
    await globalThis.crypto.subtle.sign(
      'HMAC',
      key,
      toArrayBuffer(textEncoder.encode(signingInput)),
    ),
  );

  return `${signingInput}.${encodeBase64Url(signature)}`;
}

export async function verifySessionToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Session | null> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return null;

  const header = decodeJson(parts[0]);
  const payload = decodeJson(parts[1]);
  const signature = decodeBase64Url(parts[2]);
  if (
    !isRecord(header) ||
    header.alg !== 'HS256' ||
    header.typ !== 'JWT' ||
    !isRecord(payload) ||
    signature === null ||
    !Number.isSafeInteger(nowSeconds)
  ) {
    return null;
  }

  const { userId, username, iat, exp } = payload;
  if (
    typeof userId !== 'number' ||
    !Number.isSafeInteger(userId) ||
    userId <= 0 ||
    typeof username !== 'string' ||
    username.trim().length === 0 ||
    typeof iat !== 'number' ||
    !Number.isSafeInteger(iat) ||
    typeof exp !== 'number' ||
    !Number.isSafeInteger(exp) ||
    iat > nowSeconds ||
    exp <= nowSeconds ||
    exp - iat !== SESSION_TTL_SECONDS
  ) {
    return null;
  }

  const key = await getSigningKey(secret);
  const isValid = await globalThis.crypto.subtle.verify(
    'HMAC',
    key,
    toArrayBuffer(signature),
    toArrayBuffer(textEncoder.encode(`${parts[0]}.${parts[1]}`)),
  );

  return isValid ? { userId, username } : null;
}
