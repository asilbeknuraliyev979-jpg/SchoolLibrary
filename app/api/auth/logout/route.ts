import { NextRequest, NextResponse } from 'next/server';
import { getCookieOptions, SESSION_COOKIE_NAME } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const res = NextResponse.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, private' } }
    );
    res.cookies.set(SESSION_COOKIE_NAME, '', {
      ...getCookieOptions(req),
      maxAge: 0,
    });
    return res;
  } catch (err) {
    console.error('[api/auth/logout] Unexpected error:', err);
    return NextResponse.json({ error: 'Chiqishda xatolik yuz berdi.' }, { status: 500 });
  }
}
