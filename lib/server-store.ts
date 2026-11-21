import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ActivityLog,
  BookTitle,
  BorrowerType,
  ImportBatch,
  ImportPreviewResult,
  InventoryIncident,
  LibraryDatabase,
  LibrarySettings,
  Loan,
  LoanExtension,
  NotificationItem,
  ParsedStudentRow,
  PhysicalCopy,
  ReturnCondition,
  ReviewIssueCode,
  SourceInventoryRecord,
  Student,
  StudentImportBackup,
  StudentReplacePreview,
  Teacher,
} from './types';
import { addDaysYmd, classifyLoanDeadline, getTodayTashkent, isValidYmd } from './date-utils';
import {
  computeStudentRosterDiff,
  normalizeStudentKey,
  type ParsedStudentWorkbookResult,
} from './student-parser';

import { resolveWritableDataDir } from './storage-dir';

const globalStore = globalThis as unknown as {
  __slMemoryDb?: LibraryDatabase;
  __slMemoryDbFile?: string;
  __slMemoryDbMtimeMs?: number;
  __slMemoryDbSize?: number;
};

// Serialized promise queue to guarantee transactional consistency for concurrent requests
let writeLock: Promise<unknown> = Promise.resolve();

function uid(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function defaultDatabase(): LibraryDatabase {
  const now = new Date().toISOString();
  return {
    settings: {
      schoolName: 'Kattaqo‘rg‘on tuman ixtisoslashtirilgan maktabi',
      librarianName: 'Nodira',
      defaultLoanDays: 14,
      maxBooksPerStudent: 5,
      timezone: 'Asia/Tashkent',
      updatedAt: now,
    },
    students: [],
    teachers: [],
    studentImportBackups: [],
    bookTitles: [],
    physicalCopies: [],
    importBatches: [],
    sourceInventoryRecords: [],
    loans: [],
    loanExtensions: [],
    inventoryIncidents: [],
    notifications: [],
    activityLogs: [],
  };
}

function getDbFilePath(): string | null {
  const dir = resolveWritableDataDir();
  if (!dir) return null;
  return path.join(dir, 'library-store.json');
}

export function readDb(): LibraryDatabase {
  const dbFile = getDbFilePath();
  if (dbFile) {
    try {
      const stat = fs.statSync(dbFile);
      if (
        globalStore.__slMemoryDb &&
        globalStore.__slMemoryDbFile === dbFile &&
        globalStore.__slMemoryDbMtimeMs === stat.mtimeMs &&
        globalStore.__slMemoryDbSize === stat.size
      ) {
        return globalStore.__slMemoryDb;
      }
      const raw = fs.readFileSync(dbFile, 'utf8');
      const parsed = JSON.parse(raw) as LibraryDatabase;
      if (!Array.isArray(parsed.teachers)) parsed.teachers = [];
      if (!Array.isArray(parsed.studentImportBackups)) parsed.studentImportBackups = [];
      globalStore.__slMemoryDb = parsed;
      globalStore.__slMemoryDbFile = dbFile;
      globalStore.__slMemoryDbMtimeMs = stat.mtimeMs;
      globalStore.__slMemoryDbSize = stat.size;
      return parsed;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.error('[server-store] Failed to read library-store.json; using fallback state:', err);
      }
    }
  }

  if (globalStore.__slMemoryDb && (!dbFile || globalStore.__slMemoryDbMtimeMs === undefined)) {
    return globalStore.__slMemoryDb;
  }

  const initial = defaultDatabase();
  writeDbAtomic(initial);
  return initial;
}

