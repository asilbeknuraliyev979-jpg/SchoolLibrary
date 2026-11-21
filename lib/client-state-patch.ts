import { classifyLoanDeadline } from './date-utils';
import type {
  BookTitle,
  InventoryIncident,
  Loan,
  PhysicalCopy,
  Student,
  Teacher,
} from './types';
import type { LibraryStatePayload } from '@/components/library-context';

/**
 * Recomputes lightweight dashboard KPI counters locally after a targeted state patch
 * so mutations never require a full GET /api/library/state round-trip.
 */
function recomputeDashboardStats(
  prev: LibraryStatePayload,
  next: {
    students?: Student[];
    teachers?: Teacher[];
    bookTitles?: BookTitle[];
    physicalCopies?: PhysicalCopy[];
    loans?: Loan[];
  }
): LibraryStatePayload['dashboard'] {
  const students = next.students ?? prev.students;
  const teachers = next.teachers ?? prev.teachers;
  const bookTitles = next.bookTitles ?? prev.bookTitles;
  const physicalCopies = next.physicalCopies ?? prev.physicalCopies;
  const loans = next.loans ?? prev.loans;
  const today = prev.dashboard.today;

  let totalConfirmedCopies = 0;
  let availableCopies = 0;
  let issuedCopies = 0;
  for (const c of physicalCopies) {
    if (c.confirmed && c.status !== 'archived') {
      totalConfirmedCopies++;
      if (c.status === 'available') availableCopies++;
      else if (c.status === 'issued') issuedCopies++;
    }
  }

  let dueTodayCount = 0;
  let overdueCount = 0;
  const activeBorrowers = new Set<string>();
  const dueTodayLoans: Loan[] = [];
  const overdueLoans: Loan[] = [];

  for (const l of loans) {
    if (l.status !== 'active') continue;
    activeBorrowers.add(
      l.borrowerType === 'teacher' ? `tch:${l.teacherId ?? ''}` : `stu:${l.studentId ?? ''}`
    );
    const bucket = classifyLoanDeadline(l, today).bucket;
    if (bucket === 'due_today') {
      dueTodayCount++;
      if (dueTodayLoans.length < 10) dueTodayLoans.push(l);
    } else if (bucket === 'overdue') {
      overdueCount++;
      if (overdueLoans.length < 10) overdueLoans.push(l);
    }
  }

  let totalCatalogRecords = 0;
  let needsReviewCount = 0;
  for (const b of bookTitles) {
    if (b.reviewStatus !== 'archived') totalCatalogRecords++;
    if (b.reviewStatus === 'needs_review') needsReviewCount++;
  }

  let totalStudents = 0;
  for (const s of students) {
    if (s.status === 'active') totalStudents++;
  }

  let totalTeachers = 0;
  for (const t of teachers) {
    if (t.status === 'active') totalTeachers++;
  }

  return {
    ...prev.dashboard,
    stats: {
      ...prev.dashboard.stats,
      totalConfirmedCopies,
      availableCopies,
      issuedCopies,
      dueTodayCount,
      overdueCount,
      activeBorrowersCount: activeBorrowers.size,
      totalCatalogRecords,
      needsReviewCount,
      totalStudents,
      totalTeachers,
    },
    dueTodayLoans,
    overdueLoans,
  };
}

/**
 * Optimistically marks an active loan as returned in local client state
 * (and later reconciles with server-returned loan/copy/incident).
 */
