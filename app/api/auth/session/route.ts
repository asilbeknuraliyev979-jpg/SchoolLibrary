import { NextResponse } from 'next/server';
import { getServerSession, isInitialSetupRequired } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getServerSession();
  const setupRequired = isInitialSetupRequired();
  return NextResponse.json({
    authenticated: Boolean(user),
    setupRequired,
    user,
  });
}
