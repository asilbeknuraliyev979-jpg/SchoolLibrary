import { NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimitKey,
  extractClientIp,
  getCookieOptions,
  initializeLibrarianPassword,
  MAX_ACCOUNT_LOGIN_ATTEMPTS,
  recordRateLimitFailure,
  SESSION_COOKIE_NAME,
  signSessionToken,
} from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
};

export async function POST(req: NextRequest) {
  try {
    const clientIp = extractClientIp(req);
    const setupKey = `setup::${clientIp}`;
    const limit = checkRateLimitKey(setupKey);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Juda ko‘p urinish. Bir ozdan keyin qayta urinib ko‘ring.' },
        {
          status: 429,
          headers: {
            ...NO_STORE_HEADERS,
            'Retry-After': String(limit.retryAfterSeconds),
          },
        }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: 'Noto‘g‘ri so‘rov formati.' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const username = String(body?.username ?? 'nodira.library');
    const password = String(body?.password ?? '');
    const profile = initializeLibrarianPassword(username, password);
    const token = signSessionToken(profile);
    const res = NextResponse.json({ ok: true, user: profile }, { headers: NO_STORE_HEADERS });
    res.cookies.set(SESSION_COOKIE_NAME, token, getCookieOptions(req));
    return res;
  } catch (err) {
    const clientIp = extractClientIp(req);
    recordRateLimitFailure(`setup::${clientIp}`, MAX_ACCOUNT_LOGIN_ATTEMPTS);
    const message = err instanceof Error ? err.message : 'Boshlang‘ich sozlashda xatolik yuz berdi.';
    console.warn('[api/auth/setup] Setup rejected:', message);
    return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE_HEADERS });
  }
}
