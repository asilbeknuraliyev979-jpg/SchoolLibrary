import { NextRequest, NextResponse } from 'next/server';
import {
  getCookieOptions,
  isSecureRequest,
  SESSION_COOKIE_NAME,
  signSessionToken,
  verifyLibrarianLogin,
} from '@/lib/auth-server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const username = String(body?.username ?? '');
    const password = String(body?.password ?? '');
    if (!username.trim() || !password) {
      return NextResponse.json({ error: 'Login va parolni kiriting.' }, { status: 400 });
    }

    const profile = verifyLibrarianLogin(username, password);
    if (!profile) {
      return NextResponse.json({ error: 'Login yoki parol noto‘g‘ri.' }, { status: 401 });
    }

    const token = signSessionToken(profile);
    const res = NextResponse.json({ ok: true, user: profile, sessionToken: token });
    res.cookies.set(SESSION_COOKIE_NAME, token, getCookieOptions(isSecureRequest(req)));
    return res;
  } catch {
    return NextResponse.json({ error: 'Tizimga kirishda xatolik yuz berdi.' }, { status: 500 });
  }
}
