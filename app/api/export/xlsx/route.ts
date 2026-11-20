import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth-server';
import { generateFullLibraryWorkbook, generateSingleTableWorkbook } from '@/lib/excel-exporter';
import { readDb } from '@/lib/server-store';
import { getTodayTashkent } from '@/lib/date-utils';

export async function GET() {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Avtorizatsiya talab qilinadi.' }, { status: 401 });
  }

  try {
    const db = readDb();
    const buffer = await generateFullLibraryWorkbook(db);
    const today = getTodayTashkent();

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="School_Library_Toliq_Hisobot_${today}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Excel fayl yaratishda xatolik.' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Avtorizatsiya talab qilinadi.' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const fileName = String(body?.fileName ?? 'School_Library_Jadval.xlsx').replace(/[^a-zA-Z0-9._-]/g, '_');
    const sheetName = String(body?.sheetName ?? 'Hisobot');
    const headers = Array.isArray(body?.headers) ? body.headers.map(String) : [];
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    const columnWidths = Array.isArray(body?.columnWidths) ? body.columnWidths.map(Number) : undefined;

    const buffer = await generateSingleTableWorkbook(sheetName, headers, rows, columnWidths);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Jadvalni Excelga yuklashda xatolik.' },
      { status: 400 }
    );
  }
}
