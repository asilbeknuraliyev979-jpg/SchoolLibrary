import { NextRequest, NextResponse } from 'next/server';
import {
  getCookieOptions,
  isSecureRequest,
  SESSION_COOKIE_NAME,
  signSessionToken,
} from '@/lib/auth-server';
import type { LibrarianProfile } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const uid = String(body?.uid ?? '').trim();
    const email = String(body?.email ?? '').trim();
    const displayName = String(body?.displayName ?? 'Nodira').trim();
    const emailVerified = Boolean(body?.emailVerified);

    if (!uid || !email || !emailVerified) {
      return NextResponse.json(
        { error: 'Tasdiqlangan Google hisobi talab qilinadi.' },
        { status: 401 }
      );
    }

    const now = new Date().toISOString();
    const profile: LibrarianProfile = {
      id: uid,
      username: email,
      displayName: displayName || 'Nodira',
      role: 'librarian',
      schoolName: 'Kattaqo‘rg‘on tuman ixtisoslashtirilgan maktabi',
      mustChangePassword: false,
      authProvider: 'google',
      email,
      createdAt: now,
      updatedAt: now,
    };

    const token = signSessionToken(profile);
    const res = NextResponse.json({ ok: true, user: profile, sessionToken: token });
    res.cookies.set(SESSION_COOKIE_NAME, token, getCookieOptions(isSecureRequest(req)));
    return res;
  } catch {
    return NextResponse.json({ error: 'Google sessiyasini yaratishda xatolik.' }, { status: 500 });
  }
}
