import test from 'node:test';
import assert from 'node:assert/strict';
import type { LibraryStatePayload } from '@/components/library-context';
import {
  patchBookCreated,
  patchBookUpdated,
  patchCopiesAdded,
  patchLoanReturned,
  patchLoansIssued,
  patchStudentCreated,
  patchTeacherUpserted,
} from './client-state-patch';
import { compareClassNames, compareUzText } from './utils';

function makeBaseState(): LibraryStatePayload {
  const now = '2026-11-20T00:00:00.000Z';
  return {
    user: {
      id: 'librarian_nodira',
      username: 'nodira.library',
      displayName: 'Nodira',
      role: 'librarian',
      schoolName: 'Test Maktab',
      mustChangePassword: false,
      authProvider: 'credentials',
      createdAt: now,
      updatedAt: now,
    },
    settings: {
      schoolName: 'Test Maktab',
      librarianName: 'Nodira',
      defaultLoanDays: 14,
      maxBooksPerStudent: 5,
      timezone: 'Asia/Tashkent',
      updatedAt: now,
    },
    dashboard: {
      today: '2026-11-20',
      stats: {
        totalConfirmedCopies: 1,
        availableCopies: 1,
        issuedCopies: 0,
        dueTodayCount: 0,
        overdueCount: 0,
        activeBorrowersCount: 0,
        totalCatalogRecords: 1,
        needsReviewCount: 0,
        totalStudents: 1,
        totalTeachers: 0,
      },
      dueTodayLoans: [],
      overdueLoans: [],
      recentActivities: [],
      activitySeries: [],
      topBooks: [],
      reviewSample: [],
    },
    notifications: [],
    students: [
      {
        id: 'stu_1',
        internalStudentId: 'STU-0001',
        schoolStudentNumber: '',
        fullName: 'Aliyev Vali',
        className: '7-A',
        registeredAt: '2026-11-01',
        status: 'active',
        notes: '',
        createdAt: now,
        updatedAt: now,
      },
    ],
    teachers: [],
    studentImportBackups: [],
    bookTitles: [
      {
        id: 'book_1',
        title: 'O‘tkan kunlar',
        author: 'Abdulla Qodiriy',
        authorSplitConfidence: 'confirmed',
        originalAuthorTitle: 'O‘tkan kunlar Abdulla Qodiriy',
        inventoryNumberRaw: '1001',
        publicationYearRaw: '2020',
        publicationYear: 2020,
        departmentCode: '84',
        priceRaw: '',
        dateRecordedRaw: '2026-11-01',
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
      },
    ],
    physicalCopies: [
      {
        id: 'copy_1',
        bookTitleId: 'book_1',
        internalCopyCode: 'SL-00001',
        originalInventoryNumber: '1001',
        barcode: 'SL-00001',
        status: 'available',
        confirmed: true,
        sourceRecordId: null,
        activeLoanId: null,
        notes: '',
        createdAt: now,
        updatedAt: now,
      },
    ],
    importBatches: [],
    sourceInventoryRecords: [],
    loans: [],
    loanExtensions: [],
    inventoryIncidents: [],
    activityLogs: [],
  };
}

