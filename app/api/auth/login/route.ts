import { NextRequest, NextResponse } from 'next/server';
import {
  checkLoginRateLimit,
  clearLoginRateLimit,
  extractClientIp,
  getCookieOptions,
  recordFailedLoginAttempt,
  SESSION_COOKIE_NAME,
  signSessionToken,
  verifyLibrarianLogin,
} from '@/lib/auth-server';
import { recordAuthAuditLog } from '@/lib/server-store';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
};

async function safeAuditLog(
  action: 'LOGIN_SUCCESS' | 'LOGIN_FAILED' | 'LOGIN_LOCKED' | 'LOGOUT',
  actor: string,
  details: string
): Promise<void> {
  try {
    await recordAuthAuditLog(action, actor, details);
  } catch (err) {
    console.warn('[api/auth/login] Audit log write skipped:', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: 'Noto‘g‘ri so‘rov formati.' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const username = String(body?.username ?? '').trim();
    const password = String(body?.password ?? '');
    if (!username || !password || username.length > 100 || password.length > 200) {
      return NextResponse.json(
        { error: 'Login va parolni kiriting.' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const clientIp = extractClientIp(req);
    const limitStatus = checkLoginRateLimit(clientIp, username);
    if (!limitStatus.allowed) {
      await safeAuditLog(
        'LOGIN_LOCKED',
        username,
        `IP (${clientIp}) bo‘yicha urinishlar limiti oshdi (${limitStatus.retryAfterMinutes} daqiqa bloklandi).`
      );
      return NextResponse.json(
        {
          error: `Juda ko‘p urinish. Iltimos, ${limitStatus.retryAfterMinutes} daqiqadan keyin qayta urinib ko‘ring.`,
        },
        {
          status: 429,
          headers: {
            ...NO_STORE_HEADERS,
            'Retry-After': String(limitStatus.retryAfterSeconds),
          },
        }
      );
    }

    const profile = verifyLibrarianLogin(username, password);
    if (!profile) {
      const attempt = recordFailedLoginAttempt(clientIp, username);
      await safeAuditLog(
        'LOGIN_FAILED',
        username,
        attempt.locked
          ? `Noto‘g‘ri kirish (${clientIp}). ${attempt.retryAfterMinutes} daqiqaga vaqtincha bloklandi.`
          : `Noto‘g‘ri kirish urinishi (${clientIp}).`
      );

      if (attempt.locked) {
        return NextResponse.json(
          {
            error: `Juda ko‘p urinish. Iltimos, ${attempt.retryAfterMinutes} daqiqadan keyin qayta urinib ko‘ring.`,
          },
          {
            status: 429,
            headers: {
              ...NO_STORE_HEADERS,
              'Retry-After': String(attempt.retryAfterSeconds),
            },
          }
        );
      }

      return NextResponse.json(
        { error: 'Login yoki parol noto‘g‘ri.' },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    clearLoginRateLimit(clientIp, username);
    await safeAuditLog('LOGIN_SUCCESS', profile.displayName, `${profile.username} tizimga kirdi (${clientIp}).`);

    const token = signSessionToken(profile);
    // Token is set EXCLUSIVELY in an HttpOnly cookie (never returned in JSON body)
    const res = NextResponse.json({ ok: true, user: profile }, { headers: NO_STORE_HEADERS });
    res.cookies.set(SESSION_COOKIE_NAME, token, getCookieOptions(req));
    return res;
  } catch (err) {
    console.error('[api/auth/login] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Tizimga kirishda server xatoligi yuz berdi. Keyinroq qayta urinib ko‘ring.' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
