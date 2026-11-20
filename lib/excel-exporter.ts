import ExcelJS from 'exceljs';
import type { LibraryDatabase, ParsedRowPreview } from './types';
import { classifyLoanDeadline, formatDateTimeTashkent, formatYmdDisplay, getTodayTashkent } from './date-utils';
import { ORIGINAL_INVENTORY_HEADERS, sanitizeSpreadsheetValue } from './inventory-parser';

function styleHeaderRow(ws: ExcelJS.Worksheet, columnWidths: number[]) {
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const headerRow = ws.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'medium', color: { argb: 'FF2563EB' } },
      left: { style: 'thin', color: { argb: 'FF334155' } },
      right: { style: 'thin', color: { argb: 'FF334155' } },
    };
  });

  columnWidths.forEach((w, idx) => {
    ws.getColumn(idx + 1).width = w;
  });

  if (ws.columnCount > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(ws.rowCount, 1), column: ws.columnCount },
    };
  }
}

function addSafeRow(ws: ExcelJS.Worksheet, values: Array<string | number | null | undefined>) {
  const safe = values.map((v) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    return sanitizeSpreadsheetValue(v ?? '');
  });
  const row = ws.addRow(safe);
  row.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = {
      bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } },
    };
  });
  return row;
}

const COPY_STATUS_LABELS: Record<string, string> = {
  available: 'Mavjud',
  issued: 'Berilgan',
  damaged: 'Shikastlangan',
  lost: "Yo'qolgan",
  archived: 'Arxivlangan',
};

const REVIEW_STATUS_LABELS: Record<string, string> = {
  confirmed: 'Tasdiqlangan',
  needs_review: 'Tekshiruv kerak',
  archived: 'Arxivlangan',
};

const VALIDATION_STATUS_LABELS: Record<string, string> = {
  confirmed: 'Tasdiqlangan',
  needs_review: 'Tekshiruv talab qiladi',
  skipped_subtotal: "O'tkazib yuborilgan (Jami qatori)",
  skipped_date_only: "O'tkazib yuborilgan (Faqat sana)",
  skipped_empty: "O'tkazib yuborilgan (Bo'sh)",
  error: 'Xatolik',
};

const CONDITION_LABELS: Record<string, string> = {
  good: 'Yaxshi holatda',
  damaged: 'Shikastlangan',
  lost: "Yo'qolgan",
};

/**
 * Generates the complete 11-worksheet School Library ExcelJS workbook (including Teachers).
 */
