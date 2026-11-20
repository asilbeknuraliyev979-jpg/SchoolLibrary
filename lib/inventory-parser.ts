import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import type {
  ImportPreviewResult,
  ParsedRowPreview,
  RawInventoryColumns,
  ReviewIssueCode,
  ValidationStatus,
} from './types';

export const ORIGINAL_INVENTORY_HEADERS = [
  'Yozilgan sanasi,necha nomda',
  'Inventar raqami',
  'Kutubxona zaxirasini tekshirish',
  'Muallif va kitob nomi',
  'Nashr yili',
  'Bahosi',
  'Jamlama kitobga yozilgan raqami',
  "Bo'limi",
  'Chiqarish akti',
  'Eslatma',
] as const;

/**
 * Neutralizes spreadsheet formula injection (CWE-1236) while keeping pure numbers safe.
 */
export function sanitizeSpreadsheetValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (!str) return '';
  // Pure numeric values (including negative integers/decimals) are safe as strings or numbers
  if (/^-?\d+(\.\d+)?$/.test(str.trim())) {
    return str;
  }
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

/**
 * Extracts clean text from any ExcelJS cell value without silently modifying content.
 */
export function cellToString(val: ExcelJS.CellValue): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (val instanceof Date) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${d}.${m}.${y}`;
  }
  if (typeof val === 'object') {
    if ('richText' in val && Array.isArray(val.richText)) {
      return val.richText.map((rt) => rt.text).join('').trim();
    }
    if ('result' in val && val.result !== undefined && val.result !== null) {
      return String(val.result).trim();
    }
    if ('text' in val && typeof val.text === 'string') {
      return val.text.trim();
    }
  }
  return String(val).trim();
}

/**
 * Detects an inventory range like "1-72", "1-96", "63-72", "97-122".
 * Never automatically creates copies from ranges — only flags them for librarian review.
 */
export function detectInventoryRange(invRaw: string): {
  isRange: boolean;
  start: number | null;
  end: number | null;
} {
  const cleaned = invRaw.trim();
  const match = /^(\d+)\s*[-–—]\s*(\d+)$/.exec(cleaned);
  if (!match) {
    return { isRange: false, start: null, end: null };
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return { isRange: true, start: null, end: null };
  }
  return { isRange: true, start, end };
}

/**
 * Validates publication year without silently modifying or removing suspicious values.
 */
export function validatePublicationYear(
  yearRaw: string,
  maxAllowedYear: number = 2026
): { year: number | null; isInvalid: boolean; isMissing: boolean } {
  const cleaned = yearRaw.trim();
  if (!cleaned) {
    return { year: null, isInvalid: false, isMissing: true };
  }
  if (!/^\d+$/.test(cleaned)) {
    return { year: null, isInvalid: true, isMissing: false };
  }
  const num = Number(cleaned);
  if (num < 1900 || num > maxAllowedYear) {
    return { year: null, isInvalid: true, isMissing: false };
  }
  return { year: num, isInvalid: false, isMissing: false };
}

/**
 * Suggests a title/author split from the combined "Muallif va kitob nomi" column.
 * Never presents uncertain splits as confirmed; always preserves the original value separately.
 */
export function suggestTitleAuthorSplit(raw: string): {
  title: string;
  author: string;
  confidence: 'high' | 'uncertain' | 'none';
} {
  const text = raw.trim();
  if (!text) {
    return { title: '', author: '', confidence: 'none' };
  }

  // Pattern 1: Initials + Surname at end: "Ona tili K.M.Movlonova", "Shum bola G'.G'ulom", "O'tkan kunlar P.Qodirov", "Algebra A.Alimov"
  const initialsRegex =
    /^(.*?)\s+((?:[A-ZА-ЯЁO'G']{1,2}\.?\s*){1,2}\.[A-Za-zА-Яа-яЁё''ʼ`-]{2,}(?:,\s*(?:[A-ZА-ЯЁ]{1,2}\.){1,2}[A-Za-zА-Яа-яЁё''ʼ`-]{2,})?)$/;
  const m1 = initialsRegex.exec(text);
  if (m1 && m1[1].trim().length >= 2) {
    return {
      title: m1[1].trim(),
      author: m1[2].trim(),
      confidence: 'high',
    };
  }

  // Pattern 2: Missing space before initial+dot: "Jahon tarixiM.Lafasov", "Quyonlar saltanatiX.To'xtaboyev", "Adabiyot muallimiA.Qahhor"
  const gluedInitialRegex = /^(.{3,}?[a-zа-яё'’])([A-Z][a-z]?\.[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё''ʼ`-]{2,})$/;
  const m2 = gluedInitialRegex.exec(text);
  if (m2) {
    return {
      title: m2[1].trim(),
      author: m2[2].trim(),
      confidence: 'uncertain',
    };
  }

  // Pattern 3: Known full Uzbek/world author names at end of string
  const knownAuthors = [
    'Abdulla Qodiriy',
    'Abdulla Qahhor',
    'Abdulla Avloniy',
    'Abdurauf Fitrat',
    "O'tkir Hoshimov",
    'O‘tkir Hoshimov',
    'Tohir Malik',
    'Toxir Malik',
    'Said Ahmad',
    'Chingiz Aytmatov',
    'Mirkarim Osim',
    'Erkin Vohidov',
    'Erkin Malik',
    "Tog'ay Murod",
    'Asqad Muxtor',
    'Muhammad Yusuf',
    'Muhammad Ali',
    'Shukur Xolmirzayev',
    'Odil Yoqubov',
    'Odil yoqubov',
    'Primqul Qodirov',
    'Xudayberdi To\'xtaboyev',
    'Alisher Navoiy',
    'Alisher Navoiiy',
    'Mirzo Ulug\'bek',
    'Rashid Nuri Gultekin',
    'Garriet Bicher-Stou',
    'Erix Mariya Remark',
    'Erix Mariya Remarx',
    'Ahmad Lutfiy Qozonchi',
    'Jaloliddin Rumiy',
    'Rasul Xamzatov',
    'Nodar Dumbadze',
    'Paulo Koelo',
    'Jeyms Klir',
    'Jek London',
    'Mark Tven',
    'Lev Tolistoy',
    'Mixail Bulgakov',
    'Anton Chexov',
    'Frans Kafka',
    'Den Braun',
    'Jorj Oruell',
    'Kel Nyuport',
    'Robin Sharma',
    'Tursinoy Sodiqova',
    'Nazar Eshonqul',
    'Isajon Sulton',
    'Xayriddin Sulton',
    'Shukrullo',
    "Cho'lpon",
    'Oybek',
    'Zulfiya',
    'Shuhrat',
    'Mirmuxsin',
    'Mirmuhsin',
    'Maxtumquli',
    'Faxriyor',
  ];

  const lower = text.toLowerCase();
  for (const author of knownAuthors) {
    const aLower = author.toLowerCase();
    if (lower.endsWith(' ' + aLower) && text.length > author.length + 2) {
      return {
        title: text.slice(0, text.length - author.length).trim(),
        author: text.slice(text.length - author.length).trim(),
        confidence: 'high',
      };
    }
  }

  // Otherwise keep full text as title and leave author blank (never guess unsafely)
  return {
    title: text,
    author: '',
    confidence: 'none',
  };
}

