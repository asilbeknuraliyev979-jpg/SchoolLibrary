import ExcelJS from 'exceljs';
import { cellToString } from './inventory-parser';
import type { Loan, ParsedStudentRow, Student, StudentReplacePreview } from './types';

const CLASS_PATTERN = /^\d{1,2}\s*[-–]?\s*[A-Za-zА-Яа-яЁё0-9]{1,4}$/;
const ACADEMIC_YEAR_PATTERN = /^\d{4}\s*[-/]\s*\d{4}$/;
const DATE_PATTERN = /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$/;
const PURE_NUMBER_PATTERN = /^\d+([.,]\d+)?$/;

export function normalizeStudentKey(className: string, fullName: string): string {
  const cls = className.trim().replace(/\s+/g, '').toLowerCase();
  const name = fullName
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[’`‘ʼ]/g, "'")
    .toLowerCase();
  return `${cls}::${name}`;
}

export function normalizeNameOnlyKey(fullName: string): string {
  return fullName
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[’`‘ʼ]/g, "'")
    .toLowerCase();
}

export function isAcademicYearOrNonName(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (ACADEMIC_YEAR_PATTERN.test(v)) return true;
  if (DATE_PATTERN.test(v)) return true;
  if (PURE_NUMBER_PATTERN.test(v)) return true;
  if (CLASS_PATTERN.test(v)) return true;
  // Must contain at least two letters (Latin or Cyrillic)
  const letters = v.match(/[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ]/g);
  if (!letters || letters.length < 2) return true;
  // Ignore common header/gender/label strings
  const lower = v.toLowerCase();
  if (
    [
      'sinf',
      'class',
      'familiya',
      'ism',
      'familiya va ism',
      'f.i.sh',
      'f.i.sh.',
      'fish',
      'o‘quvchi',
      "o'quvchi",
      'oquvchi',
      'o‘quv yili',
      "o'quv yili",
      'yil',
      'jami',
      'erkak',
      'ayol',
      'o‘g‘il',
      'qiz',
      'male',
      'female',
      'm',
      'f',
    ].includes(lower)
  ) {
    return true;
  }
  return false;
}

export function isValidClassLabel(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 16) return false;
  if (ACADEMIC_YEAR_PATTERN.test(v) || DATE_PATTERN.test(v)) return false;
  return CLASS_PATTERN.test(v);
}

function cleanClassLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function cleanNameValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function isExcludedHeader(h: string): boolean {
  const lower = h.toLowerCase();
  return (
    lower.includes('yil') ||
    lower.includes('year') ||
    lower.includes('sana') ||
    lower.includes('date') ||
    lower.includes('tug‘il') ||
    lower.includes("tug'il") ||
    lower.includes('birth') ||
    lower.includes('jins') ||
    lower.includes('gender') ||
    lower.includes('telefon') ||
    lower.includes('phone') ||
    lower.includes('manzil') ||
    lower.includes('address') ||
    lower.includes('id') ||
    lower.includes('raqam') ||
    lower === '№' ||
    lower === 't/r' ||
    lower === '#'
  );
}

export interface ParsedStudentWorkbookResult {
  rows: ParsedStudentRow[];
  totalRowsInFile: number;
  duplicatesInFile: number;
  skippedInvalidRows: number;
}

/**
 * Parses an Excel worksheet containing students and extracts ONLY className + fullName.
 * Handles:
 * - Standard 2-column format: [Sinf, Familiya va ism]
 * - Multi-column school exports with extra columns like [№, Sinf, O‘quv yili (2026/2027), Familiya, Ism, Otasining ismi, ...]
 * - Split Familiya + Ism columns (automatically joined with a single space)
 * - Missing headers (statistical column detection across sample rows)
 * Strictly rejects academic-year values (e.g. 2026/2027) from ever becoming student names.
 */