function writeDbAtomic(db: LibraryDatabase) {
  globalStore.__slMemoryDb = db;
  const dbFile = getDbFilePath();
  if (!dbFile) {
    globalStore.__slMemoryDbMtimeMs = undefined;
    return;
  }

  try {
    const tmp = `${dbFile}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
    fs.renameSync(tmp, dbFile);
    const stat = fs.statSync(dbFile);
    globalStore.__slMemoryDbFile = dbFile;
    globalStore.__slMemoryDbMtimeMs = stat.mtimeMs;
    globalStore.__slMemoryDbSize = stat.size;
  } catch (err) {
    globalStore.__slMemoryDbMtimeMs = undefined;
    console.warn('[server-store] Failed to persist library-store.json; keeping state in memory:', err);
  }
}

/**
 * Runs an atomic read-modify-write transaction serialized across concurrent API calls.
 */
export async function withDbTransaction<T>(fn: (db: LibraryDatabase) => T | Promise<T>): Promise<T> {
  const next = writeLock.then(async () => {
    const db = readDb();
    const result = await fn(db);
    writeDbAtomic(db);
    return result;
  });
  writeLock = next.catch(() => {});
  return next;
}

function addLog(
  db: LibraryDatabase,
  actorName: string,
  action: string,
  entityType: string,
  entityId: string,
  summary: string
) {
  const entry: ActivityLog = {
    id: uid('log'),
    action,
    entityType,
    entityId,
    summary,
    actorName,
    createdAt: new Date().toISOString(),
  };
  db.activityLogs.unshift(entry);
  if (db.activityLogs.length > 2000) {
    db.activityLogs = db.activityLogs.slice(0, 2000);
  }
}

function addNotification(
  db: LibraryDatabase,
  type: NotificationItem['type'],
  title: string,
  message: string,
  link?: string
) {
  const item: NotificationItem = {
    id: uid('ntf'),
    type,
    title,
    message,
    read: false,
    link,
    createdAt: new Date().toISOString(),
  };
  db.notifications.unshift(item);
  if (db.notifications.length > 300) {
    db.notifications = db.notifications.slice(0, 300);
  }
}

export async function recordAuthAuditLog(
  action: 'LOGIN_SUCCESS' | 'LOGIN_FAILED' | 'LOGIN_LOCKED' | 'LOGOUT',
  actorName: string,
  summary: string
): Promise<void> {
  await withDbTransaction((db) => {
    addLog(db, actorName, action, 'auth', actorName, summary);
  });
}

function nextCopyCode(db: LibraryDatabase): string {
  const num = db.physicalCopies.length + 1;
  return `SL-${String(num).padStart(5, '0')}`;
}

function nextStudentCode(db: LibraryDatabase): string {
  let maxCode = 0;
  for (const s of db.students) {
    const m = /^(?:STU|OQ)-(\d+)$/.exec(s.internalStudentId);
    if (m) {
      const n = Number(m[1]);
      if (n > maxCode) maxCode = n;
    }
  }
  return `STU-${String(maxCode + 1).padStart(4, '0')}`;
}

function nextTeacherCode(db: LibraryDatabase): string {
  let maxCode = 0;
  for (const t of db.teachers) {
    const m = /^TCH-(\d+)$/.exec(t.internalTeacherId);
    if (m) {
      const n = Number(m[1]);
      if (n > maxCode) maxCode = n;
    }
  }
  return `TCH-${String(maxCode + 1).padStart(4, '0')}`;
}

/**
 * Commits a parsed Inventar.xlsx preview idempotently into the database.
 * IMPORTANT: Never fabricates physical copies from ambiguous ranges!
 * Clear single-copy records can optionally be confirmed only when librarian explicitly chooses so;
 * by default imported rows are preserved faithfully and unambiguous single items can be batch-confirmed.
 */
export async function commitInventoryImport(
  preview: ImportPreviewResult,
  options: { autoConfirmClearSingleCopies: boolean; actorName: string }
): Promise<{ batch: ImportBatch; skippedDuplicateFile: boolean }> {
  return withDbTransaction((db) => {
    const existingBatch = db.importBatches.find((b) => b.fileChecksum === preview.fileChecksum);
    if (existingBatch) {
      return { batch: existingBatch, skippedDuplicateFile: true };
    }

    const now = new Date().toISOString();
    const batchId = uid('batch');
    let confirmedCount = 0;
    let needsReviewCount = 0;

    for (const row of preview.rows) {
      const sourceId = uid('src');

      if (
        row.validationStatus === 'skipped_subtotal' ||
        row.validationStatus === 'skipped_date_only' ||
        row.validationStatus === 'skipped_empty'
      ) {
        const srcRec: SourceInventoryRecord = {
          id: sourceId,
          importBatchId: batchId,
          sourceFileName: preview.fileName,
          sourceSheet: preview.sheetName,
          sourceRowNumber: row.sourceRowNumber,
          rawColumns: row.rawColumns,
          normalizedValues: {
            title: '',
            author: '',
            publicationYear: null,
            departmentCode: row.rawColumns.col8_department,
            inventoryNumberRaw: row.rawColumns.col2_inventoryNumber,
            isRange: false,
          },
          validationStatus: row.validationStatus,
          issues: row.issues,
          reviewNotes: row.reviewNotes,
          bookTitleId: null,
          importedAt: now,
          updatedAt: now,
        };
        db.sourceInventoryRecords.push(srcRec);
        continue;
      }

      const isClearSingle =
        row.validationStatus === 'confirmed' && !row.isRange && Boolean(row.rawColumns.col2_inventoryNumber.trim());

      const shouldConfirmNow = isClearSingle && options.autoConfirmClearSingleCopies;
      const bookId = uid('book');

      const book: BookTitle = {
        id: bookId,
        title: row.suggestedTitle || row.rawColumns.col4_authorTitle,
        author: row.suggestedAuthor,
        authorSplitConfidence: row.authorSplitConfidence,
        originalAuthorTitle: row.rawColumns.col4_authorTitle,
        inventoryNumberRaw: row.rawColumns.col2_inventoryNumber,
        publicationYearRaw: row.rawColumns.col5_publicationYear,
        publicationYear: row.publicationYear,
        departmentCode: row.rawColumns.col8_department,
        priceRaw: row.rawColumns.col6_price,
        dateRecordedRaw: row.rawColumns.col1_dateCount,
        reviewStatus: shouldConfirmNow ? 'confirmed' : 'needs_review',
        reviewIssues: row.issues,
        sourceRecordId: sourceId,
        sourceRowNumber: row.sourceRowNumber,
        isRangeRecord: row.isRange,
        rangeStart: row.rangeStart,
        rangeEnd: row.rangeEnd,
        rangeConfirmed: false,
        createdAt: now,
        updatedAt: now,
      };
      db.bookTitles.push(book);

      if (shouldConfirmNow) {
        confirmedCount++;
        const copyCode = nextCopyCode(db);
        const copy: PhysicalCopy = {
          id: uid('copy'),
          bookTitleId: bookId,
          internalCopyCode: copyCode,
          originalInventoryNumber: row.rawColumns.col2_inventoryNumber,
          barcode: copyCode,
          status: 'available',
          confirmed: true,
          sourceRecordId: sourceId,
          activeLoanId: null,
          notes: `Import tasdiqlandi (${preview.fileName}, ${row.sourceRowNumber}-qator)`,
          createdAt: now,
          updatedAt: now,
        };
        db.physicalCopies.push(copy);
      } else {
        needsReviewCount++;
      }

      const srcRec: SourceInventoryRecord = {
        id: sourceId,
        importBatchId: batchId,
        sourceFileName: preview.fileName,
        sourceSheet: preview.sheetName,
        sourceRowNumber: row.sourceRowNumber,
        rawColumns: row.rawColumns,
        normalizedValues: {
          title: book.title,
          author: book.author,
          publicationYear: book.publicationYear,
          departmentCode: book.departmentCode,
          inventoryNumberRaw: book.inventoryNumberRaw,
          isRange: book.isRangeRecord,
        },
        validationStatus: shouldConfirmNow ? 'confirmed' : 'needs_review',
        issues: row.issues,
        reviewNotes: row.reviewNotes,
        bookTitleId: bookId,
        importedAt: now,
        updatedAt: now,
      };
      db.sourceInventoryRecords.push(srcRec);
    }

    const batch: ImportBatch = {
      id: batchId,
      fileName: preview.fileName,
      sheetName: preview.sheetName,
      fileChecksum: preview.fileChecksum,
      totalRowsScanned: preview.totalRowsScanned,
      bookRowsCount: preview.bookRowsCount,
      confirmedCount,
      needsReviewCount,
      skippedCount: preview.skippedSubtotalCount + preview.skippedDateOnlyCount + preview.skippedEmptyCount,
      skippedSubtotalCount: preview.skippedSubtotalCount,
      skippedDateOnlyCount: preview.skippedDateOnlyCount,
      duplicateInventoryCount: preview.duplicateInventoryCount,
      rangeRecordCount: preview.rangeRecordCount,
      invalidYearCount: preview.invalidYearCount,
      missingInventoryCount: preview.missingInventoryCount,
      errorCount: preview.errorCount,
      status: 'completed',
      createdAt: now,
    };
    db.importBatches.unshift(batch);

    addLog(
      db,
      options.actorName,
      'IMPORT_WORKBOOK',
      'import_batch',
      batchId,
      `${preview.fileName} import qilindi: ${preview.bookRowsCount} kitob yozuvi (${confirmedCount} tasdiqlangan, ${needsReviewCount} tekshiruvda).`
    );

    if (needsReviewCount > 0) {
      addNotification(
        db,
        'info',
        'Inventar importi yakunlandi',
        `${preview.fileName}: ${preview.bookRowsCount} ta yozuv yuklandi. ${needsReviewCount} ta yozuv tekshiruvni kutmoqda.`,
        '/import'
      );
    }

    return { batch, skippedDuplicateFile: false };
  });
}

/**
 * Batch-confirms clear non-range imported records that currently have 0 copies.
 * NEVER touches ambiguous range records!
 */
export async function batchConfirmClearBooks(actorName: string): Promise<{ confirmedBooks: number; createdCopies: number }> {
  return withDbTransaction((db) => {
    const now = new Date().toISOString();
    let confirmedBooks = 0;
    let createdCopies = 0;

    for (const book of db.bookTitles) {
      if (book.reviewStatus !== 'needs_review') continue;
      if (book.isRangeRecord) continue; // NEVER auto-confirm ranges
      const blocking: ReviewIssueCode[] = ['range_ambiguous', 'invalid_year', 'missing_inventory_number'];
      if (book.reviewIssues.some((i) => blocking.includes(i))) continue;

      const existingCopies = db.physicalCopies.filter((c) => c.bookTitleId === book.id && c.confirmed);
      if (existingCopies.length === 0) {
        const copyCode = nextCopyCode(db);
        db.physicalCopies.push({
          id: uid('copy'),
          bookTitleId: book.id,
          internalCopyCode: copyCode,
          originalInventoryNumber: book.inventoryNumberRaw,
          barcode: copyCode,
          status: 'available',
          confirmed: true,
          sourceRecordId: book.sourceRecordId,
          activeLoanId: null,
          notes: 'Ommaviy tasdiqlash orqali yaratilgan nusxa',
          createdAt: now,
          updatedAt: now,
        });
        createdCopies++;
      }

      book.reviewStatus = 'confirmed';
      book.authorSplitConfidence = 'confirmed';
      book.reviewIssues = book.reviewIssues.filter((i) => i === 'duplicate_inventory');
      book.updatedAt = now;
      confirmedBooks++;

      if (book.sourceRecordId) {
        const src = db.sourceInventoryRecords.find((s) => s.id === book.sourceRecordId);
        if (src) {
          src.validationStatus = 'confirmed';
          src.updatedAt = now;
        }
      }
    }

    if (confirmedBooks > 0) {
      addLog(
        db,
        actorName,
        'BATCH_CONFIRM_INVENTORY',
        'book_title',
        'batch',
        `${confirmedBooks} ta aniq inventar yozuvi tasdiqlandi va ${createdCopies} ta fizik nusxa yaratildi.`
      );
    }

    return { confirmedBooks, createdCopies };
  });
}

/**
 * Confirms an inventory range record with an explicit copy count chosen by the librarian.
 */
export async function confirmBookRange(
  bookId: string,
  copyCount: number,
  inventoryLabels: string[] | null,
  actorName: string
): Promise<{ book: BookTitle; createdCopies: PhysicalCopy[] }> {
  if (!Number.isInteger(copyCount) || copyCount < 1 || copyCount > 300) {
    throw new Error('Nusxalar soni 1 dan 300 gacha butun son bo‘lishi kerak.');
  }

  return withDbTransaction((db) => {
    const book = db.bookTitles.find((b) => b.id === bookId);
    if (!book) throw new Error('Kitob topilmadi.');

    const now = new Date().toISOString();
    const createdCopies: PhysicalCopy[] = [];
    const startNum = book.rangeStart ?? 1;

    for (let i = 0; i < copyCount; i++) {
      const copyCode = nextCopyCode(db);
      const origInv =
        inventoryLabels?.[i] ??
        (book.isRangeRecord && book.rangeStart !== null
          ? `${book.inventoryNumberRaw} (#${startNum + i})`
          : book.inventoryNumberRaw || copyCode);
      const copy: PhysicalCopy = {
        id: uid('copy'),
        bookTitleId: book.id,
        internalCopyCode: copyCode,
        originalInventoryNumber: origInv,
        barcode: copyCode,
        status: 'available',
        confirmed: true,
        sourceRecordId: book.sourceRecordId,
        activeLoanId: null,
        notes: book.isRangeRecord
          ? `Diapazon (${book.inventoryNumberRaw}) tasdiqlanganda yaratilgan (${i + 1}/${copyCount})`
          : 'Kutubxonachi tomonidan qo‘shilgan tasdiqlangan nusxa',
        createdAt: now,
        updatedAt: now,
      };
      db.physicalCopies.push(copy);
      createdCopies.push(copy);
    }

    book.rangeConfirmed = true;
    book.reviewStatus = 'confirmed';
    book.reviewIssues = book.reviewIssues.filter((x) => x !== 'range_ambiguous');
    book.updatedAt = now;

    if (book.sourceRecordId) {
      const src = db.sourceInventoryRecords.find((s) => s.id === book.sourceRecordId);
      if (src) {
        src.validationStatus = 'confirmed';
        src.reviewNotes = `Kutubxonachi ${copyCount} ta fizik nusxani tasdiqladi.`;
        src.updatedAt = now;
      }
    }

    addLog(
      db,
      actorName,
      'CONFIRM_RANGE_COPIES',
      'book_title',
      book.id,
      `"${book.title}" (${book.inventoryNumberRaw || '—'}) uchun ${copyCount} ta tasdiqlangan fizik nusxa yaratildi.`
    );

    return { book, createdCopies };
  });
}

