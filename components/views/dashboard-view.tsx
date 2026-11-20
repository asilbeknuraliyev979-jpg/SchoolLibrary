'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BookCheck,
  BookMarked,
  BookOpen,
  BookUp2,
  Check,
  Download,
  FileSpreadsheet,
  RotateCcw,
  Search,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLibrary } from '@/components/library-context';
import { Button, Input, PanelCard, SelectField, StatusText } from '@/components/ui/primitives';
import { authFetch } from '@/lib/api-client';
import { classifyLoanDeadline, formatYmdDisplay, getTodayTashkent } from '@/lib/date-utils';
import { compareClassNames } from '@/lib/utils';

export function DashboardView() {
  const { data, refreshData, downloadFullXlsx, downloadTableXlsx } = useLibrary();
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const today = data?.dashboard.today ?? getTodayTashkent();

  const studentMap = useMemo(
    () => new Map((data?.students ?? []).map((s) => [s.id, s])),
    [data?.students]
  );
  const bookMap = useMemo(
    () => new Map((data?.bookTitles ?? []).map((b) => [b.id, b])),
    [data?.bookTitles]
  );
  const copyMap = useMemo(
    () => new Map((data?.physicalCopies ?? []).map((c) => [c.id, c])),
    [data?.physicalCopies]
  );

  const activeLoans = useMemo(
    () => (data?.loans ?? []).filter((l) => l.status === 'active'),
    [data?.loans]
  );
  const returnedLoans = useMemo(
    () => (data?.loans ?? []).filter((l) => l.status === 'returned'),
    [data?.loans]
  );
  const overdueLoans = useMemo(
    () => activeLoans.filter((l) => classifyLoanDeadline(l, today).bucket === 'overdue'),
    [activeLoans, today]
  );

  const classes = useMemo(() => {
    const set = new Set<string>();
    for (const s of data?.students ?? []) {
      if (s.status === 'active' && s.className) set.add(s.className);
    }
    return Array.from(set).sort(compareClassNames);
  }, [data?.students]);

  const tableRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeLoans
      .map((loan) => {
        const student = studentMap.get(loan.studentId);
        const book = bookMap.get(loan.bookTitleId);
        const copy = copyMap.get(loan.physicalCopyId);
        const dl = classifyLoanDeadline(loan, today);
        return { loan, student, book, copy, dl };
      })
      .filter(({ student, book, copy }) => {
        if (classFilter && student?.className !== classFilter) return false;
        if (!q) return true;
        const hay = [
          student?.fullName,
          student?.className,
          book?.title,
          book?.author,
          copy?.originalInventoryNumber,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => a.loan.dueDate.localeCompare(b.loan.dueDate));
  }, [activeLoans, bookMap, classFilter, copyMap, search, studentMap, today]);

  if (!data) {
    return <p className="text-xs text-[#64748B]">Ma’lumotlar yuklanmoqda...</p>;
  }

  async function handleQuickImportBooks() {
    setBusyAction('books');
    try {
      const res = await authFetch('/api/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          useAttachedWorkbook: true,
          autoConfirmClearSingleCopies: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Importda xatolik yuz berdi.');
      if (json.skippedDuplicateFile) {
        toast.info('Inventar.xlsx fayli avval import qilingan.');
      } else {
        toast.success(`${json.batch?.bookRowsCount ?? 0} ta kitob yozuvi import qilindi.`);
      }
      await refreshData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleQuickImportStudents() {
    setBusyAction('students');
    try {
      const res = await authFetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import_attached' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'O‘quvchilarni import qilishda xatolik.');
      if (json.imported === 0 && json.skipped > 0) {
        toast.info(`Barcha ${json.skipped} nafar o‘quvchi avval import qilingan.`);
      } else {
        toast.success(`${json.imported} nafar o‘quvchi import qilindi.`);
      }
      await refreshData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleQuickReturn(loanId: string) {
    setBusyAction(loanId);
    try {
      const res = await authFetch('/api/loans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'return', loanId, condition: 'good' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Qaytarishda xatolik.');
      toast.success('Kitob qaytarildi.');
      await refreshData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setBusyAction(null);
    }
  }

  function handleExportTable() {
    void downloadTableXlsx({
      fileName: `Faol_kitoblar_${today}.xlsx`,
      sheetName: 'Faol kitoblar',
      headers: ['Sinf', 'O‘quvchi', 'Kitob nomi', 'Inventar №', 'Berilgan sana', 'Qaytarish sanasi', 'Holat'],
      rows: tableRows.map(({ loan, student, book, copy, dl }) => [
        student?.className ?? '—',
        student?.fullName ?? '—',
        book?.title ?? '—',
        copy?.originalInventoryNumber || copy?.internalCopyCode || '—',
        formatYmdDisplay(loan.issuedDate),
        formatYmdDisplay(loan.dueDate),
        dl.bucket === 'overdue'
          ? `${Math.abs(dl.deltaDays)} kun kechikkan`
          : dl.bucket === 'due_today'
            ? 'Bugun qaytariladi'
            : 'Faol',
      ]),
      columnWidths: [10, 32, 38, 16, 15, 16, 18],
    });
  }

  const needsBooks = data.bookTitles.length === 0;
  const needsStudents = data.students.filter((s) => s.status === 'active').length === 0;

  return (
    <div className="space-y-6">
      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <PanelCard className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#64748B]">Jami kitoblar</span>
            <BookMarked className="w-4 h-4 text-[#1E3A5F]" />
          </div>
          <div className="mt-2 text-2xl font-semibold text-[#0F172A] tabular-nums">
            {data.bookTitles.length.toLocaleString('uz-UZ')}
          </div>
          <div className="mt-1 text-[11px] text-[#64748B] tabular-nums">
            {data.dashboard.stats.totalConfirmedCopies.toLocaleString('uz-UZ')} tasdiqlangan nusxa
          </div>
        </PanelCard>

        <PanelCard className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#64748B]">Berilgan kitoblar</span>
            <BookOpen className="w-4 h-4 text-[#1E3A5F]" />
          </div>
          <div className="mt-2 text-2xl font-semibold text-[#1E3A5F] tabular-nums">
            {activeLoans.length.toLocaleString('uz-UZ')}
          </div>
          <div className="mt-1 text-[11px] text-[#64748B] tabular-nums">
            {data.students.filter((s) => s.status === 'active').length.toLocaleString('uz-UZ')} nafar o‘quvchi
          </div>
        </PanelCard>

        <PanelCard className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#64748B]">Qaytarilganlar</span>
            <BookCheck className="w-4 h-4 text-[#059669]" />
          </div>
          <div className="mt-2 text-2xl font-semibold text-[#059669] tabular-nums">
            {returnedLoans.length.toLocaleString('uz-UZ')}
          </div>
          <div className="mt-1 text-[11px] text-[#64748B]">Jami qaytarilgan kitoblar</div>
        </PanelCard>

        <PanelCard className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#64748B]">Muddati o‘tganlar</span>
            <AlertTriangle
              className={`w-4 h-4 ${overdueLoans.length > 0 ? 'text-[#DC2626]' : 'text-[#64748B]'}`}
            />
          </div>
          <div
            className={`mt-2 text-2xl font-semibold tabular-nums ${
              overdueLoans.length > 0 ? 'text-[#DC2626]' : 'text-[#0F172A]'
            }`}
          >
            {overdueLoans.length.toLocaleString('uz-UZ')}
          </div>
          <div className="mt-1 text-[11px] text-[#64748B]">Kechikkan qaytarishlar</div>
        </PanelCard>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap items-center gap-2.5">
        <Link href="/issue">
          <Button variant="primary">
            <BookUp2 className="w-4 h-4" />
            Kitob berish
          </Button>
        </Link>
        <Link href="/returns">
          <Button variant="outline">
            <RotateCcw className="w-4 h-4" />
            Qaytarish
          </Button>
        </Link>
        <Button variant="outline" onClick={() => void downloadFullXlsx()}>
          <Download className="w-4 h-4" />
          Umumiy hisobot (XLSX)
        </Button>
      </div>

      {/* One-Click Initial Import Strip (only shown until imported) */}
      {(needsBooks || needsStudents) && (
        <PanelCard className="p-4 border-[#CBD5E1] bg-[#F8FAFC]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[#0F172A]">Ma’lumotlarni yuklash</h2>
              <p className="text-xs text-[#64748B] mt-0.5">
                Maktabning tayyor fayllarini bir tugma bilan bazaga import qiling.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {needsBooks && (
                <Button
                  size="sm"
                  onClick={() => void handleQuickImportBooks()}
                  disabled={busyAction !== null}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  {busyAction === 'books' ? 'Yuklanmoqda...' : 'Inventar.xlsx import'}
                </Button>
              )}
              {needsStudents && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleQuickImportStudents()}
                  disabled={busyAction !== null}
                >
                  <Users className="w-3.5 h-3.5" />
                  {busyAction === 'students' ? 'Yuklanmoqda...' : '426 o‘quvchini import qilish'}
                </Button>
              )}
            </div>
          </div>
        </PanelCard>
      )}

      {/* Active & Overdue Loans Table */}
      <PanelCard className="overflow-hidden">
        <div className="p-4 border-b border-[#E2E8F0] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[#0F172A]">Faol berilgan kitoblar</h2>
            <span className="text-xs text-[#64748B] tabular-nums">({tableRows.length})</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-56">
              <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Qidirish..."
                aria-label="Faol kitoblarni qidirish"
                className="pl-8"
              />
            </div>
            <SelectField
              aria-label="Sinf bo‘yicha filtr"
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="w-full sm:w-36"
            >
              <option value="">Barcha sinflar</option>
              {classes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectField>
            <Button variant="outline" size="sm" onClick={handleExportTable}>
              <Download className="w-3.5 h-3.5" />
              XLSX
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#1E3A5F] text-white text-xs font-medium">
                <th className="py-2.5 px-4 whitespace-nowrap">Sinf</th>
                <th className="py-2.5 px-4 whitespace-nowrap">O‘quvchi</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Kitob</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Berilgan</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Qaytarish</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Holat</th>
                <th className="py-2.5 px-4 text-right whitespace-nowrap">Amal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-sm">
              {tableRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 px-4 text-center text-xs text-[#64748B]">
                    Hozircha faol berilgan kitoblar yo‘q.
                  </td>
                </tr>
              ) : (
                tableRows.slice(0, 15).map(({ loan, student, book, dl }) => (
                  <tr key={loan.id} className="hover:bg-[#F8FAFC]">
                    <td className="py-2.5 px-4 font-medium text-[#1E3A5F] whitespace-nowrap">
                      {student?.className ?? '—'}
                    </td>
                    <td className="py-2.5 px-4 text-[#0F172A]">{student?.fullName ?? '—'}</td>
                    <td className="py-2.5 px-4 text-[#334155] max-w-[280px] truncate">
                      {book?.title ?? '—'}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-[#64748B] tabular-nums whitespace-nowrap">
                      {formatYmdDisplay(loan.issuedDate)}
                    </td>
                    <td className="py-2.5 px-4 text-xs font-medium text-[#0F172A] tabular-nums whitespace-nowrap">
                      {formatYmdDisplay(loan.dueDate)}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {dl.bucket === 'overdue' ? (
                        <StatusText tone="red">{Math.abs(dl.deltaDays)} kun kechikkan</StatusText>
                      ) : dl.bucket === 'due_today' ? (
                        <StatusText tone="amber">Bugun</StatusText>
                      ) : (
                        <StatusText tone="blue">Faol</StatusText>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyAction === loan.id}
                        onClick={() => void handleQuickReturn(loan.id)}
                      >
                        <Check className="w-3.5 h-3.5 text-[#059669]" />
                        Qaytarildi
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </PanelCard>
    </div>
  );
}