export function parseStudentWorksheet(ws: ExcelJS.Worksheet): ParsedStudentWorkbookResult {
  const maxCols = Math.min(20, Math.max(ws.columnCount || 0, 10));

  let classCol = -1;
  let fullNameCol = -1;
  let surnameCol = -1;
  let firstNameCol = -1;
  let startRow = 1;

  // Step 1: Scan first 10 rows for explicit headers
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const headers: string[] = [];
    for (let c = 1; c <= maxCols; c++) {
      headers.push(cellToString(row.getCell(c).value).toLowerCase());
    }

    let cCol = -1;
    let fnCol = -1;
    let snCol = -1;
    let gnCol = -1;

    headers.forEach((h, idx) => {
      if (!h) return;
      const colNum = idx + 1;

      if (cCol === -1 && (h.includes('sinf') || h.includes('class') || h.includes('класс') || h.includes('guruh'))) {
        cCol = colNum;
        return;
      }

      if (isExcludedHeader(h)) return;

      // Combined full name column
      if (
        h.includes('familiya va ism') ||
        h.includes('ism va familiya') ||
        h.includes('f.i.sh') ||
        h.includes('f.i.o') ||
        h.includes('fish') ||
        h.includes('full name') ||
        h.includes('fullname') ||
        h.includes('фио') ||
        h.includes('ф.и.о') ||
        (h.includes('o‘quvchi') && !h.includes('yili')) ||
        (h.includes("o'quvchi") && !h.includes('yili')) ||
        (h.includes('oquvchi') && !h.includes('yili')) ||
        h === 'student' ||
        h === 'student name'
      ) {
        if (fnCol === -1) fnCol = colNum;
        return;
      }

      // Split Surname column
      if (
        snCol === -1 &&
        (h.includes('familiya') ||
          h.includes('familya') ||
          h.includes('surname') ||
          h.includes('last name') ||
          h.includes('lastname') ||
          h.includes('фамилия'))
      ) {
        snCol = colNum;
        return;
      }

      // Split First Name column (avoid matching "otasining ismi" as primary first name)
      if (
        gnCol === -1 &&
        !h.includes('ota') &&
        !h.includes('father') &&
        !h.includes('middle') &&
        !h.includes('sharif') &&
        (h === 'ism' ||
          h === 'ismi' ||
          h.includes('first name') ||
          h.includes('firstname') ||
          h.includes('имя') ||
          h === 'name')
      ) {
        gnCol = colNum;
      }
    });

    const hasNameHeader = fnCol !== -1 || snCol !== -1 || gnCol !== -1;
    if (cCol !== -1 && hasNameHeader) {
      classCol = cCol;
      fullNameCol = fnCol;
      surnameCol = snCol;
      firstNameCol = gnCol;
      startRow = r + 1;
      break;
    }
  }

  // Step 2: Heuristic column scoring if headers were incomplete or missing
  if (classCol === -1 || (fullNameCol === -1 && surnameCol === -1 && firstNameCol === -1)) {
    const sampleEnd = Math.min(ws.rowCount, startRow + 40);
    const colStats: Array<{
      col: number;
      nonEmpty: number;
      classHits: number;
      yearHits: number;
      nameHits: number;
      multiWordNameHits: number;
    }> = [];

    for (let c = 1; c <= maxCols; c++) {
      let nonEmpty = 0;
      let classHits = 0;
      let yearHits = 0;
      let nameHits = 0;
      let multiWordNameHits = 0;

      for (let r = startRow; r <= sampleEnd; r++) {
        const val = cellToString(ws.getRow(r).getCell(c).value);
        if (!val) continue;
        nonEmpty++;
        if (ACADEMIC_YEAR_PATTERN.test(val) || DATE_PATTERN.test(val)) {
          yearHits++;
          continue;
        }
        if (isValidClassLabel(val)) {
          classHits++;
          continue;
        }
        if (!isAcademicYearOrNonName(val)) {
          nameHits++;
          if (val.trim().includes(' ')) {
            multiWordNameHits++;
          }
        }
      }

      if (nonEmpty > 0) {
        colStats.push({ col: c, nonEmpty, classHits, yearHits, nameHits, multiWordNameHits });
      }
    }

    if (classCol === -1) {
      const bestClass = colStats
        .filter((s) => s.classHits >= Math.max(1, Math.floor(s.nonEmpty * 0.4)))
        .sort((a, b) => b.classHits - a.classHits)[0];
      if (bestClass) classCol = bestClass.col;
    }

    if (fullNameCol === -1 && surnameCol === -1 && firstNameCol === -1) {
      const nameCandidates = colStats
        .filter(
          (s) =>
            s.col !== classCol &&
            s.yearHits < s.nonEmpty * 0.3 &&
            s.nameHits >= Math.max(1, Math.floor(s.nonEmpty * 0.5))
        )
        .sort((a, b) => b.multiWordNameHits - a.multiWordNameHits || b.nameHits - a.nameHits);

      if (nameCandidates.length > 0) {
        const best = nameCandidates[0];
        // If best column has multi-word names, use it as combined fullName
        if (best.multiWordNameHits >= Math.max(1, Math.floor(best.nameHits * 0.4))) {
          fullNameCol = best.col;
        } else if (nameCandidates.length >= 2) {
          // Two adjacent single-word name columns (Familiya + Ism)
          const sortedByCol = nameCandidates.slice(0, 2).sort((a, b) => a.col - b.col);
          surnameCol = sortedByCol[0].col;
          firstNameCol = sortedByCol[1].col;
        } else {
          fullNameCol = best.col;
        }
      }
    }
  }

  if (classCol === -1 || (fullNameCol === -1 && surnameCol === -1 && firstNameCol === -1)) {
    throw new Error(
      'Faylda "Sinf" va "Familiya va ism" ustunlari aniqlanmadi. Iltimos, sinf va o‘quvchi familiya-ismi mavjud bo‘lgan XLSX faylni tanlang.'
    );
  }

  const rows: ParsedStudentRow[] = [];
  const seenKeys = new Set<string>();
  let totalRowsInFile = 0;
  let duplicatesInFile = 0;
  let skippedInvalidRows = 0;

  for (let r = startRow; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rawClass = cellToString(row.getCell(classCol).value);

    let rawName = '';
    if (fullNameCol !== -1) {
      rawName = cellToString(row.getCell(fullNameCol).value);
    } else {
      const parts: string[] = [];
      if (surnameCol !== -1) {
        const s = cellToString(row.getCell(surnameCol).value);
        if (s && !isAcademicYearOrNonName(s)) parts.push(s);
      }
      if (firstNameCol !== -1) {
        const f = cellToString(row.getCell(firstNameCol).value);
        if (f && !isAcademicYearOrNonName(f)) parts.push(f);
      }
      rawName = parts.join(' ');
    }

    if (!rawClass && !rawName) continue;

    // Skip repeated header rows inside tables
    const lowerCls = rawClass.toLowerCase();
    const lowerName = rawName.toLowerCase();
    if (
      lowerCls === 'sinf' ||
      lowerCls === 'class' ||
      lowerName.includes('familiya va ism') ||
      lowerName === 'familiya' ||
      lowerName === 'ism'
    ) {
      continue;
    }

    totalRowsInFile++;

    const className = cleanClassLabel(rawClass);
    const fullName = cleanNameValue(rawName);

    if (!isValidClassLabel(className) || isAcademicYearOrNonName(fullName)) {
      skippedInvalidRows++;
      continue;
    }

    const key = normalizeStudentKey(className, fullName);
    if (seenKeys.has(key)) {
      duplicatesInFile++;
      continue;
    }
    seenKeys.add(key);
    rows.push({ className, fullName });
  }

  if (rows.length === 0) {
    throw new Error(
      'Fayldan haqiqiy o‘quvchi yozuvlari topilmadi. Sinf (masalan: 7-A) va Familiya-ism ustunlarini tekshiring.'
    );
  }

  return {
    rows,
    totalRowsInFile,
    duplicatesInFile,
    skippedInvalidRows,
  };
}

