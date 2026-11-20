import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth-server';
import { markNotificationRead, updateLibrarySettings } from '@/lib/server-store';

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Avtorizatsiya talab qilinadi.' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const action = String(body?.action ?? '');

    if (action === 'update_settings') {
      const settings = await updateLibrarySettings(
        {
          schoolName: body.schoolName,
          librarianName: body.librarianName,
          defaultLoanDays: body.defaultLoanDays !== undefined ? Number(body.defaultLoanDays) : undefined,
          maxBooksPerStudent:
            body.maxBooksPerStudent !== undefined ? Number(body.maxBooksPerStudent) : undefined,
        },
        session.displayName
      );
      return NextResponse.json({ settings });
    }

    if (action === 'mark_notification_read') {
      await markNotificationRead(String(body.id ?? 'all'));
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Noma’lum amal.' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sozlamalarni saqlashda xatolik.' },
      { status: 400 }
    );
  }
}
