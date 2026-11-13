import { getSession } from '@/lib/auth';
import { authResponse, json } from '@/lib/auth-http';

export const runtime = 'nodejs';
export async function GET() {
  return authResponse(async () => {
    const session = await getSession();
    if (!session) return json({ error: 'Not authenticated' }, 401);
    return json({ userId: session.userId, username: session.username });
  });
}
