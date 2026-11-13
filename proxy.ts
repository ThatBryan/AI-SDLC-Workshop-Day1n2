import { NextRequest, NextResponse } from 'next/server';
import { sessionFromToken } from '@/lib/auth';

export async function proxy(request: NextRequest) {
  const session = await sessionFromToken(request.cookies.get('session')?.value);
  if (!session) return NextResponse.redirect(new URL('/login', request.url));
  return NextResponse.next();
}

export const config = { matcher: ['/', '/calendar/:path*'] };
