import { NextRequest, NextResponse } from 'next/server';
import { getServerSession, isInitialSetupRequired } from '@/lib/auth-server';
import { buildDashboardSummary, computeSmartNotifications, readDb } from '@/lib/server-store';

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json(
      {
        error: 'Avtorizatsiya talab qilinadi.',
        authenticated: false,
        setupRequired: isInitialSetupRequired(),
      },
      { status: 401 }
    );
  }

  const includeFull = req.nextUrl.searchParams.get('full') === '1';
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
    // Raw Excel source rows & full 2000-entry audit log are heavy and only needed on /import or /history
    sourceInventoryRecords: includeFull ? db.sourceInventoryRecords : [],
    loans: db.loans,
    loanExtensions: db.loanExtensions,
    inventoryIncidents: db.inventoryIncidents,
    activityLogs: includeFull ? db.activityLogs : db.activityLogs.slice(0, 50),
    isFullPayload: includeFull,
  });
}
