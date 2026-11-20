import type { Loan, Student, Teacher } from './types';

export interface ResolvedBorrower {
  type: 'student' | 'teacher';
  typeLabel: string;
  groupLabel: string; // Student className (e.g. "7-A") OR Teacher position (e.g. "Matematika o‘qituvchisi")
  fullName: string;
  badgeText: string; // Student className OR "O‘qituvchi"
}

export function resolveLoanBorrower(
  loan: Loan,
  studentMap: Map<string, Student>,
  teacherMap: Map<string, Teacher>
): ResolvedBorrower {
  if (loan.borrowerType === 'teacher') {
    const teacher = loan.teacherId ? teacherMap.get(loan.teacherId) : undefined;
    return {
      type: 'teacher',
      typeLabel: 'O‘qituvchi',
      groupLabel: teacher?.position ?? 'O‘qituvchi',
      fullName: teacher?.fullName ?? '—',
      badgeText: 'O‘qituvchi',
    };
  }
  const student = loan.studentId ? studentMap.get(loan.studentId) : undefined;
  return {
    type: 'student',
    typeLabel: 'O‘quvchi',
    groupLabel: student?.className ?? '—',
    fullName: student?.fullName ?? '—',
    badgeText: student?.className ?? '—',
  };
}
