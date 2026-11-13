import { postRoute } from '@/lib/auth-http';
import { registerOptions } from '@/lib/webauthn';

export const runtime = 'nodejs';
export const POST = postRoute(registerOptions);