export async function generateFullLibraryWorkbook(db: LibraryDatabase): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'School Library — Kattaqo‘rg‘on tuman ixtisoslashtirilgan maktabi';
  wb.created = new Date();

  const today = getTodayTashkent();

  const bookMap = new Map(db.bookTitles.map((b) => [b.id, b]));
  const studentMap = new Map(db.students.map((s) => [s.id, s]));
  const teacherMap = new Map((db.teachers ?? []).map((t) => [t.id, t]));
  const copyMap = new Map(db.physicalCopies.map((c) => [c.id, c]));

  const resolveBorrower = (loan: LibraryDatabase['loans'][number]) => {
    if (loan.borrowerType === 'teacher') {
      const t = loan.teacherId ? teacherMap.get(loan.teacherId) : undefined;
      return {
        role: "O'qituvchi",
        name: t?.fullName ?? '—',
        group: t?.position ?? "O'qituvchi",
      };
    }
    const s = loan.studentId ? studentMap.get(loan.studentId) : undefined;
    return {
      role: "O'quvchi",
      name: s?.fullName ?? '—',
      group: s?.className ?? '—',
    };
  };

  const confirmedCopies = db.physicalCopies.filter((c) => c.confirmed && c.status !== 'archived');
  const availableCopies = confirmedCopies.filter((c) => c.status === 'available');
  const issuedCopies = confirmedCopies.filter((c) => c.status === 'issued');
  const activeLoans = db.loans.filter((l) => l.status === 'active');
  const returnedLoans = db.loans.filter((l) => l.status === 'returned');
  const dueTodayLoans = activeLoans.filter((l) => classifyLoanDeadline(l, today).bucket === 'due_today');
  const overdueLoans = activeLoans.filter((l) => classifyLoanDeadline(l, today).bucket === 'overdue');
  const activeBorrowers = new Set(
    activeLoans.map((l) =>
      l.borrowerType === 'teacher' ? `tch:${l.teacherId ?? ''}` : `stu:${l.studentId ?? ''}`
    )
  );
  const booksNeedingReview = db.bookTitles.filter((b) => b.reviewStatus === 'needs_review');

  // 1. Umumiy statistika
  const ws1 = wb.addWorksheet('Umumiy statistika');
  ws1.addRow(["Ko'rsatkich", 'Qiymat', 'Izoh']);
  const statsRows: Array<[string, number | string, string]> = [
    ['Maktab nomi', db.settings.schoolName, 'Rasmiy muassasa nomi'],
    ['Kutubxonachi', db.settings.librarianName, 'Mas’ul xodim'],
    ['Hisobot sanasi (Asia/Tashkent)', formatYmdDisplay(today), 'Joriy hisobot sanasi'],
    ['Jami katalog yozuvlari (nomlar)', db.bookTitles.filter((b) => b.reviewStatus !== 'archived').length, 'Inventar.xlsx va qo‘lda kiritilgan'],
    ['Tasdiqlangan fizik nusxalar', confirmedCopies.length, 'Faqat kutubxonachi tasdiqlagan nusxalar'],
    ['Hozir mavjud nusxalar', availableCopies.length, 'Berish uchun tayyor'],
    ['Berilgan kitoblar', issuedCopies.length, 'O‘quvchi va o‘qituvchilar qo‘lida'],
    ['Bugun qaytarilishi kerak', dueTodayLoans.length, formatYmdDisplay(today)],
    ["Muddati o'tgan kitoblar", overdueLoans.length, 'Zudlik bilan nazorat talab qiladi'],
    ['Faol kitob olgan foydalanuvchilar', activeBorrowers.size, 'Kamida 1 ta faol kitobi bor'],
    ["Jami faol o'quvchilar", db.students.filter((s) => s.status === 'active').length, 'O‘quvchilar bazasi'],
    ["Jami faol o'qituvchilar", (db.teachers ?? []).filter((t) => t.status === 'active').length, 'O‘qituvchilar bazasi'],
    ['Tekshiruv talab qiladigan inventar yozuvlari', booksNeedingReview.length, 'Diapazon, takroriy raqam yoki yil xatoligi'],
    ['Jami qaytarilgan kitoblar', returnedLoans.length, 'Yakunlangan operatsiyalar'],
    ['Shikastlangan / yo‘qolgan hodisalar', db.inventoryIncidents.length, 'Inventar hodisalari'],
  ];
  statsRows.forEach((r) => addSafeRow(ws1, r));
  styleHeaderRow(ws1, [42, 24, 46]);

  // 2. Kitoblar katalogi
  const ws2 = wb.addWorksheet('Kitoblar katalogi');
  ws2.addRow([
    'Ichki ID',
    'Inventar raqami (asl)',
    'Kitob nomi',
    'Muallif',
    'Nashr yili',
    "Bo'lim kodi",
    'Tasdiqlangan nusxalar',
    'Mavjud nusxalar',
    'Berilgan nusxalar',
    'Tekshiruv holati',
    'Manba qatori',
  ]);
  for (const b of db.bookTitles) {
    const copies = db.physicalCopies.filter((c) => c.bookTitleId === b.id && c.confirmed && c.status !== 'archived');
    const avail = copies.filter((c) => c.status === 'available').length;
    const iss = copies.filter((c) => c.status === 'issued').length;
    addSafeRow(ws2, [
      b.id,
      b.inventoryNumberRaw || '—',
      b.title,
      b.author || '—',
      b.publicationYear ?? (b.publicationYearRaw || '—'),
      b.departmentCode || '—',
      copies.length,
      avail,
      iss,
      REVIEW_STATUS_LABELS[b.reviewStatus] ?? b.reviewStatus,
      b.sourceRowNumber ?? '—',
    ]);
  }
  styleHeaderRow(ws2, [18, 18, 38, 26, 12, 12, 18, 16, 16, 18, 14]);

  // 3. Asl inventar yozuvlari (preserving all 10 original Inventar.xlsx columns!)
  const ws3 = wb.addWorksheet('Asl inventar yozuvlari');
  ws3.addRow([
    'Manba fayl',
    'Varaq',
    'Manba qatori',
    ...ORIGINAL_INVENTORY_HEADERS,
    'Tekshiruv holati',
    'Izoh',
  ]);
  for (const rec of db.sourceInventoryRecords) {
    addSafeRow(ws3, [
      rec.sourceFileName,
      rec.sourceSheet,
      rec.sourceRowNumber,
      rec.rawColumns.col1_dateCount,
      rec.rawColumns.col2_inventoryNumber,
      rec.rawColumns.col3_stockCheck,
      rec.rawColumns.col4_authorTitle,
      rec.rawColumns.col5_publicationYear,
      rec.rawColumns.col6_price,
      rec.rawColumns.col7_summaryBookNumber,
      rec.rawColumns.col8_department,
      rec.rawColumns.col9_writeOffAct,
      rec.rawColumns.col10_note,
      VALIDATION_STATUS_LABELS[rec.validationStatus] ?? rec.validationStatus,
      rec.reviewNotes,
    ]);
  }
  styleHeaderRow(ws3, [18, 10, 12, 18, 16, 16, 40, 12, 12, 16, 12, 14, 16, 22, 36]);

  // 4. Fizik nusxalar
  const ws4 = wb.addWorksheet('Fizik nusxalar');
  ws4.addRow([
    'Nusxa ichki kodi',
    'Shtrix-kod',
    'Asl inventar raqami',
    'Kitob nomi',
    'Muallif',
    'Holat',
    'Tasdiqlangan',
    'Izoh',
  ]);
  for (const c of db.physicalCopies) {
    const b = bookMap.get(c.bookTitleId);
    addSafeRow(ws4, [
      c.internalCopyCode,
      c.barcode || '—',
      c.originalInventoryNumber || '—',
      b?.title ?? '—',
      b?.author ?? '—',
      COPY_STATUS_LABELS[c.status] ?? c.status,
      c.confirmed ? 'Ha' : "Yo'q",
      c.notes || '',
    ]);
  }
  styleHeaderRow(ws4, [20, 18, 18, 36, 24, 16, 14, 28]);

  // 5. O'quvchilar
  const ws5 = wb.addWorksheet("O'quvchilar");
  ws5.addRow([
    'Sinf',
    'Familiya va ism',
    'Holat',
    'Faol kitoblar',
    'Jami olgan kitoblar',
  ]);
  for (const s of db.students) {
    const sLoans = db.loans.filter((l) => (l.borrowerType ?? 'student') === 'student' && l.studentId === s.id);
    const sActive = sLoans.filter((l) => l.status === 'active').length;
    addSafeRow(ws5, [
      s.className,
      s.fullName,
      s.status === 'active' ? 'Faol' : 'Arxivlangan',
      sActive,
      sLoans.length,
    ]);
  }
  styleHeaderRow(ws5, [12, 36, 16, 14, 18]);

  // 6. O'qituvchilar
  const wsTeachers = wb.addWorksheet("O'qituvchilar");
  wsTeachers.addRow([
    'Ichki ID',
    'F.I.Sh.',
    'Lavozimi',
    'Holat',
    'Faol kitoblar',
    'Jami olgan kitoblar',
  ]);
  for (const t of db.teachers ?? []) {
    const tLoans = db.loans.filter((l) => l.borrowerType === 'teacher' && l.teacherId === t.id);
    const tActive = tLoans.filter((l) => l.status === 'active').length;
    addSafeRow(wsTeachers, [
      t.internalTeacherId,
      t.fullName,
      t.position,
      t.status === 'active' ? 'Faol' : 'Arxivlangan',
      tActive,
      tLoans.length,
    ]);
  }
  styleHeaderRow(wsTeachers, [14, 34, 28, 14, 14, 18]);

  // 7. Berilgan kitoblar
  const ws6 = wb.addWorksheet('Berilgan kitoblar');
  ws6.addRow([
    'ID',
    'Turi',
    'Sinf / Lavozim',
    'F.I.Sh.',
    'Kitob nomi',
    'Nusxa kodi',
    'Inventar raqami',
    'Berilgan sana',
    'Qaytarish sanasi',
    'Qolgan / Kechikkan kun',
    'Holat',
  ]);
  for (const l of activeLoans) {
    const borrower = resolveBorrower(l);
    const b = bookMap.get(l.bookTitleId);
    const c = copyMap.get(l.physicalCopyId);
    const { bucket, deltaDays } = classifyLoanDeadline(l, today);
    const statusText =
      bucket === 'overdue'
        ? "Muddati o'tgan"
        : bucket === 'due_today'
          ? 'Bugun qaytariladi'
          : bucket === 'due_tomorrow' || bucket === 'due_soon_3d'
            ? 'Yaqinlashmoqda'
            : 'Jarayonda';
    addSafeRow(ws6, [
      l.id,
      borrower.role,
      borrower.group,
      borrower.name,
      b?.title ?? '—',
      c?.internalCopyCode ?? '—',
      c?.originalInventoryNumber ?? '—',
      formatYmdDisplay(l.issuedDate),
      formatYmdDisplay(l.dueDate),
      deltaDays,
      statusText,
    ]);
  }
  styleHeaderRow(ws6, [16, 14, 22, 30, 34, 16, 16, 14, 16, 20, 18]);

  // 8. Qaytarilgan kitoblar
  const ws7 = wb.addWorksheet('Qaytarilgan kitoblar');
  ws7.addRow([
    'ID',
    'Turi',
    'Sinf / Lavozim',
    'F.I.Sh.',
    'Kitob nomi',
    'Nusxa kodi',
    'Berilgan sana',
    'Kutilgan qaytarish sanasi',
    'Haqiqiy qaytarish sanasi',
    'Qaytarish holati',
    'Izoh',
  ]);
  for (const l of returnedLoans) {
    const borrower = resolveBorrower(l);
    const b = bookMap.get(l.bookTitleId);
    const c = copyMap.get(l.physicalCopyId);
    addSafeRow(ws7, [
      l.id,
      borrower.role,
      borrower.group,
      borrower.name,
      b?.title ?? '—',
      c?.internalCopyCode ?? '—',
      formatYmdDisplay(l.issuedDate),
      formatYmdDisplay(l.dueDate),
      formatYmdDisplay(l.returnedDate),
      l.returnCondition ? (CONDITION_LABELS[l.returnCondition] ?? l.returnCondition) : '—',
      l.notes || '',
    ]);
  }
  styleHeaderRow(ws7, [16, 14, 22, 30, 34, 16, 14, 20, 20, 18, 28]);

  // 9. Muddati o'tganlar
  const ws8 = wb.addWorksheet("Muddati o'tganlar");
  ws8.addRow([
    'Turi',
    'Sinf / Lavozim',
    'F.I.Sh.',
    'Kitob nomi',
    'Nusxa kodi',
    'Inventar raqami',
    'Berilgan sana',
    'Qaytarish sanasi',
    'Kechikkan kunlar',
  ]);
  for (const l of overdueLoans) {
    const borrower = resolveBorrower(l);
    const b = bookMap.get(l.bookTitleId);
    const c = copyMap.get(l.physicalCopyId);
    const { deltaDays } = classifyLoanDeadline(l, today);
    addSafeRow(ws8, [
      borrower.role,
      borrower.group,
      borrower.name,
      b?.title ?? '—',
      c?.internalCopyCode ?? '—',
      c?.originalInventoryNumber ?? '—',
      formatYmdDisplay(l.issuedDate),
      formatYmdDisplay(l.dueDate),
      Math.abs(deltaDays),
    ]);
  }
  styleHeaderRow(ws8, [14, 22, 30, 34, 16, 16, 14, 16, 16]);

  // 9. Operatsiyalar tarixi
  const ws9 = wb.addWorksheet('Operatsiyalar tarixi');
  ws9.addRow(['Sana va vaqt', 'Amal', "Bo'lim", 'Obyekt ID', 'Tavsif', 'Mas’ul']);
  for (const log of db.activityLogs) {
    addSafeRow(ws9, [
      formatDateTimeTashkent(log.createdAt),
      log.action,
      log.entityType,
      log.entityId,
      log.summary,
      log.actorName,
    ]);
  }
  styleHeaderRow(ws9, [20, 22, 16, 18, 52, 18]);

  // 10. Inventar tekshiruvlari
  const ws10 = wb.addWorksheet('Inventar tekshiruvlari');
  ws10.addRow([
    'Manba qatori',
    'Asl inventar raqami',
    'Asl matn (Muallif va kitob nomi)',
    'Asl nashr yili',
    "Bo'lim kodi",
    'Muammolar',
    'Tekshiruv holati',
    'Izoh',
  ]);
  for (const b of db.bookTitles.filter((x) => x.reviewStatus === 'needs_review' || x.reviewIssues.length > 0)) {
    addSafeRow(ws10, [
      b.sourceRowNumber ?? '—',
      b.inventoryNumberRaw || '—',
      b.originalAuthorTitle || b.title,
      b.publicationYearRaw || '—',
      b.departmentCode || '—',
      b.reviewIssues.join(', '),
      REVIEW_STATUS_LABELS[b.reviewStatus] ?? b.reviewStatus,
      b.isRangeRecord && !b.rangeConfirmed ? 'Diapazon tasdiqlanmagan' : '',
    ]);
  }
  styleHeaderRow(ws10, [14, 18, 40, 14, 12, 32, 18, 28]);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/**
 * Exports any single table dataset to a styled ExcelJS .xlsx buffer.
 */
