import { postRoute } from '@/lib/auth-http';
import { passkeyOptions } from '@/lib/webauthn';

export const runtime = 'nodejs';
export const POST = postRoute(passkeyOptions);
