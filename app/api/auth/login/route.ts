import { NextRequest, NextResponse } from 'next/server';
import {
  checkLoginRateLimit,
  clearLoginRateLimit,
  getCookieOptions,
  isSecureRequest,
  recordFailedLoginAttempt,
  SESSION_COOKIE_NAME,
  signSessionToken,
  verifyLibrarianLogin,
} from '@/lib/auth-server';
import { recordAuthAuditLog } from '@/lib/server-store';

function getClientKey(req: NextRequest, username: string): string {
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  return `${fwd}::${username.trim().toLowerCase()}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const username = String(body?.username ?? '').trim();
    const password = String(body?.password ?? '');
    if (!username || !password) {
      return NextResponse.json({ error: 'Login va parolni kiriting.' }, { status: 400 });
    }

    const rateKey = getClientKey(req, username);
    const limitStatus = checkLoginRateLimit(rateKey);
    if (!limitStatus.allowed) {
      await recordAuthAuditLog(
        'LOGIN_LOCKED',
        username,
        `Kirish urinishlari limiti oshdi (${limitStatus.retryAfterMinutes} daqiqaga cheklandi).`
      );
      return NextResponse.json(
        {
          error: `Juda ko‘p noto‘g‘ri urinish. Iltimos, ${limitStatus.retryAfterMinutes} daqiqadan so‘ng qayta urinib ko‘ring.`,
        },
        { status: 429 }
      );
    }

    const profile = verifyLibrarianLogin(username, password);
    if (!profile) {
      const attempt = recordFailedLoginAttempt(rateKey);
      await recordAuthAuditLog(
        'LOGIN_FAILED',
        username,
        attempt.locked
          ? `Noto‘g‘ri parol. Hisob ${attempt.retryAfterMinutes} daqiqaga vaqtincha bloklandi.`
          : `Noto‘g‘ri kirish urinishi (qolgan urinishlar: ${attempt.remainingAttempts}).`
      );
      if (attempt.locked) {
        return NextResponse.json(
          {
            error: `Juda ko‘p noto‘g‘ri urinish. Iltimos, ${attempt.retryAfterMinutes} daqiqadan so‘ng qayta urinib ko‘ring.`,
          },
          { status: 429 }
        );
      }
      return NextResponse.json(
        {
          error: `Login yoki parol noto‘g‘ri (qolgan urinishlar: ${attempt.remainingAttempts}).`,
        },
        { status: 401 }
      );
    }

    clearLoginRateLimit(rateKey);
    await recordAuthAuditLog('LOGIN_SUCCESS', profile.displayName, `${profile.username} tizimga kirdi.`);

    const token = signSessionToken(profile);
    const res = NextResponse.json({ ok: true, user: profile, sessionToken: token });
    res.cookies.set(SESSION_COOKIE_NAME, token, getCookieOptions(isSecureRequest(req)));
    return res;
  } catch {
    return NextResponse.json({ error: 'Tizimga kirishda xatolik yuz berdi.' }, { status: 500 });
  }
}
