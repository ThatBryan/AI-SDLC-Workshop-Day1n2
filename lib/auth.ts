import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { cookieOptions, SESSION_SECONDS } from './config';
import { sessionDB, userDB, type Session, type User } from './db';
import { signSessionToken, verifySessionToken } from './session-token';
import { getSingaporeNow } from './timezone';

export async function sessionFromToken(token?: string): Promise<Session | null> {
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session || !sessionDB.isActive(session.sessionId, session.userId)) return null;
  const user = userDB.findById(session.userId);
  return user?.username === session.username ? session : null;
}

export async function createSession(user: User): Promise<void> {
  const jar = await cookies();
  const sessionId = randomBytes(32).toString('base64url');
  const expiresAt = (Math.floor(getSingaporeNow().getTime() / 1000) + SESSION_SECONDS) * 1000;
  const token = await signSessionToken({ userId: user.id, username: user.username, sessionId }, expiresAt);
  const previous = await sessionFromToken(jar.get('session')?.value);
  if (previous) sessionDB.revoke(previous.sessionId);
  sessionDB.create(sessionId, user.id, expiresAt);
  jar.set('session', token, { ...cookieOptions(), maxAge: SESSION_SECONDS });
}

export async function getSession(): Promise<Session | null> {
  return sessionFromToken((await cookies()).get('session')?.value);
}

export async function deleteSession(): Promise<void> {
  const jar = await cookies();
  const session = await sessionFromToken(jar.get('session')?.value);
  if (session) sessionDB.revoke(session.sessionId);
  jar.set('session', '', { ...cookieOptions(), maxAge: 0 });
}
