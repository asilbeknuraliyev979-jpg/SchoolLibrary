import { NextRequest, NextResponse } from 'next/server';
import {
  getCookieOptions,
  initializeLibrarianPassword,
  isSecureRequest,
  SESSION_COOKIE_NAME,
  signSessionToken,
} from '@/lib/auth-server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const username = String(body?.username ?? 'nodira.library');
    const password = String(body?.password ?? '');
    const profile = initializeLibrarianPassword(username, password);
    const token = signSessionToken(profile);
    const res = NextResponse.json({ ok: true, user: profile, sessionToken: token });
    res.cookies.set(SESSION_COOKIE_NAME, token, getCookieOptions(isSecureRequest(req)));
    return res;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Boshlang‘ich sozlashda xatolik yuz berdi.' },
      { status: 400 }
    );
  }
}
