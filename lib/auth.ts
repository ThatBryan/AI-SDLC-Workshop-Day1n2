import { cookies } from 'next/headers';
import {
  createSessionToken,
  type Session,
  type SessionUser,
  verifySessionToken,
} from './sessionToken';

export type { Session } from './sessionToken';

export const SESSION_COOKIE_NAME = 'todo_session';

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

type RequestCookieReader = {
  cookies: {
    get(name: string): { value: string } | undefined;
  };
};

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret === undefined) {
    throw new Error('JWT_SECRET is required to create or verify sessions');
  }
  return secret;
}

function getCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}

export async function createSession(user: SessionUser): Promise<void> {
  const issuedAtSeconds = Math.floor(Date.now() / 1000);
  const token = await createSessionToken(
    user,
    getJwtSecret(),
    issuedAtSeconds,
  );
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    ...getCookieOptions(),
    expires: new Date((issuedAtSeconds + SESSION_TTL_SECONDS) * 1000),
  });
}

export async function getSession(
  request?: RequestCookieReader,
): Promise<Session | null> {
  const token =
    request?.cookies.get(SESSION_COOKIE_NAME)?.value ??
    (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  return verifySessionToken(token, getJwtSecret());
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, '', {
    ...getCookieOptions(),
    expires: new Date(0),
    maxAge: 0,
  });
}
