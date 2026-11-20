'use client';

import React, { useMemo, useState } from 'react';
import { Check, Download, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useLibrary } from '@/components/library-context';
import { Button, Input, PanelCard, SelectField, StatusText } from '@/components/ui/primitives';
import { authFetch } from '@/lib/api-client';
import { classifyLoanDeadline, formatYmdDisplay, getTodayTashkent } from '@/lib/date-utils';
import { compareClassNames } from '@/lib/utils';

export function ReturnsView() {
  const { data, refreshData, downloadTableXlsx } = useLibrary();
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [busyLoanId, setBusyLoanId] = useState<string | null>(null);

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

  const classes = useMemo(() => {
    const set = new Set<string>();
    for (const s of data?.students ?? []) {
      if (s.status === 'active' && s.className) set.add(s.className);
    }
    return Array.from(set).sort(compareClassNames);
  }, [data?.students]);

  const activeRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.loans ?? [])
      .filter((l) => l.status === 'active')
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
  }, [bookMap, classFilter, copyMap, data?.loans, search, studentMap, today]);

  if (!data) {
    return <p className="text-xs text-[#64748B]">Ma’lumotlar yuklanmoqda...</p>;
  }

  async function handleOneClickReturn(loanId: string) {
    setBusyLoanId(loanId);
    try {
      const res = await authFetch('/api/loans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'return',
          loanId,
          condition: 'good',
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Qaytarishda xatolik.');
      toast.success('Kitob qaytarildi.');
      await refreshData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setBusyLoanId(null);
    }
  }

  function handleExportXlsx() {
    void downloadTableXlsx({
      fileName: `Qaytarilishi_kerak_${today}.xlsx`,
      sheetName: 'Qaytarish',
      headers: ['Sinf', 'O‘quvchi', 'Kitob nomi', 'Inventar №', 'Berilgan sana', 'Qaytarish sanasi', 'Holat'],
      rows: activeRows.map(({ loan, student, book, copy, dl }) => [
        student?.className ?? '—',
        student?.fullName ?? '—',
        book?.title ?? '—',
        copy?.originalInventoryNumber || copy?.internalCopyCode || '—',
        formatYmdDisplay(loan.issuedDate),
        formatYmdDisplay(loan.dueDate),
        dl.bucket === 'overdue'
          ? `${Math.abs(dl.deltaDays)} kun kechikkan`
          : dl.bucket === 'due_today'
            ? 'Bugun'
            : 'Faol',
      ]),
      columnWidths: [10, 32, 38, 16, 15, 16, 18],
    });
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="O‘quvchi, sinf yoki kitob..."
              aria-label="Qaytariladigan kitoblarni qidirish"
              className="pl-8"
            />
          </div>
          <SelectField
            aria-label="Sinf bo‘yicha filtr"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="w-full sm:w-40"
          >
            <option value="">Barcha sinflar</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectField>
        </div>

        <Button size="sm" variant="outline" onClick={handleExportXlsx}>
          <Download className="w-3.5 h-3.5" />
          XLSX yuklab olish
        </Button>
      </div>

      {/* Table */}
      <PanelCard className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#1E3A5F] text-white text-xs font-medium">
                <th className="py-2.5 px-4 whitespace-nowrap">Sinf</th>
                <th className="py-2.5 px-4 whitespace-nowrap">O‘quvchi</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Kitob</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Inventar №</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Berilgan</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Qaytarish</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Holat</th>
                <th className="py-2.5 px-4 text-right whitespace-nowrap">Amal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-sm">
              {activeRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 px-4 text-center text-xs text-[#64748B]">
                    Qaytarilishi kutilayotgan kitoblar yo‘q.
                  </td>
                </tr>
              ) : (
                activeRows.map(({ loan, student, book, copy, dl }) => (
                  <tr key={loan.id} className="hover:bg-[#F8FAFC]">
                    <td className="py-2.5 px-4 font-medium text-[#1E3A5F] whitespace-nowrap">
                      {student?.className ?? '—'}
                    </td>
                    <td className="py-2.5 px-4 text-[#0F172A]">{student?.fullName ?? '—'}</td>
                    <td className="py-2.5 px-4 text-[#334155] max-w-[280px] truncate">
                      {book?.title ?? '—'}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs text-[#64748B] whitespace-nowrap">
                      {copy?.originalInventoryNumber || copy?.internalCopyCode || '—'}
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
                        variant="primary"
                        disabled={busyLoanId === loan.id}
                        onClick={() => void handleOneClickReturn(loan.id)}
                      >
                        <Check className="w-3.5 h-3.5" />
                        {busyLoanId === loan.id ? 'Saqlanmoqda...' : 'Qaytarildi'}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-[#E2E8F0] text-xs text-[#64748B] tabular-nums">
          Jami: <strong className="text-[#0F172A]">{activeRows.length}</strong> ta faol kitob
        </div>
      </PanelCard>
    </div>
  );
}