export async function createBookManually(
  input: {
    title: string;
    author: string;
    inventoryNumberRaw: string;
    publicationYear: number | null;
    departmentCode: string;
    priceRaw?: string;
    initialCopies: number;
  },
  actorName: string
): Promise<{ book: BookTitle; copies: PhysicalCopy[] }> {
  const title = input.title.trim();
  if (!title) throw new Error('Kitob nomi kiritilishi shart.');
  if (!Number.isInteger(input.initialCopies) || input.initialCopies < 0 || input.initialCopies > 200) {
    throw new Error('Nusxalar soni 0 dan 200 gacha bo‘lishi kerak.');
  }

  return withDbTransaction((db) => {
    const now = new Date().toISOString();
    const bookId = uid('book');
    const book: BookTitle = {
      id: bookId,
      title,
      author: input.author.trim(),
      authorSplitConfidence: 'confirmed',
      originalAuthorTitle: input.author.trim() ? `${title} ${input.author.trim()}` : title,
      inventoryNumberRaw: input.inventoryNumberRaw.trim(),
      publicationYearRaw: input.publicationYear ? String(input.publicationYear) : '',
      publicationYear: input.publicationYear,
      departmentCode: input.departmentCode.trim(),
      priceRaw: input.priceRaw?.trim() ?? '',
      dateRecordedRaw: getTodayTashkent(),
      reviewStatus: 'confirmed',
      reviewIssues: [],
      sourceRecordId: null,
      sourceRowNumber: null,
      isRangeRecord: false,
      rangeStart: null,
      rangeEnd: null,
      rangeConfirmed: true,
      createdAt: now,
      updatedAt: now,
    };
    db.bookTitles.unshift(book);

    const copies: PhysicalCopy[] = [];
    for (let i = 0; i < input.initialCopies; i++) {
      const code = nextCopyCode(db);
      const copy: PhysicalCopy = {
        id: uid('copy'),
        bookTitleId: bookId,
        internalCopyCode: code,
        originalInventoryNumber:
          input.initialCopies > 1 && input.inventoryNumberRaw.trim()
            ? `${input.inventoryNumberRaw.trim()}-${i + 1}`
            : input.inventoryNumberRaw.trim() || code,
        barcode: code,
        status: 'available',
        confirmed: true,
        sourceRecordId: null,
        activeLoanId: null,
        notes: 'Qo‘lda qo‘shilgan tasdiqlangan nusxa',
        createdAt: now,
        updatedAt: now,
      };
      db.physicalCopies.push(copy);
      copies.push(copy);
    }

    addLog(
      db,
      actorName,
      'CREATE_BOOK',
      'book_title',
      bookId,
      `Yangi kitob qo‘shildi: "${book.title}" (${copies.length} ta tasdiqlangan nusxa).`
    );

    return { book, copies };
  });
}

