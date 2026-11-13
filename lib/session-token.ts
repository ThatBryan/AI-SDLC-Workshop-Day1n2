import { errors, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import type { Session } from './db';
import { sessionSecret } from './config';
import { getSingaporeNow } from './timezone';

const sessionSchema = z.object({
  userId: z.number().int().positive(),
  username: z.string().min(1),
  sessionId: z.string().min(1),
});
const issuer = 'todo-app';
const audience = 'todo-app-session';

export async function signSessionToken(session: Session, expiresAt: number): Promise<string> {
  return new SignJWT(sessionSchema.parse(session))
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(issuer).setAudience(audience)
    .setIssuedAt(Math.floor(getSingaporeNow().getTime() / 1000))
    .setExpirationTime(Math.floor(expiresAt / 1000))
    .sign(sessionSecret());
}

export async function verifySessionToken(token: string): Promise<Session | null> {
  const secret = sessionSecret();
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'], issuer, audience,
      requiredClaims: ['exp', 'iat'],
      currentDate: getSingaporeNow(),
    });
    const result = sessionSchema.safeParse(payload);
    return result.success ? result.data : null;
  } catch (error) {
    // Invalid credentials are an expected unauthenticated state; configuration errors aren't.
    if (error instanceof errors.JOSEError) return null;
    throw error;
  }
}