export function computeSha256(buffer: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function isSubtotalRow(raw: RawInventoryColumns): boolean {
  const c1 = raw.col1_dateCount.toLowerCase();
  const c4 = raw.col4_authorTitle.trim();
  if (c1.startsWith('jami') || c1.includes('jami:')) return true;
  if (!raw.col2_inventoryNumber && /^\d+$/.test(c4) && raw.col10_note.trim() === c4) return true;
  return false;
}

function isHeaderOrNumberRow(raw: RawInventoryColumns): boolean {
  const c1 = raw.col1_dateCount.toLowerCase();
  const c4 = raw.col4_authorTitle.toLowerCase();
  if (c1.includes('yozilgan') && c4.includes('muallif')) return true;
  if (c1.includes('barcha turdagi darsliklar')) return true;
  if (
    raw.col1_dateCount === '1' &&
    raw.col2_inventoryNumber === '2' &&
    raw.col4_authorTitle === '4' &&
    raw.col10_note === '10'
  ) {
    return true;
  }
  return false;
}

/**
 * Parses an Inventar.xlsx buffer using ExcelJS and returns a full non-destructive preview.
 */
export async function parseInventoryWorkbook(
  buffer: Buffer | Uint8Array,
  fileName: string,
  existingChecksums: Map<string, string> = new Map(),
  existingInventoryNumbers: Set<string> = new Set(),
  maxAllowedYear: number = 2026
): Promise<ImportPreviewResult> {
  const fileChecksum = computeSha256(buffer);
  const existingBatchId = existingChecksums.get(fileChecksum);

  const wb = new ExcelJS.Workbook();
  const nodeBuf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(nodeBuf as any);

  const sheet =
    wb.getWorksheet('Лист1') ??
    wb.worksheets.find((w) => w.name.toLowerCase().includes('лист')) ??
    wb.worksheets[0];

  if (!sheet) {
    throw new Error("Excel faylida varaq topilmadi (kutilgan varaq: 'Лист1').");
  }

  const rows: ParsedRowPreview[] = [];
  const seenInvInFile = new Map<string, number>();

  // Pass 1: Read rows and count occurrences of inventory numbers within file
  const rawList: Array<{ rowNumber: number; raw: RawInventoryColumns }> = [];
  for (let r = 1; r <= sheet.rowCount; r++) {
    const excelRow = sheet.getRow(r);
    const raw: RawInventoryColumns = {
      col1_dateCount: cellToString(excelRow.getCell(1).value),
      col2_inventoryNumber: cellToString(excelRow.getCell(2).value),
      col3_stockCheck: cellToString(excelRow.getCell(3).value),
      col4_authorTitle: cellToString(excelRow.getCell(4).value),
      col5_publicationYear: cellToString(excelRow.getCell(5).value),
      col6_price: cellToString(excelRow.getCell(6).value),
      col7_summaryBookNumber: cellToString(excelRow.getCell(7).value),
      col8_department: cellToString(excelRow.getCell(8).value),
      col9_writeOffAct: cellToString(excelRow.getCell(9).value),
      col10_note: cellToString(excelRow.getCell(10).value),
    };

    // Skip rows 1..3 if they are register title, headers, or 1..10 numbering
    if (r <= 3 && isHeaderOrNumberRow(raw)) continue;
    if (isHeaderOrNumberRow(raw)) continue;

    rawList.push({ rowNumber: r, raw });

    if (raw.col4_authorTitle && !isSubtotalRow(raw) && raw.col2_inventoryNumber) {
      const invKey = raw.col2_inventoryNumber.trim();
      seenInvInFile.set(invKey, (seenInvInFile.get(invKey) ?? 0) + 1);
    }
  }

  let bookRowsCount = 0;
  let clearSingleRecordsCount = 0;
  let needsReviewCount = 0;
  let skippedSubtotalCount = 0;
  let skippedDateOnlyCount = 0;
  let skippedEmptyCount = 0;
  let duplicateInventoryCount = 0;
  let rangeRecordCount = 0;
  let invalidYearCount = 0;
  let missingInventoryCount = 0;
  const errorCount = 0;

  for (const { rowNumber, raw } of rawList) {
    const allValues = Object.values(raw);
    const hasAnyValue = allValues.some((v) => v.length > 0);
    if (!hasAnyValue) {
      skippedEmptyCount++;
      continue;
    }

    if (isSubtotalRow(raw)) {
      skippedSubtotalCount++;
      rows.push({
        sourceRowNumber: rowNumber,
        rawColumns: raw,
        validationStatus: 'skipped_subtotal',
        issues: [],
        suggestedTitle: '',
        suggestedAuthor: '',
        authorSplitConfidence: 'none',
        publicationYear: null,
        isRange: false,
        rangeStart: null,
        rangeEnd: null,
        reviewNotes: `Yig‘indi (Jami) qatori kitob sifatida kiritilmadi: ${raw.col1_dateCount} ${raw.col4_authorTitle}`.trim(),
      });
      continue;
    }

    if (!raw.col4_authorTitle) {
      skippedDateOnlyCount++;
      rows.push({
        sourceRowNumber: rowNumber,
        rawColumns: raw,
        validationStatus: 'skipped_date_only',
        issues: [],
        suggestedTitle: '',
        suggestedAuthor: '',
        authorSplitConfidence: 'none',
        publicationYear: null,
        isRange: false,
        rangeStart: null,
        rangeEnd: null,
        reviewNotes: raw.col1_dateCount
          ? `Kitob nomi bo‘sh (faqat sana/raqam kiritilgan): ${raw.col1_dateCount}`
          : 'Kitob nomi bo‘sh qator',
      });
      continue;
    }

    bookRowsCount++;
    const issues: ReviewIssueCode[] = [];
    const notes: string[] = [];

    const invTrim = raw.col2_inventoryNumber.trim();
    const rangeInfo = detectInventoryRange(invTrim);

    if (!invTrim) {
      issues.push('missing_inventory_number');
      missingInventoryCount++;
      notes.push('Inventar raqami ko‘rsatilmagan.');
    } else {
      if (rangeInfo.isRange) {
        issues.push('range_ambiguous');
        rangeRecordCount++;
        notes.push(
          `Inventar diapazoni (${invTrim}): fizik nusxalar soni kutubxonachi tasdiqlashini talab qiladi.`
        );
      }
      const inFileCount = seenInvInFile.get(invTrim) ?? 0;
      if (inFileCount > 1 || existingInventoryNumbers.has(invTrim)) {
        issues.push('duplicate_inventory');
        duplicateInventoryCount++;
        notes.push(`Takroriy inventar raqami (${invTrim}) aniqlandi — avtomatik o‘chirilmadi.`);
      }
    }

    const yearCheck = validatePublicationYear(raw.col5_publicationYear, maxAllowedYear);
    if (yearCheck.isInvalid) {
      issues.push('invalid_year');
      invalidYearCount++;
      notes.push(`Shubhali nashr yili: "${raw.col5_publicationYear}" — asl qiymat saqlandi.`);
    } else if (yearCheck.isMissing) {
      issues.push('missing_year');
    }

    const split = suggestTitleAuthorSplit(raw.col4_authorTitle);
    if (split.confidence === 'uncertain') {
      issues.push('uncertain_author_split');
      notes.push('Muallif va kitob nomini ajratish qo‘lda tekshirishni talab qiladi.');
    }

    // Critical issues that require manual review before confirmation
    const blockingIssues: ReviewIssueCode[] = [
      'range_ambiguous',
      'duplicate_inventory',
      'invalid_year',
      'missing_inventory_number',
      'uncertain_author_split',
    ];
    const hasBlockingIssue = issues.some((i) => blockingIssues.includes(i));

    const validationStatus: ValidationStatus = hasBlockingIssue ? 'needs_review' : 'confirmed';
    if (hasBlockingIssue) {
      needsReviewCount++;
    } else {
      clearSingleRecordsCount++;
    }

    rows.push({
      sourceRowNumber: rowNumber,
      rawColumns: raw,
      validationStatus,
      issues,
      suggestedTitle: split.title,
      suggestedAuthor: split.author,
      authorSplitConfidence: split.confidence,
      publicationYear: yearCheck.year,
      isRange: rangeInfo.isRange,
      rangeStart: rangeInfo.start,
      rangeEnd: rangeInfo.end,
      reviewNotes: notes.join(' '),
    });
  }

  return {
    fileName,
    sheetName: sheet.name,
    fileChecksum,
    alreadyImported: Boolean(existingBatchId),
    existingBatchId,
    totalRowsScanned: rawList.length,
    bookRowsCount,
    clearSingleRecordsCount,
    needsReviewCount,
    skippedSubtotalCount,
    skippedDateOnlyCount,
    skippedEmptyCount,
    duplicateInventoryCount,
    rangeRecordCount,
    invalidYearCount,
    missingInventoryCount,
    errorCount,
    rows,
  };
}
