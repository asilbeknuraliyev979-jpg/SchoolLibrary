import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { generateFullLibraryWorkbook } from './excel-exporter';
import type { LibraryDatabase } from './types';

test('generateFullLibraryWorkbook outputs a valid 10-worksheet ExcelJS workbook with Uzbek data and formula protection', async () => {
  const now = new Date().toISOString();
  const sampleDb: LibraryDatabase = {
    settings: {
      schoolName: 'Kattaqo‘rg‘on tuman ixtisoslashtirilgan maktabi',
      librarianName: 'Nodira',
      defaultLoanDays: 14,
      maxBooksPerStudent: 5,
      timezone: 'Asia/Tashkent',
      updatedAt: now,
    },
    students: [
      {
        id: 'stu_1',
        internalStudentId: 'OQ-0001',
        schoolStudentNumber: '2026-01',
        fullName: 'Alimov Jasur',
        className: '8a1',
        registeredAt: '2026-11-19',
        status: 'active',
        notes: '',
        createdAt: now,
        updatedAt: now,
      },
    ],
    teachers: [
      {
        id: 'tch_1',
        internalTeacherId: 'TCH-0001',
        fullName: 'Karimova Dilnoza',
        position: 'Matematika o‘qituvchisi',
        registeredAt: '2026-11-19',
        status: 'active',
        notes: '',
        createdAt: now,
        updatedAt: now,
      },
    ],
    bookTitles: [
      {
        id: 'book_1',
        title: '=MaliciousTitle',
        author: 'A.Qodiriy',
        authorSplitConfidence: 'confirmed',
        originalAuthorTitle: 'Mehrobdan chayon A.Qodiriy',
        inventoryNumberRaw: '136',
        publicationYearRaw: '2019',
        publicationYear: 2019,
        departmentCode: '84',
        priceRaw: '',
        dateRecordedRaw: '4.04.2023yil',
        reviewStatus: 'confirmed',
        reviewIssues: [],
        sourceRecordId: 'src_1',
        sourceRowNumber: 200,
        isRangeRecord: false,
        rangeStart: null,
        rangeEnd: null,
        rangeConfirmed: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    physicalCopies: [
      {
        id: 'copy_1',
        bookTitleId: 'book_1',
        internalCopyCode: 'SL-00001',
        originalInventoryNumber: '136',
        barcode: 'SL-00001',
        status: 'issued',
        confirmed: true,
        sourceRecordId: 'src_1',
        activeLoanId: 'loan_1',
        notes: '',
        createdAt: now,
        updatedAt: now,
      },
    ],
    importBatches: [],
    sourceInventoryRecords: [
      {
        id: 'src_1',
        importBatchId: 'batch_1',
        sourceFileName: 'Inventar.xlsx',
        sourceSheet: 'Лист1',
        sourceRowNumber: 200,
        rawColumns: {
          col1_dateCount: '4.04.2023yil',
          col2_inventoryNumber: '136',
          col3_stockCheck: '',
          col4_authorTitle: 'Mehrobdan chayon A.Qodiriy',
          col5_publicationYear: '2019',
          col6_price: '',
          col7_summaryBookNumber: '',
          col8_department: '84',
          col9_writeOffAct: '',
          col10_note: '',
        },
        normalizedValues: {
          title: 'Mehrobdan chayon',
          author: 'A.Qodiriy',
          publicationYear: 2019,
          departmentCode: '84',
          inventoryNumberRaw: '136',
          isRange: false,
        },
        validationStatus: 'confirmed',
        issues: [],
        reviewNotes: '',
        bookTitleId: 'book_1',
        importedAt: now,
        updatedAt: now,
      },
    ],
    loans: [
      {
        id: 'loan_1',
        borrowerType: 'student',
        studentId: 'stu_1',
        teacherId: null,
        bookTitleId: 'book_1',
        physicalCopyId: 'copy_1',
        issuedDate: '2026-11-01',
        dueDate: '2026-11-10',
        returnedDate: null,
        status: 'active',
        returnCondition: null,
        notes: '',
        createdAt: now,
        updatedAt: now,
      },
    ],
    loanExtensions: [],
    inventoryIncidents: [],
    notifications: [],
    activityLogs: [
      {
        id: 'log_1',
        action: 'ISSUE_BOOK',
        entityType: 'loan',
        entityId: 'loan_1',
        summary: 'Test issue',
        actorName: 'Nodira',
        createdAt: now,
      },
    ],
  };

  const buf = await generateFullLibraryWorkbook(sampleDb);
  assert.ok(buf.length > 5000, 'Generated XLSX buffer should be non-trivial');

  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buf as any);

  const sheetNames = wb.worksheets.map((w) => w.name);
  assert.deepEqual(sheetNames, [
    'Umumiy statistika',
    'Kitoblar katalogi',
    'Asl inventar yozuvlari',
    'Fizik nusxalar',
    "O'quvchilar",
    "O'qituvchilar",
    'Berilgan kitoblar',
    'Qaytarilgan kitoblar',
    "Muddati o'tganlar",
    'Operatsiyalar tarixi',
    'Inventar tekshiruvlari',
  ]);

  // Verify formula injection neutralization
  const catalogSheet = wb.getWorksheet('Kitoblar katalogi')!;
  const titleCell = catalogSheet.getRow(2).getCell(3).value;
  assert.equal(titleCell, "'=MaliciousTitle");

  // Verify teachers sheet populated
  const teacherSheet = wb.getWorksheet("O'qituvchilar")!;
  assert.equal(teacherSheet.getRow(2).getCell(2).value, 'Karimova Dilnoza');

  // Verify original inventory columns preserved
  const rawSheet = wb.getWorksheet('Asl inventar yozuvlari')!;
  assert.equal(rawSheet.getRow(2).getCell(3).value, 200);
  assert.equal(rawSheet.getRow(2).getCell(7).value, 'Mehrobdan chayon A.Qodiriy');
});
