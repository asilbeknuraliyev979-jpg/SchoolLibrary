import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth-server';
import { generateImportReviewReport } from '@/lib/excel-exporter';
import type { ParsedRowPreview } from '@/lib/types';

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Avtorizatsiya talab qilinadi.' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const fileName = String(body?.fileName ?? 'Inventar.xlsx');
    const rows = (Array.isArray(body?.rows) ? body.rows : []) as ParsedRowPreview[];
    const buffer = await generateImportReviewReport(fileName, rows);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="Inventar_Tekshiruv_Hisoboti.xlsx"',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Hisobot yaratishda xatolik.' },
      { status: 400 }
    );
  }
}