export async function updateBookMetadata(
  bookId: string,
  patch: {
    title?: string;
    author?: string;
    publicationYear?: number | null;
    departmentCode?: string;
    reviewStatus?: BookTitle['reviewStatus'];
    inventoryNumberRaw?: string;
    clearIssue?: ReviewIssueCode;
  },
  actorName: string
): Promise<BookTitle> {
  return withDbTransaction((db) => {
    const book = db.bookTitles.find((b) => b.id === bookId);
    if (!book) throw new Error('Kitob topilmadi.');

    const now = new Date().toISOString();
    if (patch.title !== undefined && patch.title.trim()) book.title = patch.title.trim();
    if (patch.author !== undefined) {
      book.author = patch.author.trim();
      book.authorSplitConfidence = 'confirmed';
      book.reviewIssues = book.reviewIssues.filter((i) => i !== 'uncertain_author_split');
    }
    if (patch.publicationYear !== undefined) {
      book.publicationYear = patch.publicationYear;
      if (patch.publicationYear !== null && patch.publicationYear >= 1900 && patch.publicationYear <= 2026) {
        book.reviewIssues = book.reviewIssues.filter((i) => i !== 'invalid_year' && i !== 'missing_year');
      }
    }
    if (patch.departmentCode !== undefined) book.departmentCode = patch.departmentCode.trim();
    if (patch.inventoryNumberRaw !== undefined) {
      book.inventoryNumberRaw = patch.inventoryNumberRaw.trim();
      if (book.inventoryNumberRaw) {
        book.reviewIssues = book.reviewIssues.filter((i) => i !== 'missing_inventory_number');
      }
    }
    if (patch.clearIssue) {
      book.reviewIssues = book.reviewIssues.filter((i) => i !== patch.clearIssue);
    }
    if (patch.reviewStatus) {
      book.reviewStatus = patch.reviewStatus;
    }
    book.updatedAt = now;

    // Never overwrite sourceInventoryRecords.rawColumns! Only update normalizedValues.
    if (book.sourceRecordId) {
      const src = db.sourceInventoryRecords.find((s) => s.id === book.sourceRecordId);
      if (src) {
        src.normalizedValues = {
          title: book.title,
          author: book.author,
          publicationYear: book.publicationYear,
          departmentCode: book.departmentCode,
          inventoryNumberRaw: book.inventoryNumberRaw,
          isRange: book.isRangeRecord,
        };
        src.validationStatus = book.reviewStatus === 'confirmed' ? 'confirmed' : src.validationStatus;
        src.updatedAt = now;
      }
    }

    addLog(
      db,
      actorName,
      'UPDATE_BOOK',
      'book_title',
      book.id,
      `"${book.title}" ma’lumotlari yangilandi (asl inventar yozuvi o‘zgarishsiz saqlandi).`
    );

    return book;
  });
}

export async function mergeBookTitles(
  primaryBookId: string,
  duplicateBookId: string,
  actorName: string
): Promise<BookTitle> {
  if (primaryBookId === duplicateBookId) {
    throw new Error('Bir xil kitobni o‘zi bilan birlashtirib bo‘lmaydi.');
  }
  return withDbTransaction((db) => {
    const primary = db.bookTitles.find((b) => b.id === primaryBookId);
    const dup = db.bookTitles.find((b) => b.id === duplicateBookId);
    if (!primary || !dup) throw new Error('Kitoblardan biri topilmadi.');

    const now = new Date().toISOString();
    let movedCopies = 0;
    for (const c of db.physicalCopies) {
      if (c.bookTitleId === dup.id) {
        c.bookTitleId = primary.id;
        c.updatedAt = now;
        movedCopies++;
      }
    }
    for (const l of db.loans) {
      if (l.bookTitleId === dup.id) {
        l.bookTitleId = primary.id;
        l.updatedAt = now;
      }
    }
    dup.reviewStatus = 'archived';
    dup.updatedAt = now;

    addLog(
      db,
      actorName,
      'MERGE_BOOKS',
      'book_title',
      primary.id,
      `"${dup.title}" (${dup.inventoryNumberRaw || dup.id}) yozuvi "${primary.title}" bilan birlashtirildi (${movedCopies} ta nusxa ko‘chirildi).`
    );

    return primary;
  });
}

export async function createStudent(
  input: {
    fullName: string;
    className: string;
    schoolStudentNumber?: string;
    notes?: string;
  },
  actorName: string
): Promise<Student> {
  const fullName = input.fullName.trim();
  const className = input.className.trim();
  if (fullName.length < 2) throw new Error('O‘quvchi F.I.Sh. kamida 2 ta belgidan iborat bo‘lishi kerak.');
  if (!className) throw new Error('Sinf nomi kiritilishi shart (masalan: 8a1, 9t).');

  return withDbTransaction((db) => {
    const now = new Date().toISOString();
    const student: Student = {
      id: uid('stu'),
      internalStudentId: nextStudentCode(db),
      schoolStudentNumber: input.schoolStudentNumber?.trim() ?? '',
      fullName,
      className,
      registeredAt: getTodayTashkent(),
      status: 'active',
      notes: input.notes?.trim() ?? '',
      createdAt: now,
      updatedAt: now,
    };
    db.students.unshift(student);

    addLog(
      db,
      actorName,
      'CREATE_STUDENT',
      'student',
      student.id,
      `Yangi o‘quvchi ro‘yxatga olindi: ${student.fullName} (${student.className}, ID: ${student.internalStudentId}).`
    );

    return student;
  });
}

export async function updateStudent(
  studentId: string,
  patch: {
    fullName?: string;
    className?: string;
    schoolStudentNumber?: string;
    status?: 'active' | 'archived';
    notes?: string;
  },
  actorName: string
): Promise<Student> {
  return withDbTransaction((db) => {
    const student = db.students.find((s) => s.id === studentId);
    if (!student) throw new Error('O‘quvchi topilmadi.');

    if (patch.status === 'archived') {
      const hasActiveLoans = db.loans.some((l) => l.studentId === student.id && l.status === 'active');
      if (hasActiveLoans) {
        throw new Error('Qo‘lida qaytarilmagan kitobi bor o‘quvchini arxivlab bo‘lmaydi.');
      }
    }

    if (patch.fullName !== undefined && patch.fullName.trim()) student.fullName = patch.fullName.trim();
    if (patch.className !== undefined && patch.className.trim()) student.className = patch.className.trim();
    if (patch.schoolStudentNumber !== undefined) student.schoolStudentNumber = patch.schoolStudentNumber.trim();
    if (patch.status !== undefined) student.status = patch.status;
    if (patch.notes !== undefined) student.notes = patch.notes.trim();
    student.updatedAt = new Date().toISOString();

    addLog(
      db,
      actorName,
      'UPDATE_STUDENT',
      'student',
      student.id,
      `O‘quvchi ma’lumotlari yangilandi: ${student.fullName} (${student.className}).`
    );
    return student;
  });
}

export function previewReplaceStudents(
  parsed: ParsedStudentWorkbookResult,
  fileName: string
): StudentReplacePreview {
  const db = readDb();
  return computeStudentRosterDiff(db.students, parsed, db.loans, fileName);
}

/**
 * Atomically replaces the active student roster with the incoming list:
 * - Saves a rollback snapshot of the previous student roster
 * - Keeps matching active students with their original IDs & loan history intact
 * - Reactivates matching archived students without creating duplicates
 * - Archives previously active students missing from the new file (NEVER deletes them or their loans)
 * - Adds genuinely new students cleanly with ONLY className + fullName
 */
