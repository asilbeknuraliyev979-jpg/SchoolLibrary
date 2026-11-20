import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth-server';
import { buildDashboardSummary, computeSmartNotifications, readDb } from '@/lib/server-store';

export async function GET() {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Avtorizatsiya talab qilinadi.' }, { status: 401 });
  }

  const db = readDb();
  const dashboard = buildDashboardSummary(db);
  const notifications = computeSmartNotifications(db);

  return NextResponse.json({
    user: session,
    settings: db.settings,
    dashboard,
    notifications,
    students: db.students,
    teachers: db.teachers ?? [],
    studentImportBackups: (db.studentImportBackups ?? []).map((b) => ({
      id: b.id,
      fileName: b.fileName,
      createdAt: b.createdAt,
      actorName: b.actorName,
      summary: b.summary,
    })),
    bookTitles: db.bookTitles,
    physicalCopies: db.physicalCopies,
    importBatches: db.importBatches,
    sourceInventoryRecords: db.sourceInventoryRecords,
    loans: db.loans,
    loanExtensions: db.loanExtensions,
    inventoryIncidents: db.inventoryIncidents,
    activityLogs: db.activityLogs,
  });
}
