export type ReviewStatus = 'confirmed' | 'needs_review' | 'archived';

export type ReviewIssueCode =
  | 'range_ambiguous'
  | 'duplicate_inventory'
  | 'invalid_year'
  | 'missing_inventory_number'
  | 'uncertain_author_split'
  | 'missing_year';

export type ValidationStatus =
  | 'confirmed'
  | 'needs_review'
  | 'skipped_subtotal'
  | 'skipped_date_only'
  | 'skipped_empty'
  | 'error';

export type CopyStatus = 'available' | 'issued' | 'damaged' | 'lost' | 'archived';

export type LoanStatus = 'active' | 'returned';

export type ReturnCondition = 'good' | 'damaged' | 'lost';

export type DeadlineBucket =
  | 'returned'
  | 'overdue'
  | 'due_today'
  | 'due_tomorrow'
  | 'due_soon_3d'
  | 'in_progress';

export interface LibrarianProfile {
  id: string;
  username: string;
  displayName: string;
  role: 'librarian' | 'admin';
  schoolName: string;
  mustChangePassword: boolean;
  authProvider: 'credentials' | 'google';
  email?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Student {
  id: string;
  internalStudentId: string;
  schoolStudentNumber: string;
  fullName: string;
  className: string;
  registeredAt: string;
  status: 'active' | 'archived';
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface RawInventoryColumns {
  col1_dateCount: string;
  col2_inventoryNumber: string;
  col3_stockCheck: string;
  col4_authorTitle: string;
  col5_publicationYear: string;
  col6_price: string;
  col7_summaryBookNumber: string;
  col8_department: string;
  col9_writeOffAct: string;
  col10_note: string;
}

export interface BookTitle {
  id: string;
  title: string;
  author: string;
  authorSplitConfidence: 'confirmed' | 'high' | 'uncertain' | 'none';
  originalAuthorTitle: string;
  inventoryNumberRaw: string;
  publicationYearRaw: string;
  publicationYear: number | null;
  departmentCode: string;
  priceRaw: string;
  dateRecordedRaw: string;
  reviewStatus: ReviewStatus;
  reviewIssues: ReviewIssueCode[];
  sourceRecordId: string | null;
  sourceRowNumber: number | null;
  isRangeRecord: boolean;
  rangeStart: number | null;
  rangeEnd: number | null;
  rangeConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PhysicalCopy {
  id: string;
  bookTitleId: string;
  internalCopyCode: string;
  originalInventoryNumber: string;
  barcode: string;
  status: CopyStatus;
  confirmed: boolean;
  sourceRecordId: string | null;
  activeLoanId: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImportBatch {
  id: string;
  fileName: string;
  sheetName: string;
  fileChecksum: string;
  totalRowsScanned: number;
  bookRowsCount: number;
  confirmedCount: number;
  needsReviewCount: number;
  skippedCount: number;
  skippedSubtotalCount: number;
  skippedDateOnlyCount: number;
  duplicateInventoryCount: number;
  rangeRecordCount: number;
  invalidYearCount: number;
  missingInventoryCount: number;
  errorCount: number;
  status: 'completed' | 'failed';
  createdAt: string;
}

export interface SourceInventoryRecord {
  id: string;
  importBatchId: string;
  sourceFileName: string;
  sourceSheet: string;
  sourceRowNumber: number;
  rawColumns: RawInventoryColumns;
  normalizedValues: {
    title: string;
    author: string;
    publicationYear: number | null;
    departmentCode: string;
    inventoryNumberRaw: string;
    isRange: boolean;
  };
  validationStatus: ValidationStatus;
  issues: ReviewIssueCode[];
  reviewNotes: string;
  bookTitleId: string | null;
  importedAt: string;
  updatedAt: string;
}

export interface Loan {
  id: string;
  studentId: string;
  bookTitleId: string;
  physicalCopyId: string;
  issuedDate: string; // YYYY-MM-DD in Asia/Tashkent
  dueDate: string;    // YYYY-MM-DD in Asia/Tashkent
  returnedDate: string | null;
  status: LoanStatus;
  returnCondition: ReturnCondition | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoanExtension {
  id: string;
  loanId: string;
  previousDueDate: string;
  newDueDate: string;
  reason: string;
  actorName: string;
  createdAt: string;
}

export interface InventoryIncident {
  id: string;
  physicalCopyId: string;
  bookTitleId: string;
  loanId: string | null;
  studentId: string | null;
  incidentType: 'damaged' | 'lost';
  notes: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationItem {
  id: string;
  type: 'due_today' | 'upcoming' | 'overdue' | 'incident' | 'import_error' | 'info';
  title: string;
  message: string;
  read: boolean;
  link?: string;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  actorName: string;
  createdAt: string;
}

export interface LibrarySettings {
  schoolName: string;
  librarianName: string;
  defaultLoanDays: number;
  maxBooksPerStudent: number;
  timezone: string;
  updatedAt: string;
}

export interface LibraryDatabase {
  settings: LibrarySettings;
  students: Student[];
  bookTitles: BookTitle[];
  physicalCopies: PhysicalCopy[];
  importBatches: ImportBatch[];
  sourceInventoryRecords: SourceInventoryRecord[];
  loans: Loan[];
  loanExtensions: LoanExtension[];
  inventoryIncidents: InventoryIncident[];
  notifications: NotificationItem[];
  activityLogs: ActivityLog[];
}

export interface ParsedRowPreview {
  sourceRowNumber: number;
  rawColumns: RawInventoryColumns;
  validationStatus: ValidationStatus;
  issues: ReviewIssueCode[];
  suggestedTitle: string;
  suggestedAuthor: string;
  authorSplitConfidence: 'high' | 'uncertain' | 'none';
  publicationYear: number | null;
  isRange: boolean;
  rangeStart: number | null;
  rangeEnd: number | null;
  reviewNotes: string;
}

export interface ImportPreviewResult {
  fileName: string;
  sheetName: string;
  fileChecksum: string;
  alreadyImported: boolean;
  existingBatchId?: string;
  totalRowsScanned: number;
  bookRowsCount: number;
  clearSingleRecordsCount: number;
  needsReviewCount: number;
  skippedSubtotalCount: number;
  skippedDateOnlyCount: number;
  skippedEmptyCount: number;
  duplicateInventoryCount: number;
  rangeRecordCount: number;
  invalidYearCount: number;
  missingInventoryCount: number;
  errorCount: number;
  rows: ParsedRowPreview[];
}
