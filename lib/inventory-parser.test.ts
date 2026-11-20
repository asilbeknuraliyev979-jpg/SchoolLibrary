import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  detectInventoryRange,
  validatePublicationYear,
  suggestTitleAuthorSplit,
  sanitizeSpreadsheetValue,
  parseInventoryWorkbook,
} from './inventory-parser';
import {
  addDaysYmd,
  diffDaysYmd,
  classifyLoanDeadline,
  isValidYmd,
} from './date-utils';

test('detectInventoryRange identifies ranges without fabricating counts', () => {
  assert.deepEqual(detectInventoryRange('1-72'), { isRange: true, start: 1, end: 72 });
  assert.deepEqual(detectInventoryRange('63-72'), { isRange: true, start: 63, end: 72 });
  assert.deepEqual(detectInventoryRange('148'), { isRange: false, start: null, end: null });
  assert.deepEqual(detectInventoryRange(''), { isRange: false, start: null, end: null });
});

test('validatePublicationYear flags suspicious years like 20019 and 2028', () => {
  assert.deepEqual(validatePublicationYear('20019', 2026), { year: null, isInvalid: true, isMissing: false });
  assert.deepEqual(validatePublicationYear('2028', 2026), { year: null, isInvalid: true, isMissing: false });
  assert.deepEqual(validatePublicationYear('2022', 2026), { year: 2022, isInvalid: false, isMissing: false });
  assert.deepEqual(validatePublicationYear('', 2026), { year: null, isInvalid: false, isMissing: true });
});

test('suggestTitleAuthorSplit handles clear and glued author strings safely', () => {
  const clear = suggestTitleAuthorSplit('Ona tili K.M.Movlonova');
  assert.equal(clear.title, 'Ona tili');
  assert.equal(clear.author, 'K.M.Movlonova');
  assert.equal(clear.confidence, 'high');

  const glued = suggestTitleAuthorSplit('Jahon tarixiM.Lafasov');
  assert.equal(glued.title, 'Jahon tarixi');
  assert.equal(glued.author, 'M.Lafasov');
  assert.equal(glued.confidence, 'uncertain');

  const noAuthor = suggestTitleAuthorSplit('Temur tuziklari');
  assert.equal(noAuthor.title, 'Temur tuziklari');
  assert.equal(noAuthor.author, '');
  assert.equal(noAuthor.confidence, 'none');
});

test('sanitizeSpreadsheetValue neutralizes formula injection but preserves normal numbers', () => {
  assert.equal(sanitizeSpreadsheetValue('=CMD("calc")'), '\'=CMD("calc")');
  assert.equal(sanitizeSpreadsheetValue('+SUM(A1:A2)'), '\'+SUM(A1:A2)');
  assert.equal(sanitizeSpreadsheetValue('@HYPERLINK("x")'), '\'@HYPERLINK("x")');
  assert.equal(sanitizeSpreadsheetValue('2022'), '2022');
  assert.equal(sanitizeSpreadsheetValue('83.3'), '83.3');
});

test('date-utils performs exact date-only comparisons for Asia/Tashkent deadlines', () => {
  assert.equal(addDaysYmd('2026-11-19', 14), '2026-12-03');
  assert.equal(diffDaysYmd('2026-11-19', '2026-11-19'), 0);
  assert.equal(diffDaysYmd('2026-11-18', '2026-11-19'), -1);
  assert.equal(diffDaysYmd('2026-11-22', '2026-11-19'), 3);
  assert.equal(isValidYmd('2026-02-29'), false);
  assert.equal(isValidYmd('2026-11-19'), true);

  assert.equal(classifyLoanDeadline({ status: 'active', dueDate: '2026-11-18' }, '2026-11-19').bucket, 'overdue');
  assert.equal(classifyLoanDeadline({ status: 'active', dueDate: '2026-11-19' }, '2026-11-19').bucket, 'due_today');
  assert.equal(classifyLoanDeadline({ status: 'active', dueDate: '2026-11-20' }, '2026-11-19').bucket, 'due_tomorrow');
  assert.equal(classifyLoanDeadline({ status: 'active', dueDate: '2026-11-22' }, '2026-11-19').bucket, 'due_soon_3d');
  assert.equal(classifyLoanDeadline({ status: 'active', dueDate: '2026-11-28' }, '2026-11-19').bucket, 'in_progress');
  assert.equal(classifyLoanDeadline({ status: 'returned', dueDate: '2026-11-01' }, '2026-11-19').bucket, 'returned');
});

test('parseInventoryWorkbook parses the real attached Inventar.xlsx with full fidelity', async () => {
  const xlsxPath = path.resolve('public/data/Inventar.xlsx');
  const buf = fs.readFileSync(xlsxPath);
  const preview = await parseInventoryWorkbook(buf, 'Inventar.xlsx');

  assert.equal(preview.sheetName, 'Лист1');
  assert.equal(preview.totalRowsScanned, 1485);
  assert.ok(preview.bookRowsCount >= 1450 && preview.bookRowsCount <= 1470, `Expected ~1460 book rows, got ${preview.bookRowsCount}`);
  assert.equal(preview.skippedSubtotalCount, 1);
  assert.ok(preview.skippedDateOnlyCount >= 20, `Expected date-only rows, got ${preview.skippedDateOnlyCount}`);
  assert.ok(preview.rangeRecordCount >= 50, `Expected range records, got ${preview.rangeRecordCount}`);
  assert.equal(preview.invalidYearCount, 2, 'Expected exactly 2 invalid years (20019 and 2028)');
  assert.ok(preview.missingInventoryCount >= 20, 'Expected missing inventory number rows');
  assert.ok(preview.duplicateInventoryCount > 0, 'Expected duplicate inventory warnings');

  // Verify idempotency detection via checksum
  const existingMap = new Map([[preview.fileChecksum, 'batch_existing']]);
  const secondPreview = await parseInventoryWorkbook(buf, 'Inventar.xlsx', existingMap);
  assert.equal(secondPreview.alreadyImported, true);
  assert.equal(secondPreview.existingBatchId, 'batch_existing');
});
