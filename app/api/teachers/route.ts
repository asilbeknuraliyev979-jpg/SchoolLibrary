import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth-server';
import { createTeacher, updateTeacher } from '@/lib/server-store';

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Avtorizatsiya talab qilinadi.' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const action = String(body?.action ?? '');

    if (action === 'create') {
      const teacher = await createTeacher(
        {
          fullName: String(body.fullName ?? ''),
          position: String(body.position ?? ''),
          notes: String(body.notes ?? ''),
        },
        session.displayName
      );
      return NextResponse.json({ teacher });
    }

    if (action === 'update') {
      const teacher = await updateTeacher(
        String(body.teacherId ?? ''),
        {
          fullName: body.fullName !== undefined ? String(body.fullName) : undefined,
          position: body.position !== undefined ? String(body.position) : undefined,
          status: body.status === 'active' || body.status === 'archived' ? body.status : undefined,
          notes: body.notes !== undefined ? String(body.notes) : undefined,
        },
        session.displayName
      );
      return NextResponse.json({ teacher });
    }

    if (action === 'archive') {
      const teacher = await updateTeacher(
        String(body.teacherId ?? ''),
        { status: 'archived' },
        session.displayName
      );
      return NextResponse.json({ teacher });
    }

    if (action === 'restore') {
      const teacher = await updateTeacher(
        String(body.teacherId ?? ''),
        { status: 'active' },
        session.displayName
      );
      return NextResponse.json({ teacher });
    }

    return NextResponse.json({ error: 'Noma’lum amal.' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'O‘qituvchi operatsiyasida xatolik.' },
      { status: 400 }
    );
  }
}
