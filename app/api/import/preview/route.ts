import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth-server';
import { parseInventoryWorkbook } from '@/lib/inventory-parser';
import { readDb } from '@/lib/server-store';

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

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file');
      if (!file || !(file instanceof File)) {
        return NextResponse.json({ error: 'XLSX fayl tanlanmagan.' }, { status: 400 });
      }
      if (!file.name.toLowerCase().endsWith('.xlsx')) {
        return NextResponse.json({ error: 'Faqat .xlsx formatidagi Excel fayllar qo‘llab-quvvatlanadi.' }, { status: 400 });
      }
      fileName = file.name;
      buffer = Buffer.from(await file.arrayBuffer());
    } else {
      const body = await req.json();
      if (!body?.useAttachedWorkbook) {
        return NextResponse.json({ error: 'Fayl yuborilmadi.' }, { status: 400 });
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
    return NextResponse.json(preview);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Faylni tahlil qilishda xatolik yuz berdi.' },
      { status: 400 }
    );
  }
}
