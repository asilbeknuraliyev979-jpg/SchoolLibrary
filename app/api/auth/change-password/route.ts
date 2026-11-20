import { NextRequest, NextResponse } from 'next/server';
import {
  changeLibrarianPassword,
  getCookieOptions,
  getServerSession,
  isSecureRequest,
  SESSION_COOKIE_NAME,
  signSessionToken,
} from '@/lib/auth-server';

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Avtorizatsiya talab qilinadi.' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const currentPassword = String(body?.currentPassword ?? '');
    const newPassword = String(body?.newPassword ?? '');
    const updated = changeLibrarianPassword(currentPassword, newPassword);
    const token = signSessionToken(updated);
    const res = NextResponse.json({ ok: true, user: updated, sessionToken: token });
    res.cookies.set(SESSION_COOKIE_NAME, token, getCookieOptions(isSecureRequest(req)));
    return res;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Parolni almashtirishda xatolik.' },
      { status: 400 }
    );
  }
}
