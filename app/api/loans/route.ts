import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth-server';
import {
  extendLoanDeadline,
  issueClassBulkDistribution,
  issueLoansTransactional,
  returnLoanTransactional,
} from '@/lib/server-store';
import type { ReturnCondition } from '@/lib/types';

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Avtorizatsiya talab qilinadi.' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const action = String(body?.action ?? '');

    if (action === 'issue') {
      const loans = await issueLoansTransactional(
        {
          borrowerType: body.borrowerType === 'teacher' ? 'teacher' : 'student',
          studentId: body.studentId ? String(body.studentId) : undefined,
          teacherId: body.teacherId ? String(body.teacherId) : undefined,
          physicalCopyIds: Array.isArray(body.physicalCopyIds)
            ? body.physicalCopyIds.map(String)
            : body.physicalCopyId
              ? [String(body.physicalCopyId)]
              : [],
          issuedDate: body.issuedDate ? String(body.issuedDate) : undefined,
          dueDate: String(body.dueDate ?? ''),
          notes: body.notes ? String(body.notes) : '',
        },
        session.displayName
      );
      return NextResponse.json({ loans });
    }

    if (action === 'class_bulk_issue') {
      const assignments = Array.isArray(body.assignments)
        ? body.assignments.map((a: { studentId: string; physicalCopyId: string }) => ({
            studentId: String(a.studentId),
            physicalCopyId: String(a.physicalCopyId),
          }))
        : [];
      const loans = await issueClassBulkDistribution(
        {
          assignments,
          issuedDate: body.issuedDate ? String(body.issuedDate) : undefined,
          dueDate: String(body.dueDate ?? ''),
          notes: body.notes ? String(body.notes) : '',
        },
        session.displayName
      );
      return NextResponse.json({ loans });
    }

    if (action === 'return') {
      const condition = String(body.condition ?? 'good') as ReturnCondition;
      if (!['good', 'damaged', 'lost'].includes(condition)) {
        return NextResponse.json({ error: 'Qaytarish holati noto‘g‘ri.' }, { status: 400 });
      }
      const result = await returnLoanTransactional(
        {
          loanId: String(body.loanId ?? ''),
          returnedDate: body.returnedDate ? String(body.returnedDate) : undefined,
          condition,
          notes: body.notes ? String(body.notes) : '',
        },
        session.displayName
      );
      return NextResponse.json(result);
    }

    if (action === 'extend') {
      const result = await extendLoanDeadline(
        {
          loanId: String(body.loanId ?? ''),
          newDueDate: String(body.newDueDate ?? ''),
          reason: String(body.reason ?? ''),
        },
        session.displayName
      );
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Noma’lum amal.' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Kitob berish/qaytarish amalida xatolik.' },
      { status: 400 }
    );
  }
}
