import { postRoute } from '@/lib/auth-http';
import { registerVerify } from '@/lib/webauthn';

export const runtime = 'nodejs';
export const POST = postRoute(registerVerify);
