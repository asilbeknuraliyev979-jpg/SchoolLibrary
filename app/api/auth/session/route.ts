import { NextResponse } from 'next/server';
import { getServerSession, isInitialSetupRequired } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getServerSession();
    const setupRequired = isInitialSetupRequired();
    return NextResponse.json(
      {
        authenticated: Boolean(user),
        setupRequired,
        user,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        },
      }
    );
  } catch (err) {
    console.error('[api/auth/session] Unexpected error:', err);
    return NextResponse.json(
      {
        authenticated: false,
        setupRequired: false,
        user: null,
        error: 'Sessiyani tekshirishda server xatoligi yuz berdi.',
      },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        },
      }
    );
  }
}