export async function generateSingleTableWorkbook(
  sheetName: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
  columnWidths?: number[]
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'School Library';
  wb.created = new Date();
  const safeSheetName = sheetName.slice(0, 31).replace(/[\\/*?:[\]]/g, '');
  const ws = wb.addWorksheet(safeSheetName || 'Hisobot');
  ws.addRow(headers);
  for (const r of rows) {
    addSafeRow(ws, r);
  }
  styleHeaderRow(ws, columnWidths ?? headers.map(() => 22));
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/**
 * Generates an ExcelJS error/review report from an import preview.
 */
export async function generateImportReviewReport(
  fileName: string,
  rows: ParsedRowPreview[]
): Promise<Buffer> {
  const issueRows = rows.filter(
    (r) => r.validationStatus !== 'confirmed' || r.issues.length > 0
  );
  return generateSingleTableWorkbook(
    'Import tekshiruv hisoboti',
    [
      'Manba qatori',
      'Holat',
      'Inventar raqami (asl)',
      'Muallif va kitob nomi (asl)',
      'Nashr yili (asl)',
      "Bo'limi",
      'Aniqlangan muammolar',
      'Izoh',
    ],
    issueRows.map((r) => [
      r.sourceRowNumber,
      VALIDATION_STATUS_LABELS[r.validationStatus] ?? r.validationStatus,
      r.rawColumns.col2_inventoryNumber || '—',
      r.rawColumns.col4_authorTitle || '—',
      r.rawColumns.col5_publicationYear || '—',
      r.rawColumns.col8_department || '—',
      r.issues.join(', ') || '—',
      r.reviewNotes || `Fayl: ${fileName}`,
    ]),
    [14, 24, 18, 40, 14, 12, 28, 42]
  );
}
