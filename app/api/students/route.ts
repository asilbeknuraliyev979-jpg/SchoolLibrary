import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth-server';
import { bulkImportStudents, createStudent, updateStudent } from '@/lib/server-store';
import { cellToString } from '@/lib/inventory-parser';

function parseStudentWorksheet(ws: ExcelJS.Worksheet): Array<{ fullName: string; className: string; schoolStudentNumber?: string }> {
  let classCol = 1;
  let nameCol = 2;
  let numCol = -1;
  let startRow = 2;

  // Detect header row & column positions automatically
  for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const vals: string[] = [];
    for (let c = 1; c <= Math.min(8, ws.columnCount || 5); c++) {
      vals.push(cellToString(row.getCell(c).value).toLowerCase());
    }
    const foundClass = vals.findIndex((v) => v.includes('sinf') || v.includes('class'));
    const foundName = vals.findIndex(
      (v) => v.includes('familiya') || v.includes('ism') || v.includes('f.i') || v.includes('name') || v.includes('o‘quvchi') || v.includes("o'quvchi")
    );
    const foundNum = vals.findIndex((v) => v.includes('raqam') || v.includes('id') || v.includes('guvoh'));
    if (foundClass !== -1 && foundName !== -1) {
      classCol = foundClass + 1;
      nameCol = foundName + 1;
      numCol = foundNum !== -1 ? foundNum + 1 : -1;
      startRow = r + 1;
      break;
    }
  }

  const parsedRows: Array<{ fullName: string; className: string; schoolStudentNumber?: string }> = [];
  const classPattern = /^\d{1,2}\s*[-–]?\s*[A-Za-zА-Яа-яЁё0-9]+$/;

  for (let r = startRow; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    let classVal = cellToString(row.getCell(classCol).value);
    let nameVal = cellToString(row.getCell(nameCol).value);
    const numVal = numCol > 0 ? cellToString(row.getCell(numCol).value) : '';

    // Fallback: if header wasn't matched and col 2 looks like a class while col 1 is a full name, swap
    if (classVal && nameVal && !classPattern.test(classVal) && classPattern.test(nameVal)) {
      const tmp = classVal;
      classVal = nameVal;
      nameVal = tmp;
    }

    if (
      classVal.toLowerCase() === 'sinf' ||
      nameVal.toLowerCase().includes('familiya va ism')
    ) {
      continue;
    }

    if (nameVal && classVal) {
      parsedRows.push({
        fullName: nameVal,
        className: classVal,
        schoolStudentNumber: numVal,
      });
    }
  }
  return parsedRows;
}

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
      if (!file || !(file instanceof File)) {
        return NextResponse.json({ error: 'XLSX fayl tanlanmagan.' }, { status: 400 });
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      const ws = wb.worksheets[0];
      if (!ws) {
        return NextResponse.json({ error: 'Excel varag‘i topilmadi.' }, { status: 400 });
      }

      const parsedRows = parseStudentWorksheet(ws);
      const res = await bulkImportStudents(parsedRows, session.displayName);
      return NextResponse.json(res);
    }

    const body = await req.json();
    const action = String(body?.action ?? '');

    if (action === 'import_attached') {
      const filePath = path.resolve(process.cwd(), 'public/data/StudentList.xlsx');
      if (!fs.existsSync(filePath)) {
        return NextResponse.json({ error: 'Biriktirilgan StudentList.xlsx fayli topilmadi.' }, { status: 404 });
      }
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(filePath);
      const ws = wb.worksheets[0];
      if (!ws) {
        return NextResponse.json({ error: 'Excel varag‘i topilmadi.' }, { status: 400 });
      }
      const parsedRows = parseStudentWorksheet(ws);
      const res = await bulkImportStudents(parsedRows, session.displayName);
      return NextResponse.json(res);
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
