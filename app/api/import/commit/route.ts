import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth-server';
import { parseInventoryWorkbook } from '@/lib/inventory-parser';
import { commitInventoryImport, readDb } from '@/lib/server-store';

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Avtorizatsiya talab qilinadi.' }, { status: 401 });
  }

  try {
    const db = readDb();
    const existingChecksums = new Map(db.importBatches.map((b) => [b.fileChecksum, b.id]));
    const existingInvNumbers = new Set(
      db.bookTitles.map((b) => b.inventoryNumberRaw.trim()).filter(Boolean)
    );

    const contentType = req.headers.get('content-type') || '';
    let buffer: Buffer;
    let fileName = 'Inventar.xlsx';
    let autoConfirmClearSingleCopies = false;

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file');
      autoConfirmClearSingleCopies = formData.get('autoConfirmClearSingleCopies') === 'true';
      if (!file || !(file instanceof File)) {
        return NextResponse.json({ error: 'XLSX fayl tanlanmagan.' }, { status: 400 });
      }
      fileName = file.name;
      buffer = Buffer.from(await file.arrayBuffer());
    } else {
      const body = await req.json();
      autoConfirmClearSingleCopies = Boolean(body?.autoConfirmClearSingleCopies);
      if (!body?.useAttachedWorkbook) {
        return NextResponse.json({ error: 'Import manbasi ko‘rsatilmagan.' }, { status: 400 });
      }
      const attachedPath = path.resolve(process.cwd(), 'public/data/Inventar.xlsx');
      if (!fs.existsSync(attachedPath)) {
        return NextResponse.json({ error: 'Biriktirilgan Inventar.xlsx fayli topilmadi.' }, { status: 404 });
      }
      buffer = fs.readFileSync(attachedPath);
      fileName = 'Inventar.xlsx';
    }

    const preview = await parseInventoryWorkbook(
      buffer,
      fileName,
      existingChecksums,
      existingInvNumbers
    );

    const result = await commitInventoryImport(preview, {
      autoConfirmClearSingleCopies,
      actorName: session.displayName,
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Importni saqlashda xatolik yuz berdi.' },
      { status: 400 }
    );
  }
}
