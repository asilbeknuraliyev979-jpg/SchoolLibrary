import { NextRequest, NextResponse } from 'next/server';
import firebaseConfig from '@/firebase-applet-config.json';
import {
  getCookieOptions,
  SESSION_COOKIE_NAME,
  signSessionToken,
} from '@/lib/auth-server';
import type { LibrarianProfile } from '@/lib/types';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
};

function getAllowedGoogleEmails(): Set<string> {
  const raw = process.env.ALLOWED_GOOGLE_EMAILS || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * Verifies a real Firebase Auth ID token server-side against Google Identity Toolkit
 * and restricts sign-in strictly to ALLOWED_GOOGLE_EMAILS.
 */
export async function POST(req: NextRequest) {
  try {
    const allowedEmails = getAllowedGoogleEmails();
    if (allowedEmails.size === 0) {
      return NextResponse.json(
        { error: 'Google orqali kirish ushbu tizimda yoqilmagan.' },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    const body = (await req.json()) as Record<string, unknown>;
    const idToken = String(body?.idToken ?? '').trim();
    if (!idToken || idToken.length > 4096) {
      return NextResponse.json(
        { error: 'Tasdiqlangan Firebase ID tokeni talab qilinadi.' },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    const apiKey = process.env.FIREBASE_WEB_API_KEY || firebaseConfig.apiKey;
    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        cache: 'no-store',
      }
    );

    if (!verifyRes.ok) {
      return NextResponse.json(
        { error: 'Google tokeni yaroqsiz yoki muddati o‘tgan.' },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    const lookup = (await verifyRes.json()) as {
      users?: Array<{
        localId?: string;
        email?: string;
        emailVerified?: boolean;
        displayName?: string;
      }>;
    };
    const fbUser = lookup.users?.[0];
    const email = fbUser?.email?.trim().toLowerCase() ?? '';

    if (!fbUser?.localId || !email || !fbUser.emailVerified || !allowedEmails.has(email)) {
      return NextResponse.json(
        { error: 'Ushbu Google hisobiga tizimga kirish ruxsati berilmagan.' },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    const now = new Date().toISOString();
    const profile: LibrarianProfile = {
      id: fbUser.localId,
      username: email,
      displayName: fbUser.displayName?.trim() || 'Nodira',
      role: 'librarian',
      schoolName: 'Kattaqo‘rg‘on tuman ixtisoslashtirilgan maktabi',
      mustChangePassword: false,
      authProvider: 'google',
      email,
      createdAt: now,
      updatedAt: now,
    };

    const token = signSessionToken(profile);
    const res = NextResponse.json({ ok: true, user: profile }, { headers: NO_STORE_HEADERS });
    res.cookies.set(SESSION_COOKIE_NAME, token, getCookieOptions(req));
    return res;
  } catch (err) {
    console.error('[api/auth/google] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Google sessiyasini yaratishda xatolik.' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