export async function commitReplaceStudentsTransactional(
  rows: ParsedStudentRow[],
  fileName: string,
  actorName: string
): Promise<{
  added: number;
  kept: number;
  reactivated: number;
  archived: number;
  activeTotal: number;
  backupId: string;
}> {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Yangilash uchun kamida bitta haqiqiy o‘quvchi yozuvi bo‘lishi kerak.');
  }

  return withDbTransaction((db) => {
    const now = new Date().toISOString();
    const today = getTodayTashkent();

    // Save deep snapshot for one-click rollback
    const previousStudentsSnapshot: Student[] = db.students.map((s) => ({ ...s }));

    // Deduplicate incoming rows defensively
    const dedupedRows: ParsedStudentRow[] = [];
    const incomingSeen = new Set<string>();
    for (const r of rows) {
      const className = String(r.className ?? '').trim().replace(/\s+/g, ' ');
      const fullName = String(r.fullName ?? '').trim().replace(/\s+/g, ' ');
      if (!className || !fullName) continue;
      const key = normalizeStudentKey(className, fullName);
      if (incomingSeen.has(key)) continue;
      incomingSeen.add(key);
      dedupedRows.push({ className, fullName });
    }

    if (dedupedRows.length === 0) {
      throw new Error('Faylda haqiqiy o‘quvchi yozuvlari topilmadi.');
    }

    const existingByKey = new Map<string, Student>();
    for (const s of db.students) {
      const key = normalizeStudentKey(s.className, s.fullName);
      const prev = existingByKey.get(key);
      if (!prev || (prev.status === 'archived' && s.status === 'active')) {
        existingByKey.set(key, s);
      }
    }

    let maxCode = 0;
    for (const s of db.students) {
      const m = /^(?:STU|OQ)-(\d+)$/.exec(s.internalStudentId);
      if (m) {
        const n = Number(m[1]);
        if (n > maxCode) maxCode = n;
      }
    }

    const matchedIds = new Set<string>();
    let added = 0;
    let kept = 0;
    let reactivated = 0;
    let archived = 0;

    for (const row of dedupedRows) {
      const key = normalizeStudentKey(row.className, row.fullName);
      const existing = existingByKey.get(key);
      if (existing) {
        matchedIds.add(existing.id);
        // Preserve exact formatting from latest school roster while keeping ID & loan history
        existing.className = row.className;
        existing.fullName = row.fullName;
        if (existing.status === 'archived') {
          existing.status = 'active';
          existing.updatedAt = now;
          reactivated++;
        } else {
          kept++;
        }
      } else {
        maxCode += 1;
        const created: Student = {
          id: uid('stu'),
          internalStudentId: `STU-${String(maxCode).padStart(4, '0')}`,
          schoolStudentNumber: '',
          fullName: row.fullName,
          className: row.className,
          registeredAt: today,
          status: 'active',
          notes: '',
          createdAt: now,
          updatedAt: now,
        };
        db.students.push(created);
        matchedIds.add(created.id);
        added++;
      }
    }

    // Archive existing active students not present in the new file (NEVER delete!)
    for (const s of db.students) {
      if (s.status === 'active' && !matchedIds.has(s.id)) {
        s.status = 'archived';
        s.updatedAt = now;
        archived++;
      }
    }

    const backupId = uid('sbkp');
    const backup: StudentImportBackup = {
      id: backupId,
      fileName,
      createdAt: now,
      actorName,
      previousStudents: previousStudentsSnapshot,
      summary: {
        totalInFile: dedupedRows.length,
        added,
        kept,
        reactivated,
        archived,
      },
    };
    if (!Array.isArray(db.studentImportBackups)) db.studentImportBackups = [];
    db.studentImportBackups.unshift(backup);
    if (db.studentImportBackups.length > 5) {
      db.studentImportBackups = db.studentImportBackups.slice(0, 5);
    }

    const activeTotal = db.students.filter((s) => s.status === 'active').length;

    addLog(
      db,
      actorName,
      'REPLACE_STUDENTS',
      'student',
      backupId,
      `O‘quvchilar bazasi (${fileName}) bilan yangilandi: +${added} yangi, ${kept} saqlandi, ${reactivated} qayta faollashdi, ${archived} arxivlandi. Jami faol: ${activeTotal}.`
    );

    return { added, kept, reactivated, archived, activeTotal, backupId };
  });
}

/**
 * Restores the previous student roster from the latest backup snapshot without deleting any loans.
 * Any students created after the backup that have loans are safely kept as archived rather than deleted.
 */
export async function rollbackLastStudentImport(
  actorName: string
): Promise<{ restoredActiveCount: number; rolledBackFileName: string }> {
  return withDbTransaction((db) => {
    const backups = db.studentImportBackups ?? [];
    const latest = backups.shift();
    if (!latest) {
      throw new Error('Qayta tiklash uchun avvalgi import zaxirasi topilmadi.');
    }

    const now = new Date().toISOString();
    const prevById = new Map(latest.previousStudents.map((s) => [s.id, s]));
    const loanStudentIds = new Set(db.loans.map((l) => l.studentId).filter(Boolean) as string[]);

    const restored: Student[] = latest.previousStudents.map((s) => ({ ...s, updatedAt: now }));

    // Preserve any newly-added student who already received a loan since the import (archive instead of delete)
    for (const current of db.students) {
      if (!prevById.has(current.id) && loanStudentIds.has(current.id)) {
        restored.push({ ...current, status: 'archived', updatedAt: now });
      }
    }

    db.students = restored;
    db.studentImportBackups = backups;

    const restoredActiveCount = db.students.filter((s) => s.status === 'active').length;

    addLog(
      db,
      actorName,
      'ROLLBACK_STUDENTS',
      'student',
      latest.id,
      `Oxirgi o‘quvchilar importi (${latest.fileName}) bekor qilindi. Avvalgi holat tiklandi (${restoredActiveCount} nafar faol o‘quvchi).`
    );

    return { restoredActiveCount, rolledBackFileName: latest.fileName };
  });
}

export async function bulkImportStudents(
  rows: Array<{ fullName: string; className: string; schoolStudentNumber?: string }>,
  actorName: string
): Promise<{ imported: number; skipped: number }> {
  const res = await commitReplaceStudentsTransactional(
    rows.map((r) => ({ className: r.className, fullName: r.fullName })),
    'StudentList.xlsx',
    actorName
  );
  return { imported: res.added + res.reactivated, skipped: res.kept };
}

// ============================================================================
// Teachers CRUD
// ============================================================================

export async function createTeacher(
  input: { fullName: string; position: string; notes?: string },
  actorName: string
): Promise<Teacher> {
  const fullName = input.fullName.trim().replace(/\s+/g, ' ');
  const position = input.position.trim().replace(/\s+/g, ' ');
  if (fullName.length < 2) {
    throw new Error('O‘qituvchi F.I.Sh. kamida 2 ta belgidan iborat bo‘lishi kerak.');
  }
  if (position.length < 2) {
    throw new Error('O‘qituvchi lavozimi kiritilishi shart.');
  }

  return withDbTransaction((db) => {
    const dup = db.teachers.find(
      (t) =>
        t.status === 'active' &&
        t.fullName.toLowerCase() === fullName.toLowerCase() &&
        t.position.toLowerCase() === position.toLowerCase()
    );
    if (dup) {
      throw new Error('Bu F.I.Sh. va lavozimdagi o‘qituvchi allaqachon mavjud.');
    }

    const now = new Date().toISOString();
    const teacher: Teacher = {
      id: uid('tch'),
      internalTeacherId: nextTeacherCode(db),
      fullName,
      position,
      registeredAt: getTodayTashkent(),
      status: 'active',
      notes: input.notes?.trim() ?? '',
      createdAt: now,
      updatedAt: now,
    };
    db.teachers.unshift(teacher);

    addLog(
      db,
      actorName,
      'CREATE_TEACHER',
      'teacher',
      teacher.id,
      `Yangi o‘qituvchi qo‘shildi: ${teacher.fullName} (${teacher.position}).`
    );

    return teacher;
  });
}

