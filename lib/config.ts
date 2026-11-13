export function sessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 bytes of random secret material');
  }
  return new TextEncoder().encode(secret);
}

export function relyingParty() {
  const { RP_ID, RP_NAME, RP_ORIGIN } = process.env;
  if (!RP_ID || !RP_NAME || !RP_ORIGIN) {
    throw new Error('RP_ID, RP_NAME and RP_ORIGIN are required');
  }
  const origin = new URL(RP_ORIGIN);
  if (origin.origin !== RP_ORIGIN || origin.username || origin.password ||
      !(origin.hostname === RP_ID || origin.hostname.endsWith(`.${RP_ID}`)) ||
      (origin.protocol !== 'https:' &&
        !(process.env.NODE_ENV !== 'production' && origin.protocol === 'http:' && origin.hostname === 'localhost'))) {
    throw new Error('RP_ORIGIN must be an exact HTTPS origin matching RP_ID (HTTP localhost is development only)');
  }
  return { rpID: RP_ID, rpName: RP_NAME, origin: RP_ORIGIN };
}

export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const CHALLENGE_MS = 5 * 60 * 1000;
export const ENROLLMENT_MS = 2 * 60 * 1000;

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}
