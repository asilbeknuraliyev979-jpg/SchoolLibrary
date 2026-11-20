import { NextRequest, NextResponse } from 'next/server';
import {
  changeLibrarianPassword,
  getCookieOptions,
  getServerSession,
  SESSION_COOKIE_NAME,
  signSessionToken,
} from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
};

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json(
      { error: 'Avtorizatsiya talab qilinadi.' },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const currentPassword = String(body?.currentPassword ?? '');
    const newPassword = String(body?.newPassword ?? '');
    const updated = changeLibrarianPassword(currentPassword, newPassword);
    const token = signSessionToken(updated);
    const res = NextResponse.json({ ok: true, user: updated }, { headers: NO_STORE_HEADERS });
    res.cookies.set(SESSION_COOKIE_NAME, token, getCookieOptions(req));
    return res;
  } catch (err) {
    console.warn('[api/auth/change-password] Rejected:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Parolni almashtirishda xatolik.' },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }
}
