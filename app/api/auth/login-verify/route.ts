import { postRoute } from '@/lib/auth-http';
import { loginVerify } from '@/lib/webauthn';

export const runtime = 'nodejs';
export const POST = postRoute(loginVerify);
