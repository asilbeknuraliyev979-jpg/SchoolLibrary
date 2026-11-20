import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth-server';
import {
  commitReplaceStudentsTransactional,
  createStudent,
  previewReplaceStudents,
  rollbackLastStudentImport,
  updateStudent,
} from '@/lib/server-store';
import { parseStudentWorkbookBuffer } from '@/lib/student-parser';
import type { ParsedStudentRow } from '@/lib/types';

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Avtorizatsiya talab qilinadi.' }, { status: 401 });
  }

  try {
    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file');
      const mode = String(formData.get('mode') ?? 'preview');
      if (!file || !(file instanceof File)) {
        return NextResponse.json({ error: 'XLSX fayl tanlanmagan.' }, { status: 400 });
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const parsed = await parseStudentWorkbookBuffer(buf);

      if (mode === 'commit') {
        const result = await commitReplaceStudentsTransactional(
          parsed.rows,
          file.name || 'StudentList.xlsx',
          session.displayName
        );
        return NextResponse.json(result);
      }

      const preview = previewReplaceStudents(parsed, file.name || 'StudentList.xlsx');
      return NextResponse.json({ preview });
    }

    const body = await req.json();
    const action = String(body?.action ?? '');

    if (action === 'preview_attached') {
      const filePath = path.resolve(process.cwd(), 'public/data/StudentList.xlsx');
      if (!fs.existsSync(filePath)) {
        return NextResponse.json({ error: 'Biriktirilgan StudentList.xlsx fayli topilmadi.' }, { status: 404 });
      }
      const buf = fs.readFileSync(filePath);
      const parsed = await parseStudentWorkbookBuffer(buf);
      const preview = previewReplaceStudents(parsed, 'StudentList.xlsx');
      return NextResponse.json({ preview });
    }

    if (action === 'commit_attached' || action === 'import_attached') {
      const filePath = path.resolve(process.cwd(), 'public/data/StudentList.xlsx');
      if (!fs.existsSync(filePath)) {
        return NextResponse.json({ error: 'Biriktirilgan StudentList.xlsx fayli topilmadi.' }, { status: 404 });
      }
      const buf = fs.readFileSync(filePath);
      const parsed = await parseStudentWorkbookBuffer(buf);
      const result = await commitReplaceStudentsTransactional(
        parsed.rows,
        'StudentList.xlsx',
        session.displayName
      );
      return NextResponse.json({
        ...result,
        imported: result.added + result.reactivated,
        skipped: result.kept,
      });
    }

    if (action === 'commit_replace_rows') {
      const rows = Array.isArray(body?.rows)
        ? (body.rows as Array<{ className?: string; fullName?: string }>).map(
            (r): ParsedStudentRow => ({
              className: String(r?.className ?? '').trim(),
              fullName: String(r?.fullName ?? '').trim(),
            })
          )
        : [];
      const fileName = String(body?.fileName ?? 'StudentList.xlsx').slice(0, 160);
      const result = await commitReplaceStudentsTransactional(rows, fileName, session.displayName);
      return NextResponse.json(result);
    }

    if (action === 'rollback_last') {
      const result = await rollbackLastStudentImport(session.displayName);
      return NextResponse.json(result);
    }

    if (action === 'create') {
      const student = await createStudent(
        {
          fullName: String(body.fullName ?? ''),
          className: String(body.className ?? ''),
          schoolStudentNumber: String(body.schoolStudentNumber ?? ''),
          notes: String(body.notes ?? ''),
        },
        session.displayName
      );
      return NextResponse.json({ student });
    }

    if (action === 'update') {
      const student = await updateStudent(
        String(body.studentId),
        {
          fullName: body.fullName,
          className: body.className,
          schoolStudentNumber: body.schoolStudentNumber,
          status: body.status,
          notes: body.notes,
        },
        session.displayName
      );
      return NextResponse.json({ student });
    }

    return NextResponse.json({ error: 'Noma’lum amal.' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'O‘quvchi operatsiyasida xatolik.' },
      { status: 400 }
    );
  }
}