test('patchLoansIssued and patchLoanReturned keep copies and KPI stats consistent', () => {
  const base = makeBaseState();
  const now = '2026-11-20T00:00:00.000Z';

  const issued = patchLoansIssued(base, [
    {
      id: 'loan_1',
      borrowerType: 'student',
      studentId: 'stu_1',
      teacherId: null,
      bookTitleId: 'book_1',
      physicalCopyId: 'copy_1',
      issuedDate: '2026-11-10',
      dueDate: '2026-11-15', // overdue relative to 2026-11-20
      returnedDate: null,
      status: 'active',
      returnCondition: null,
      notes: '',
      createdAt: now,
      updatedAt: now,
    },
  ]);

  assert.equal(issued.loans.length, 1);
  assert.equal(issued.physicalCopies[0].status, 'issued');
  assert.equal(issued.physicalCopies[0].activeLoanId, 'loan_1');
  assert.equal(issued.dashboard.stats.issuedCopies, 1);
  assert.equal(issued.dashboard.stats.availableCopies, 0);
  assert.equal(issued.dashboard.stats.overdueCount, 1);

  const returned = patchLoanReturned(issued, { loanId: 'loan_1' });
  assert.equal(returned.loans[0].status, 'returned');
  assert.equal(returned.loans[0].returnedDate, '2026-11-20');
  assert.equal(returned.physicalCopies[0].status, 'available');
  assert.equal(returned.physicalCopies[0].activeLoanId, null);
  assert.equal(returned.dashboard.stats.issuedCopies, 0);
  assert.equal(returned.dashboard.stats.availableCopies, 1);
  assert.equal(returned.dashboard.stats.overdueCount, 0);
});

test('patchBookCreated, patchBookUpdated, patchCopiesAdded update catalog and counts', () => {
  const base = makeBaseState();
  const now = '2026-11-20T00:00:00.000Z';
  const newBook = { ...base.bookTitles[0], id: 'book_2', title: 'Mehrobdan chayon' };
  const newCopy = { ...base.physicalCopies[0], id: 'copy_2', bookTitleId: 'book_2' };

  const afterCreate = patchBookCreated(base, newBook, [newCopy]);
  assert.equal(afterCreate.bookTitles.length, 2);
  assert.equal(afterCreate.dashboard.stats.totalCatalogRecords, 2);
  assert.equal(afterCreate.dashboard.stats.totalConfirmedCopies, 2);

  const afterUpdate = patchBookUpdated(afterCreate, { ...newBook, title: 'Mehrobdan chayon (2-nashr)' });
  assert.equal(afterUpdate.bookTitles[0].title, 'Mehrobdan chayon (2-nashr)');

  const extraCopy = { ...newCopy, id: 'copy_3', internalCopyCode: 'SL-00003' };
  const afterCopies = patchCopiesAdded(afterUpdate, newBook, [extraCopy]);
  assert.equal(afterCopies.physicalCopies.length, 3);
  assert.equal(afterCopies.dashboard.stats.totalConfirmedCopies, 3);
});

test('patchStudentCreated and patchTeacherUpserted update active counts cleanly', () => {
  const base = makeBaseState();
  const now = '2026-11-20T00:00:00.000Z';

  const withStudent = patchStudentCreated(base, {
    ...base.students[0],
    id: 'stu_2',
    fullName: 'Karimova Madina',
    className: '8-B',
  });
  assert.equal(withStudent.dashboard.stats.totalStudents, 2);

  const teacher = {
    id: 'tch_1',
    internalTeacherId: 'TCH-0001',
    fullName: 'Rustamov Sardor',
    position: 'Matematika',
    registeredAt: '2026-11-20',
    status: 'active' as const,
    notes: '',
    createdAt: now,
    updatedAt: now,
  };
  const withTeacher = patchTeacherUpserted(withStudent, teacher);
  assert.equal(withTeacher.teachers.length, 1);
  assert.equal(withTeacher.dashboard.stats.totalTeachers, 1);

  const archivedTeacher = patchTeacherUpserted(withTeacher, { ...teacher, status: 'archived' });
  assert.equal(archivedTeacher.teachers.length, 1);
  assert.equal(archivedTeacher.dashboard.stats.totalTeachers, 0);
});

test('cached compareClassNames and compareUzText sort deterministically and quickly', () => {
  const classes = ['10-A', '5-B', '5-A', '11-V', '7-A', '9-G'];
  classes.sort(compareClassNames);
  assert.deepEqual(classes, ['5-A', '5-B', '7-A', '9-G', '10-A', '11-V']);
  assert.ok(compareUzText('Abdullayev', 'Zokirov') < 0);
});