export async function updateTeacher(
  teacherId: string,
  patch: {
    fullName?: string;
    position?: string;
    status?: 'active' | 'archived';
    notes?: string;
  },
  actorName: string
): Promise<Teacher> {
  return withDbTransaction((db) => {
    const teacher = db.teachers.find((t) => t.id === teacherId);
    if (!teacher) throw new Error('O‘qituvchi topilmadi.');

    if (patch.status === 'archived') {
      const hasActiveLoans = db.loans.some(
        (l) => l.status === 'active' && l.borrowerType === 'teacher' && l.teacherId === teacher.id
      );
      if (hasActiveLoans) {
        throw new Error('Qo‘lida qaytarilmagan kitobi bor o‘qituvchini arxivlab bo‘lmaydi.');
      }
    }

    if (patch.fullName !== undefined && patch.fullName.trim().length >= 2) {
      teacher.fullName = patch.fullName.trim().replace(/\s+/g, ' ');
    }
    if (patch.position !== undefined && patch.position.trim().length >= 2) {
      teacher.position = patch.position.trim().replace(/\s+/g, ' ');
    }
    if (patch.status !== undefined) teacher.status = patch.status;
    if (patch.notes !== undefined) teacher.notes = patch.notes.trim();
    teacher.updatedAt = new Date().toISOString();

    addLog(
      db,
      actorName,
      'UPDATE_TEACHER',
      'teacher',
      teacher.id,
      `O‘qituvchi ma’lumotlari yangilandi: ${teacher.fullName} (${teacher.position}).`
    );
    return teacher;
  });
}

/**
 * Atomically issues one or more confirmed available physical copies to a student OR a teacher.
 * Strictly prevents double-issuing and enforces configurable borrowing limits.
 */
export async function issueLoansTransactional(
  input: {
    borrowerType?: BorrowerType;
    studentId?: string;
    teacherId?: string;
    physicalCopyIds: string[];
    issuedDate?: string;
    dueDate: string;
    notes?: string;
  },
  actorName: string
): Promise<Loan[]> {
  const uniqueCopyIds = Array.from(new Set(input.physicalCopyIds));
  if (uniqueCopyIds.length === 0) {
    throw new Error('Kamida bitta tasdiqlangan kitob nusxasini tanlang.');
  }
  const issuedDate = input.issuedDate || getTodayTashkent();
  if (!isValidYmd(issuedDate) || !isValidYmd(input.dueDate)) {
    throw new Error('Berilgan yoki qaytarish sanasi noto‘g‘ri formatda.');
  }
  if (input.dueDate < issuedDate) {
    throw new Error('Qaytarish sanasi berilgan sanadan oldin bo‘lishi mumkin emas.');
  }

  const borrowerType: BorrowerType = input.borrowerType === 'teacher' ? 'teacher' : 'student';

  return withDbTransaction((db) => {
    let borrowerLabel = '';
    let resolvedStudentId: string | null = null;
    let resolvedTeacherId: string | null = null;

    if (borrowerType === 'teacher') {
      const teacher = db.teachers.find((t) => t.id === input.teacherId && t.status === 'active');
      if (!teacher) throw new Error('Faol o‘qituvchi topilmadi.');
      const currentActiveCount = db.loans.filter(
        (l) => l.borrowerType === 'teacher' && l.teacherId === teacher.id && l.status === 'active'
      ).length;
      const teacherMax = Math.max(20, db.settings.maxBooksPerStudent * 3);
      if (currentActiveCount + uniqueCopyIds.length > teacherMax) {
        throw new Error(
          `O‘qituvchi bir vaqtda ko‘pi bilan ${teacherMax} ta kitob olishi mumkin (hozir qo‘lida: ${currentActiveCount} ta).`
        );
      }
      resolvedTeacherId = teacher.id;
      borrowerLabel = `${teacher.fullName} (O‘qituvchi · ${teacher.position})`;
    } else {
      const student = db.students.find((s) => s.id === input.studentId && s.status === 'active');
      if (!student) throw new Error('Faol o‘quvchi topilmadi.');

      const currentActiveCount = db.loans.filter(
        (l) => (l.borrowerType ?? 'student') === 'student' && l.studentId === student.id && l.status === 'active'
      ).length;

      if (currentActiveCount + uniqueCopyIds.length > db.settings.maxBooksPerStudent) {
        throw new Error(
          `O‘quvchi bir vaqtda ko‘pi bilan ${db.settings.maxBooksPerStudent} ta kitob olishi mumkin (hozir qo‘lida: ${currentActiveCount} ta).`
        );
      }
      resolvedStudentId = student.id;
      borrowerLabel = `${student.fullName} (${student.className})`;
    }

    // Validate EVERY copy before mutating anything (atomic all-or-nothing!)
    const resolvedCopies: Array<{ copy: PhysicalCopy; book: BookTitle }> = [];
    for (const copyId of uniqueCopyIds) {
      const copy = db.physicalCopies.find((c) => c.id === copyId);
      if (!copy) throw new Error(`Nusxa topilmadi (${copyId}).`);
      if (!copy.confirmed) {
        throw new Error(`Nusxa (${copy.internalCopyCode}) hali tasdiqlanmagan — berish mumkin emas.`);
      }
      if (copy.status !== 'available' || copy.activeLoanId) {
        throw new Error(`Nusxa (${copy.internalCopyCode}) hozir mavjud emas (holati: ${copy.status}).`);
      }
      const existingActive = db.loans.find((l) => l.physicalCopyId === copy.id && l.status === 'active');
      if (existingActive) {
        throw new Error(`Nusxa (${copy.internalCopyCode}) allaqachon boshqa foydalanuvchiga berilgan!`);
      }
      const book = db.bookTitles.find((b) => b.id === copy.bookTitleId);
      if (!book) throw new Error('Nusxaga bog‘langan kitob topilmadi.');
      resolvedCopies.push({ copy, book });
    }

    const now = new Date().toISOString();
    const createdLoans: Loan[] = [];

    for (const { copy, book } of resolvedCopies) {
      const loanId = uid('loan');
      const loan: Loan = {
        id: loanId,
        borrowerType,
        studentId: resolvedStudentId,
        teacherId: resolvedTeacherId,
        bookTitleId: book.id,
        physicalCopyId: copy.id,
        issuedDate,
        dueDate: input.dueDate,
        returnedDate: null,
        status: 'active',
        returnCondition: null,
        notes: input.notes?.trim() ?? '',
        createdAt: now,
        updatedAt: now,
      };
      db.loans.unshift(loan);
      copy.status = 'issued';
      copy.activeLoanId = loanId;
      copy.updatedAt = now;
      createdLoans.push(loan);

      addLog(
        db,
        actorName,
        'ISSUE_BOOK',
        'loan',
        loanId,
        `${borrowerLabel} ga "${book.title}" [${copy.internalCopyCode}] berildi. Qaytarish: ${input.dueDate}.`
      );
    }

    return createdLoans;
  });
}

/**
 * Class-level bulk textbook distribution.
 * Strictly maps unique student -> unique available physical copy.
 */
