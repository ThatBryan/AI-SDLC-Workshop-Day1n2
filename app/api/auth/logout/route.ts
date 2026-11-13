import { cookies } from 'next/headers';
import { z } from 'zod';
import { deleteSession } from '@/lib/auth';
import { json, postRoute } from '@/lib/auth-http';
import { cookieOptions } from '@/lib/config';
import { challengeStore } from '@/lib/db';

export const runtime = 'nodejs';
export const POST = postRoute(async (body) => {
  z.object({}).parse(body);
  const jar = await cookies();
  const challenge = jar.get('auth_challenge')?.value;
  if (challenge) challengeStore.remove(challenge);
  jar.set('auth_challenge', '', { ...cookieOptions(), sameSite: 'strict', maxAge: 0 });
  await deleteSession();
  return json({ success: true });
}, true);
