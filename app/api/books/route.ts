import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth-server';
import {
  batchConfirmClearBooks,
  confirmBookRange,
  createBookManually,
  mergeBookTitles,
  updateBookMetadata,
} from '@/lib/server-store';

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Avtorizatsiya talab qilinadi.' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const action = String(body?.action ?? '');

    if (action === 'create') {
      const result = await createBookManually(
        {
          title: String(body.title ?? ''),
          author: String(body.author ?? ''),
          inventoryNumberRaw: String(body.inventoryNumberRaw ?? ''),
          publicationYear:
            body.publicationYear === null || body.publicationYear === '' || body.publicationYear === undefined
              ? null
              : Number(body.publicationYear),
          departmentCode: String(body.departmentCode ?? ''),
          priceRaw: String(body.priceRaw ?? ''),
          initialCopies: Number(body.initialCopies ?? 1),
        },
        session.displayName
      );
      return NextResponse.json(result);
    }

    if (action === 'update') {
      const book = await updateBookMetadata(
        String(body.bookId),
        {
          title: body.title,
          author: body.author,
          publicationYear:
            body.publicationYear === '' || body.publicationYear === null
              ? null
              : body.publicationYear !== undefined
                ? Number(body.publicationYear)
                : undefined,
          departmentCode: body.departmentCode,
          reviewStatus: body.reviewStatus,
          inventoryNumberRaw: body.inventoryNumberRaw,
          clearIssue: body.clearIssue,
        },
        session.displayName
      );
      return NextResponse.json({ book });
    }

    if (action === 'confirm_range' || action === 'add_copies') {
      const result = await confirmBookRange(
        String(body.bookId),
        Number(body.copyCount ?? 1),
        Array.isArray(body.inventoryLabels) ? body.inventoryLabels : null,
        session.displayName
      );
      return NextResponse.json(result);
    }

    if (action === 'batch_confirm_clear') {
      const result = await batchConfirmClearBooks(session.displayName);
      return NextResponse.json(result);
    }

    if (action === 'merge') {
      const book = await mergeBookTitles(
        String(body.primaryBookId),
        String(body.duplicateBookId),
        session.displayName
      );
      return NextResponse.json({ book });
    }

    return NextResponse.json({ error: 'Noma’lum amal.' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Kitob operatsiyasida xatolik.' },
      { status: 400 }
    );
  }
}