export async function issueClassBulkDistribution(
  input: {
    assignments: Array<{ studentId: string; physicalCopyId: string }>;
    issuedDate?: string;
    dueDate: string;
    notes?: string;
  },
  actorName: string
): Promise<Loan[]> {
  if (input.assignments.length === 0) {
    throw new Error('Kamida bitta o‘quvchi-nusxa biriktirilishi kerak.');
  }
  const issuedDate = input.issuedDate || getTodayTashkent();
  if (!isValidYmd(issuedDate) || !isValidYmd(input.dueDate) || input.dueDate < issuedDate) {
    throw new Error('Sana parametrlari noto‘g‘ri.');
  }

  // Ensure no physical copy is assigned to two students!
  const seenCopies = new Set<string>();
  for (const a of input.assignments) {
    if (seenCopies.has(a.physicalCopyId)) {
      throw new Error('Bitta fizik nusxani ikki o‘quvchiga bir vaqtda biriktirib bo‘lmaydi.');
    }
    seenCopies.add(a.physicalCopyId);
  }

  return withDbTransaction((db) => {
    const validated: Array<{ student: Student; copy: PhysicalCopy; book: BookTitle }> = [];
    for (const a of input.assignments) {
      const student = db.students.find((s) => s.id === a.studentId && s.status === 'active');
      if (!student) throw new Error(`Faol o‘quvchi topilmadi (${a.studentId}).`);
      const copy = db.physicalCopies.find((c) => c.id === a.physicalCopyId);
      if (!copy || !copy.confirmed || copy.status !== 'available' || copy.activeLoanId) {
        throw new Error(`Nusxa (${copy?.internalCopyCode ?? a.physicalCopyId}) berish uchun mavjud emas.`);
      }
      const book = db.bookTitles.find((b) => b.id === copy.bookTitleId);
      if (!book) throw new Error('Kitob topilmadi.');
      validated.push({ student, copy, book });
    }

    const now = new Date().toISOString();
    const created: Loan[] = [];

    for (const { student, copy, book } of validated) {
      const loanId = uid('loan');
      const loan: Loan = {
        id: loanId,
        studentId: student.id,
        bookTitleId: book.id,
        physicalCopyId: copy.id,
        issuedDate,
        dueDate: input.dueDate,
        returnedDate: null,
        status: 'active',
        returnCondition: null,
        notes: input.notes?.trim() || 'Sinf bo‘yicha ommaviy tarqatish',
        createdAt: now,
        updatedAt: now,
      };
      db.loans.unshift(loan);
      copy.status = 'issued';
      copy.activeLoanId = loanId;
      copy.updatedAt = now;
      created.push(loan);
    }

    addLog(
      db,
      actorName,
      'CLASS_BULK_ISSUE',
      'loan',
      created[0]?.id ?? 'bulk',
      `Sinf bo‘yicha ommaviy tarqatish: ${created.length} ta kitob nusxasi berildi (qaytarish: ${input.dueDate}).`
    );

    return created;
  });
}

/**
 * Atomically returns a loaned book, restoring availability ONLY if returned in good condition.
 * Damaged or lost returns create an InventoryIncident and mark the copy damaged/lost.
 */
export async function returnLoanTransactional(
  input: {
    loanId: string;
    returnedDate?: string;
    condition: ReturnCondition;
    notes?: string;
  },
  actorName: string
): Promise<{ loan: Loan; copy: PhysicalCopy; incident: InventoryIncident | null }> {
  const returnedDate = input.returnedDate || getTodayTashkent();
  if (!isValidYmd(returnedDate)) {
    throw new Error('Qaytarish sanasi noto‘g‘ri formatda.');
  }

  return withDbTransaction((db) => {
    const loan = db.loans.find((l) => l.id === input.loanId);
    if (!loan) throw new Error('Berilgan kitob yozuvi topilmadi.');
    if (loan.status !== 'active') throw new Error('Bu kitob allaqachon qaytarilgan.');

    const copy = db.physicalCopies.find((c) => c.id === loan.physicalCopyId);
    if (!copy) throw new Error('Bog‘langan fizik nusxa topilmadi.');

    const student = loan.studentId ? db.students.find((s) => s.id === loan.studentId) : undefined;
    const teacher = loan.teacherId ? db.teachers.find((t) => t.id === loan.teacherId) : undefined;
    const borrowerName =
      loan.borrowerType === 'teacher'
        ? teacher?.fullName ?? 'O‘qituvchi'
        : student?.fullName ?? 'O‘quvchi';
    const book = db.bookTitles.find((b) => b.id === loan.bookTitleId);
    const now = new Date().toISOString();

    loan.status = 'returned';
    loan.returnedDate = returnedDate;
    loan.returnCondition = input.condition;
    if (input.notes?.trim()) {
      loan.notes = loan.notes ? `${loan.notes} | Qaytarish: ${input.notes.trim()}` : input.notes.trim();
    }
    loan.updatedAt = now;

    copy.activeLoanId = null;
    copy.updatedAt = now;

    let incident: InventoryIncident | null = null;
    if (input.condition === 'good') {
      copy.status = 'available';
    } else {
      copy.status = input.condition; // 'damaged' | 'lost'
      incident = {
        id: uid('inc'),
        physicalCopyId: copy.id,
        bookTitleId: loan.bookTitleId,
        loanId: loan.id,
        studentId: loan.studentId,
        teacherId: loan.teacherId ?? null,
        incidentType: input.condition,
        notes: input.notes?.trim() || (input.condition === 'damaged' ? 'Shikastlangan holda qaytarildi' : 'Kitob yo‘qolgan deb qayd etildi'),
        resolved: false,
        createdAt: now,
        updatedAt: now,
      };
      db.inventoryIncidents.unshift(incident);
      addNotification(
        db,
        'incident',
        input.condition === 'damaged' ? 'Shikastlangan kitob qayd etildi' : 'Yo‘qolgan kitob qayd etildi',
        `${borrowerName} — "${book?.title ?? 'Kitob'}" [${copy.internalCopyCode}]`,
        '/catalog'
      );
    }

    const condLabel =
      input.condition === 'good'
        ? 'Yaxshi holatda'
        : input.condition === 'damaged'
          ? 'Shikastlangan'
          : 'Yo‘qolgan';

    addLog(
      db,
      actorName,
      'RETURN_BOOK',
      'loan',
      loan.id,
      `${borrowerName} "${book?.title ?? 'Kitob'}" [${copy.internalCopyCode}] kitobini qaytardi (${condLabel}).`
    );

    return { loan, copy, incident };
  });
}

export async function extendLoanDeadline(
  input: {
    loanId: string;
    newDueDate: string;
    reason: string;
  },
  actorName: string
): Promise<{ loan: Loan; extension: LoanExtension }> {
  if (!isValidYmd(input.newDueDate)) throw new Error('Yangi qaytarish sanasi noto‘g‘ri.');
  if (input.reason.trim().length < 2) throw new Error('Muddatni uzaytirish sababini kiriting.');

  return withDbTransaction((db) => {
    const loan = db.loans.find((l) => l.id === input.loanId);
    if (!loan || loan.status !== 'active') throw new Error('Faol qarz yozuvi topilmadi.');
    if (input.newDueDate <= loan.dueDate) {
      throw new Error('Yangi muddat joriy qaytarish sanasidan keyinroq bo‘lishi kerak.');
    }

    const now = new Date().toISOString();
    const ext: LoanExtension = {
      id: uid('ext'),
      loanId: loan.id,
      previousDueDate: loan.dueDate,
      newDueDate: input.newDueDate,
      reason: input.reason.trim(),
      actorName,
      createdAt: now,
    };
    db.loanExtensions.unshift(ext);
    loan.dueDate = input.newDueDate;
    loan.updatedAt = now;

    addLog(
      db,
      actorName,
      'EXTEND_LOAN',
      'loan',
      loan.id,
      `Qaytarish muddati ${ext.previousDueDate} dan ${ext.newDueDate} ga uzaytirildi. Sabab: ${ext.reason}`
    );

    return { loan, extension: ext };
  });
}