export function patchLoanReturned(
  prev: LibraryStatePayload,
  params: {
    loanId: string;
    returnedDate?: string;
    loan?: Loan;
    copy?: PhysicalCopy;
    incident?: InventoryIncident | null;
  }
): LibraryStatePayload {
  const returnedDate = params.loan?.returnedDate ?? params.returnedDate ?? prev.dashboard.today;
  let targetCopyId: string | null = params.copy?.id ?? null;

  const loans = prev.loans.map((l) => {
    if (l.id !== params.loanId) return l;
    targetCopyId = targetCopyId ?? l.physicalCopyId;
    if (params.loan) return params.loan;
    return {
      ...l,
      status: 'returned' as const,
      returnedDate,
      returnCondition: 'good' as const,
      updatedAt: new Date().toISOString(),
    };
  });

  const physicalCopies = targetCopyId
    ? prev.physicalCopies.map((c) => {
        if (c.id !== targetCopyId) return c;
        if (params.copy) return params.copy;
        return {
          ...c,
          status: 'available' as const,
          activeLoanId: null,
          updatedAt: new Date().toISOString(),
        };
      })
    : prev.physicalCopies;

  const inventoryIncidents = params.incident
    ? [params.incident, ...prev.inventoryIncidents]
    : prev.inventoryIncidents;

  return {
    ...prev,
    loans,
    physicalCopies,
    inventoryIncidents,
    dashboard: recomputeDashboardStats(prev, { loans, physicalCopies }),
  };
}

export function patchLoansIssued(
  prev: LibraryStatePayload,
  createdLoans: Loan[]
): LibraryStatePayload {
  if (createdLoans.length === 0) return prev;
  const copyToLoan = new Map<string, string>();
  for (const l of createdLoans) {
    copyToLoan.set(l.physicalCopyId, l.id);
  }
  const now = new Date().toISOString();
  const loans = [...createdLoans, ...prev.loans];
  const physicalCopies = prev.physicalCopies.map((c) => {
    const loanId = copyToLoan.get(c.id);
    if (!loanId) return c;
    return { ...c, status: 'issued' as const, activeLoanId: loanId, updatedAt: now };
  });

  return {
    ...prev,
    loans,
    physicalCopies,
    dashboard: recomputeDashboardStats(prev, { loans, physicalCopies }),
  };
}

export function patchBookCreated(
  prev: LibraryStatePayload,
  book: BookTitle,
  copies: PhysicalCopy[]
): LibraryStatePayload {
  const bookTitles = [book, ...prev.bookTitles];
  const physicalCopies = copies.length > 0 ? [...prev.physicalCopies, ...copies] : prev.physicalCopies;
  return {
    ...prev,
    bookTitles,
    physicalCopies,
    dashboard: recomputeDashboardStats(prev, { bookTitles, physicalCopies }),
  };
}

export function patchBookUpdated(
  prev: LibraryStatePayload,
  updatedBook: BookTitle
): LibraryStatePayload {
  const bookTitles = prev.bookTitles.map((b) => (b.id === updatedBook.id ? updatedBook : b));
  return {
    ...prev,
    bookTitles,
    dashboard: recomputeDashboardStats(prev, { bookTitles }),
  };
}

export function patchCopiesAdded(
  prev: LibraryStatePayload,
  updatedBook: BookTitle,
  createdCopies: PhysicalCopy[]
): LibraryStatePayload {
  const bookTitles = prev.bookTitles.map((b) => (b.id === updatedBook.id ? updatedBook : b));
  const physicalCopies =
    createdCopies.length > 0 ? [...prev.physicalCopies, ...createdCopies] : prev.physicalCopies;
  return {
    ...prev,
    bookTitles,
    physicalCopies,
    dashboard: recomputeDashboardStats(prev, { bookTitles, physicalCopies }),
  };
}

export function patchStudentCreated(
  prev: LibraryStatePayload,
  student: Student
): LibraryStatePayload {
  const students = [student, ...prev.students];
  return {
    ...prev,
    students,
    dashboard: recomputeDashboardStats(prev, { students }),
  };
}

export function patchTeacherUpserted(
  prev: LibraryStatePayload,
  teacher: Teacher
): LibraryStatePayload {
  const exists = prev.teachers.some((t) => t.id === teacher.id);
  const teachers = exists
    ? prev.teachers.map((t) => (t.id === teacher.id ? teacher : t))
    : [teacher, ...prev.teachers];
  return {
    ...prev,
    teachers,
    dashboard: recomputeDashboardStats(prev, { teachers }),
  };
}
