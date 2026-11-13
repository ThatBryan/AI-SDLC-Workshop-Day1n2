import { postRoute } from '@/lib/auth-http';
import { loginOptions } from '@/lib/webauthn';

export const runtime = 'nodejs';
export const POST = postRoute(loginOptions);