export async function updateLibrarySettings(
  patch: Partial<Pick<LibrarySettings, 'schoolName' | 'librarianName' | 'defaultLoanDays' | 'maxBooksPerStudent'>>,
  actorName: string
): Promise<LibrarySettings> {
  return withDbTransaction((db) => {
    if (patch.schoolName !== undefined && patch.schoolName.trim()) {
      db.settings.schoolName = patch.schoolName.trim();
    }
    if (patch.librarianName !== undefined && patch.librarianName.trim()) {
      db.settings.librarianName = patch.librarianName.trim();
    }
    if (patch.defaultLoanDays !== undefined) {
      const days = Number(patch.defaultLoanDays);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        throw new Error('Standart muddat 1 dan 365 kungacha bo‘lishi kerak.');
      }
      db.settings.defaultLoanDays = days;
    }
    if (patch.maxBooksPerStudent !== undefined) {
      const max = Number(patch.maxBooksPerStudent);
      if (!Number.isInteger(max) || max < 1 || max > 50) {
        throw new Error('O‘quvchi uchun maksimal kitoblar soni 1 dan 50 gacha bo‘lishi kerak.');
      }
      db.settings.maxBooksPerStudent = max;
    }
    db.settings.updatedAt = new Date().toISOString();

    addLog(db, actorName, 'UPDATE_SETTINGS', 'settings', 'library_settings', 'Kutubxona sozlamalari yangilandi.');
    return db.settings;
  });
}

export async function markNotificationRead(id: string | 'all'): Promise<void> {
  await withDbTransaction((db) => {
    for (const n of db.notifications) {
      if (id === 'all' || n.id === id) {
        n.read = true;
      }
    }
  });
}

/**
 * Generates live smart notifications (today's returns, upcoming 3 days, overdue) dynamically
 * combined with persisted incident/import notifications.
 */
export function computeSmartNotifications(db: LibraryDatabase): NotificationItem[] {
  const today = getTodayTashkent();
  const dynamic: NotificationItem[] = [];
  const studentMap = new Map(db.students.map((s) => [s.id, s]));
  const teacherMap = new Map((db.teachers ?? []).map((t) => [t.id, t]));
  const bookMap = new Map(db.bookTitles.map((b) => [b.id, b]));

  const activeLoans = db.loans.filter((l) => l.status === 'active');
  const overdue = activeLoans.filter((l) => classifyLoanDeadline(l, today).bucket === 'overdue');
  const dueToday = activeLoans.filter((l) => classifyLoanDeadline(l, today).bucket === 'due_today');
  const dueSoon = activeLoans.filter((l) => {
    const b = classifyLoanDeadline(l, today).bucket;
    return b === 'due_tomorrow' || b === 'due_soon_3d';
  });

  if (overdue.length > 0) {
    const first = overdue[0];
    const borrowerName =
      first.borrowerType === 'teacher'
        ? (first.teacherId ? teacherMap.get(first.teacherId)?.fullName : undefined) ?? 'O‘qituvchi'
        : (first.studentId ? studentMap.get(first.studentId)?.fullName : undefined) ?? 'O‘quvchi';
    dynamic.push({
      id: `dyn_overdue_${today}`,
      type: 'overdue',
      title: `${overdue.length} ta kitobning muddati o‘tgan`,
      message: `${borrowerName} — "${bookMap.get(first.bookTitleId)?.title ?? 'Kitob'}" va boshqalar.`,
      read: false,
      link: '/deadlines',
      createdAt: new Date().toISOString(),
    });
  }
  if (dueToday.length > 0) {
    dynamic.push({
      id: `dyn_today_${today}`,
      type: 'due_today',
      title: `Bugun ${dueToday.length} ta kitob qaytarilishi kerak`,
      message: `Qaytarish muddatlari bo‘limida bugungi ro‘yxatni ko‘ring.`,
      read: false,
      link: '/deadlines',
      createdAt: new Date().toISOString(),
    });
  }
  if (dueSoon.length > 0) {
    dynamic.push({
      id: `dyn_soon_${today}`,
      type: 'upcoming',
      title: `Yaqin 3 kunda ${dueSoon.length} ta qaytarish kutilmoqda`,
      message: `O‘quvchi va o‘qituvchilarga eslatma berish uchun muddatlar jadvalini tekshiring.`,
      read: false,
      link: '/deadlines',
      createdAt: new Date().toISOString(),
    });
  }

  return [...dynamic, ...db.notifications.slice(0, 30)];
}

export function buildDashboardSummary(db: LibraryDatabase) {
  const today = getTodayTashkent();

  let totalConfirmedCopies = 0;
  let availableCopies = 0;
  let issuedCopies = 0;
  for (const c of db.physicalCopies) {
    if (c.confirmed && c.status !== 'archived') {
      totalConfirmedCopies++;
      if (c.status === 'available') availableCopies++;
      else if (c.status === 'issued') issuedCopies++;
    }
  }

  const dueToday: Loan[] = [];
  const overdue: Loan[] = [];
  const activeBorrowers = new Set<string>();
  const issuedByDate = new Map<string, number>();
  const returnedByDate = new Map<string, number>();
  const borrowCounts = new Map<string, number>();

  for (const l of db.loans) {
    borrowCounts.set(l.bookTitleId, (borrowCounts.get(l.bookTitleId) ?? 0) + 1);
    if (l.issuedDate) {
      issuedByDate.set(l.issuedDate, (issuedByDate.get(l.issuedDate) ?? 0) + 1);
    }
    if (l.returnedDate) {
      returnedByDate.set(l.returnedDate, (returnedByDate.get(l.returnedDate) ?? 0) + 1);
    }
    if (l.status === 'active') {
      activeBorrowers.add(
        l.borrowerType === 'teacher' ? `tch:${l.teacherId ?? ''}` : `stu:${l.studentId ?? ''}`
      );
      const bucket = classifyLoanDeadline(l, today).bucket;
      if (bucket === 'due_today') dueToday.push(l);
      else if (bucket === 'overdue') overdue.push(l);
    }
  }

  let totalCatalogRecords = 0;
  const booksNeedingReview: BookTitle[] = [];
  const bookById = new Map<string, BookTitle>();
  for (const b of db.bookTitles) {
    bookById.set(b.id, b);
    if (b.reviewStatus !== 'archived') totalCatalogRecords++;
    if (b.reviewStatus === 'needs_review') booksNeedingReview.push(b);
  }

  // 14-day daily issue/return activity chart from REAL loans (O(1) map lookups)
  const activitySeries: Array<{ date: string; label: string; berilgan: number; qaytarilgan: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDaysYmd(today, -i);
    activitySeries.push({
      date: d,
      label: `${d.slice(8, 10)}.${d.slice(5, 7)}`,
      berilgan: issuedByDate.get(d) ?? 0,
      qaytarilgan: returnedByDate.get(d) ?? 0,
    });
  }

  // Most borrowed books from REAL loans (O(1) book lookup)
  const topBooks = Array.from(borrowCounts.entries())
    .map(([bookTitleId, count]) => {
      const book = bookById.get(bookTitleId);
      return {
        bookTitleId,
        title: book?.title ?? 'Noma’lum kitob',
        author: book?.author ?? '',
        count,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  let totalStudents = 0;
  for (const s of db.students) {
    if (s.status === 'active') totalStudents++;
  }
  let totalTeachers = 0;
  for (const t of db.teachers ?? []) {
    if (t.status === 'active') totalTeachers++;
  }

  return {
    today,
    stats: {
      totalConfirmedCopies,
      availableCopies,
      issuedCopies,
      dueTodayCount: dueToday.length,
      overdueCount: overdue.length,
      activeBorrowersCount: activeBorrowers.size,
      totalCatalogRecords,
      needsReviewCount: booksNeedingReview.length,
      totalStudents,
      totalTeachers,
    },
    dueTodayLoans: dueToday.slice(0, 10),
    overdueLoans: overdue.slice(0, 10),
    recentActivities: db.activityLogs.slice(0, 12),
    activitySeries,
    topBooks,
    reviewSample: booksNeedingReview.slice(0, 10),
  };
}