export async function parseStudentWorkbookBuffer(buffer: Buffer): Promise<ParsedStudentWorkbookResult> {
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any);
  const ws = wb.worksheets[0];
  if (!ws) {
    throw new Error('Excel varag‘i topilmadi.');
  }
  return parseStudentWorksheet(ws);
}

/**
 * Computes a deterministic preview diff for full-replacement student roster import.
 * Guarantees:
 * - Matching active students are kept with their original IDs and loan history intact
 * - Matching archived students are reactivated (no duplicate created)
 * - Existing active students absent from the incoming file are marked to archive (never deleted)
 */
export function computeStudentRosterDiff(
  existingStudents: Student[],
  parsed: ParsedStudentWorkbookResult,
  loans: Loan[],
  fileName: string
): StudentReplacePreview {
  const activeLoansByStudent = new Map<string, number>();
  for (const l of loans) {
    if (l.status === 'active' && l.studentId) {
      activeLoansByStudent.set(l.studentId, (activeLoansByStudent.get(l.studentId) ?? 0) + 1);
    }
  }

  const existingByExactKey = new Map<string, Student>();
  for (const s of existingStudents) {
    const key = normalizeStudentKey(s.className, s.fullName);
    // Prefer active student if duplicates somehow existed previously
    const prev = existingByExactKey.get(key);
    if (!prev || (prev.status === 'archived' && s.status === 'active')) {
      existingByExactKey.set(key, s);
    }
  }

  const matchedStudentIds = new Set<string>();
  const toAdd: ParsedStudentRow[] = [];
  const toKeep: ParsedStudentRow[] = [];
  const toReactivate: ParsedStudentRow[] = [];

  for (const row of parsed.rows) {
    const exactKey = normalizeStudentKey(row.className, row.fullName);
    const match = existingByExactKey.get(exactKey);
    if (match) {
      matchedStudentIds.add(match.id);
      if (match.status === 'active') {
        toKeep.push(row);
      } else {
        toReactivate.push(row);
      }
    } else {
      toAdd.push(row);
    }
  }

  const toArchive: Array<{ className: string; fullName: string; activeLoans: number }> = [];
  let archivedWithActiveLoansCount = 0;

  for (const s of existingStudents) {
    if (s.status === 'active' && !matchedStudentIds.has(s.id)) {
      const activeLoans = activeLoansByStudent.get(s.id) ?? 0;
      if (activeLoans > 0) archivedWithActiveLoansCount++;
      toArchive.push({
        className: s.className,
        fullName: s.fullName,
        activeLoans,
      });
    }
  }

  return {
    fileName,
    totalRowsInFile: parsed.totalRowsInFile,
    uniqueRowsInFile: parsed.rows.length,
    duplicatesInFile: parsed.duplicatesInFile,
    skippedInvalidRows: parsed.skippedInvalidRows,
    toAddCount: toAdd.length,
    toKeepCount: toKeep.length,
    toReactivateCount: toReactivate.length,
    toArchiveCount: toArchive.length,
    archivedWithActiveLoansCount,
    sampleAdd: toAdd.slice(0, 12),
    sampleReactivate: toReactivate.slice(0, 8),
    sampleArchive: toArchive.slice(0, 12),
    rows: parsed.rows,
  };
}
