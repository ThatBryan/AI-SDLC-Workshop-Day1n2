import { postRoute } from '@/lib/auth-http';
import { passkeyVerify } from '@/lib/webauthn';

export const runtime = 'nodejs';
export const POST = postRoute(passkeyVerify);
