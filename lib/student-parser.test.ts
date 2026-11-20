import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {
  computeStudentRosterDiff,
  parseStudentWorkbookBuffer,
  parseStudentWorksheet,
} from './student-parser';
import type { Loan, Student } from './types';

test('parseStudentWorkbookBuffer parses attached StudentList.xlsx into exact 426 valid students', async () => {
  const filePath = path.resolve(process.cwd(), 'public/data/StudentList.xlsx');
  assert.ok(fs.existsSync(filePath), 'StudentList.xlsx should exist');
  const buf = fs.readFileSync(filePath);
  const parsed = await parseStudentWorkbookBuffer(buf);

  assert.equal(parsed.rows.length, 426);
  assert.equal(parsed.skippedInvalidRows, 0);
  // Ensure no academic year leaked into fullName
  for (const r of parsed.rows) {
    assert.doesNotMatch(r.fullName, /^\d{4}\/\d{4}$/);
    assert.ok(r.className.length >= 2);
    assert.ok(r.fullName.length >= 3);
  }
});

test('parseStudentWorksheet ignores academic year column (2026/2027) and joins split Familiya + Ism columns', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Students');
  ws.addRow(['№', 'Sinf', "O'quv yili", 'Familiya', 'Ism', 'Jinsi']);
  ws.addRow([1, '5-A', '2026/2027', 'Karimov', 'Azizbek', 'Erkak']);
  ws.addRow([2, '5-B', '2026/2027', 'Rahimova', 'Madina', 'Ayol']);
  ws.addRow([3, '5-B', '2026/2027', 'Rahimova', 'Madina', 'Ayol']); // duplicate in file
  ws.addRow([4, '6-A', '2026/2027', 'Toshmatov', 'Javohir', 'Erkak']);

  const parsed = parseStudentWorksheet(ws);
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.duplicatesInFile, 1);
  assert.deepEqual(parsed.rows, [
    { className: '5-A', fullName: 'Karimov Azizbek' },
    { className: '5-B', fullName: 'Rahimova Madina' },
    { className: '6-A', fullName: 'Toshmatov Javohir' },
  ]);
});

test('parseStudentWorksheet heuristically skips 2026/2027 column even without headers', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Raw');
  ws.addRow(['5-A', '2026/2027', 'Aliyev Sardor']);
  ws.addRow(['5-B', '2026/2027', 'Nazarova Malika']);
  ws.addRow(['6-A', '2026/2027', 'Qodirov Bekzod']);

  const parsed = parseStudentWorksheet(ws);
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.rows[0].fullName, 'Aliyev Sardor');
  assert.equal(parsed.rows[1].fullName, 'Nazarova Malika');
  assert.equal(parsed.rows[2].fullName, 'Qodirov Bekzod');
});

test('computeStudentRosterDiff keeps matches, reactivates archived, archives missing without losing active loan info', () => {
  const now = new Date().toISOString();
  const existing: Student[] = [
    {
      id: 'stu_1',
      internalStudentId: 'STU-0001',
      schoolStudentNumber: '',
      fullName: 'Karimov Azizbek',
      className: '5-A',
      registeredAt: '2026-09-01',
      status: 'active',
      notes: '',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'stu_2',
      internalStudentId: 'STU-0002',
      schoolStudentNumber: '',
      fullName: 'Old Student',
      className: '11-A',
      registeredAt: '2025-09-01',
      status: 'active',
      notes: '',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'stu_3',
      internalStudentId: 'STU-0003',
      schoolStudentNumber: '',
      fullName: 'Returning Student',
      className: '7-B',
      registeredAt: '2025-09-01',
      status: 'archived',
      notes: '',
      createdAt: now,
      updatedAt: now,
    },
  ];

  const loans: Loan[] = [
    {
      id: 'loan_1',
      borrowerType: 'student',
      studentId: 'stu_2',
      teacherId: null,
      bookTitleId: 'book_1',
      physicalCopyId: 'copy_1',
      issuedDate: '2026-10-01',
      dueDate: '2026-10-15',
      returnedDate: null,
      status: 'active',
      returnCondition: null,
      notes: '',
      createdAt: now,
      updatedAt: now,
    },
  ];

  const diff = computeStudentRosterDiff(
    existing,
    {
      rows: [
        { className: '5-A', fullName: 'Karimov Azizbek' },
        { className: '7-B', fullName: 'Returning Student' },
        { className: '5-B', fullName: 'New Student' },
      ],
      totalRowsInFile: 3,
      duplicatesInFile: 0,
      skippedInvalidRows: 0,
    },
    loans,
    'new-roster.xlsx'
  );

  assert.equal(diff.toKeepCount, 1);
  assert.equal(diff.toReactivateCount, 1);
  assert.equal(diff.toAddCount, 1);
  assert.equal(diff.toArchiveCount, 1);
  assert.equal(diff.archivedWithActiveLoansCount, 1);
  assert.equal(diff.sampleArchive[0].fullName, 'Old Student');
  assert.equal(diff.sampleArchive[0].activeLoans, 1);
});
