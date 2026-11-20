import { NextRequest, NextResponse } from 'next/server';
import { getCookieOptions, isSecureRequest, SESSION_COOKIE_NAME } from '@/lib/auth-server';

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, '', {
    ...getCookieOptions(isSecureRequest(req)),
    maxAge: 0,
  });
  return res;
}
