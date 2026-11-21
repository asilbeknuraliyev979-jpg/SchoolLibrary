'use client';

import React, { useDeferredValue, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { useLibrary } from '@/components/library-context';
import { Button, Input, PanelCard, SelectField, StatusText } from '@/components/ui/primitives';
import { resolveLoanBorrower } from '@/lib/borrower-utils';
import { classifyLoanDeadline, formatYmdDisplay, getTodayTashkent } from '@/lib/date-utils';

type TabFilter = 'all' | 'active' | 'overdue' | 'returned';
const PAGE_SIZE = 50;

export function DeadlinesView() {
  const { data, indexes, returnLoanOptimistic, downloadTableXlsx } = useLibrary();
  const [tab, setTab] = useState<TabFilter>('all');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [classFilter, setClassFilter] = useState('');
  const [page, setPage] = useState(1);
  const [busyLoanId, setBusyLoanId] = useState<string | null>(null);

  const today = data?.dashboard.today ?? getTodayTashkent();
  const { studentMap, teacherMap, bookMap, copyMap, activeClasses } = indexes;

  const enrichedLoans = useMemo(() => {
    return (data?.loans ?? []).map((loan) => {
      const borrower = resolveLoanBorrower(loan, studentMap, teacherMap);
      const book = bookMap.get(loan.bookTitleId);
      const copy = copyMap.get(loan.physicalCopyId);
      const dl = classifyLoanDeadline(loan, today);
      const searchText = [
        borrower.fullName,
        borrower.groupLabel,
        borrower.typeLabel,
        book?.title,
        book?.author,
        copy?.originalInventoryNumber,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return { loan, borrower, book, copy, dl, searchText };
    });
  }, [bookMap, copyMap, data?.loans, studentMap, teacherMap, today]);

  const counts = useMemo(() => {
    let active = 0;
    let overdue = 0;
    let returned = 0;
    for (const row of enrichedLoans) {
      if (row.loan.status === 'returned') {
        returned++;
      } else {
        active++;
        if (row.dl.bucket === 'overdue') overdue++;
      }
    }
    return { all: enrichedLoans.length, active, overdue, returned };
  }, [enrichedLoans]);

  const filteredRows = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return enrichedLoans
      .filter(({ loan, borrower, dl, searchText }) => {
        if (tab === 'active' && loan.status !== 'active') return false;
        if (tab === 'overdue' && dl.bucket !== 'overdue') return false;
        if (tab === 'returned' && loan.status !== 'returned') return false;
        if (classFilter === '__teachers__' && borrower.type !== 'teacher') return false;
        if (
          classFilter &&
          classFilter !== '__teachers__' &&
          (borrower.type !== 'student' || borrower.groupLabel !== classFilter)
        ) {
          return false;
        }
        if (!q) return true;
        return searchText.includes(q);
      })
      .sort((a, b) => {
        if (a.loan.status !== b.loan.status) return a.loan.status === 'active' ? -1 : 1;
        return a.loan.dueDate.localeCompare(b.loan.dueDate);
      });
  }, [classFilter, deferredSearch, enrichedLoans, tab]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (!data) {
    return <p className="text-xs text-[#64748B]">Ma’lumotlar yuklanmoqda...</p>;
  }

  async function handleQuickReturn(loanId: string) {
    setBusyLoanId(loanId);
    try {
      await returnLoanOptimistic(loanId);
    } finally {
      setBusyLoanId(null);
    }
  }

  function handleExportXlsx() {
    void downloadTableXlsx({
      fileName: `Monitoring_${tab}_${today}.xlsx`,
      sheetName: 'Monitoring',
      headers: [
        'Turi',
        'Sinf / Lavozim',
        'F.I.Sh.',
        'Kitob nomi',
        'Inventar №',
        'Berilgan sana',
        'Qaytarish sanasi',
        'Qaytarilgan sana',
        'Holat',
      ],
      rows: filteredRows.map(({ loan, borrower, book, copy, dl }) => [
        borrower.typeLabel,
        borrower.groupLabel,
        borrower.fullName,
        book?.title ?? '—',
        copy?.originalInventoryNumber || copy?.internalCopyCode || '—',
        formatYmdDisplay(loan.issuedDate),
        formatYmdDisplay(loan.dueDate),
        formatYmdDisplay(loan.returnedDate),
        loan.status === 'returned'
          ? 'Qaytarilgan'
          : dl.bucket === 'overdue'
            ? `${Math.abs(dl.deltaDays)} kun kechikkan`
            : dl.bucket === 'due_today'
              ? 'Bugun'
              : 'Faol',
      ]),
      columnWidths: [14, 22, 32, 38, 16, 15, 16, 16, 18],
    });
  }

  const tabs: Array<{ id: TabFilter; label: string; count: number }> = [
    { id: 'all', label: 'Barchasi', count: counts.all },
    { id: 'active', label: 'Faol', count: counts.active },
    { id: 'overdue', label: 'Muddati o‘tgan', count: counts.overdue },
    { id: 'returned', label: 'Qaytarilgan', count: counts.returned },
  ];

  return (
    <div className="space-y-4">
      {/* Status Tabs + Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  setPage(1);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#1E3A5F] text-white'
                    : 'bg-white border border-[#CBD5E1] text-[#334155] hover:bg-[#F8FAFC]'
                }`}
              >
                {t.label}{' '}
                <span className={`tabular-nums ${active ? 'text-white/80' : 'text-[#64748B]'}`}>
                  ({t.count})
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-56">
            <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="O‘quvchi, o‘qituvchi, kitob..."
              aria-label="Monitoring qidiruvi"
              className="pl-8"
            />
          </div>
          <SelectField
            aria-label="Sinf yoki guruh bo‘yicha filtr"
            value={classFilter}
            onChange={(e) => {
              setClassFilter(e.target.value);
              setPage(1);
            }}
            className="w-full sm:w-40"
          >
            <option value="">Barchasi</option>
            <option value="__teachers__">O‘qituvchilar</option>
            {activeClasses.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectField>
          <Button size="sm" variant="outline" onClick={handleExportXlsx}>
            <Download className="w-3.5 h-3.5" />
            XLSX yuklab olish
          </Button>
        </div>
      </div>

      {/* Monitoring Table */}
      <PanelCard className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#1E3A5F] text-white text-xs font-medium">
                <th className="py-2.5 px-4 whitespace-nowrap">Sinf / Lavozim</th>
                <th className="py-2.5 px-4 whitespace-nowrap">O‘quvchi / O‘qituvchi</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Kitob</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Berilgan</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Qaytarish</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Holat</th>
                <th className="py-2.5 px-4 text-right whitespace-nowrap">Amal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-sm">
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 px-4 text-center text-xs text-[#64748B]">
                    Ma’lumot topilmadi.
                  </td>
                </tr>
              ) : (
                pageRows.map(({ loan, borrower, book, dl }) => {
                  const isOverdue = loan.status === 'active' && dl.bucket === 'overdue';
                  return (
                    <tr
                      key={loan.id}
                      className={
                        isOverdue ? 'bg-[#FEF2F2]/70 hover:bg-[#FEF2F2]' : 'hover:bg-[#F8FAFC]'
                      }
                    >
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <span className="font-medium text-[#1E3A5F]">{borrower.badgeText}</span>
                        {borrower.type === 'teacher' && (
                          <div className="text-[11px] text-[#64748B] truncate max-w-[160px]">
                            {borrower.groupLabel}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-[#0F172A]">{borrower.fullName}</td>
                      <td className="py-2.5 px-4 text-[#334155] max-w-[260px] truncate">
                        {book?.title ?? '—'}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-[#64748B] tabular-nums whitespace-nowrap">
                        {formatYmdDisplay(loan.issuedDate)}
                      </td>
                      <td
                        className={`py-2.5 px-4 text-xs font-medium tabular-nums whitespace-nowrap ${
                          isOverdue ? 'text-[#DC2626]' : 'text-[#0F172A]'
                        }`}
                      >
                        {formatYmdDisplay(loan.dueDate)}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        {loan.status === 'returned' ? (
                          <StatusText tone="green">
                            Qaytarilgan ({formatYmdDisplay(loan.returnedDate)})
                          </StatusText>
                        ) : isOverdue ? (
                          <StatusText tone="red">{Math.abs(dl.deltaDays)} kun kechikkan</StatusText>
                        ) : dl.bucket === 'due_today' ? (
                          <StatusText tone="amber">Bugun</StatusText>
                        ) : (
                          <StatusText tone="blue">Faol</StatusText>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        {loan.status === 'active' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyLoanId === loan.id}
                            onClick={() => void handleQuickReturn(loan.id)}
                          >
                            <Check className="w-3.5 h-3.5 text-[#059669]" />
                            Qaytarildi
                          </Button>
                        ) : (
                          <span className="text-xs text-[#94A3B8]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-[#E2E8F0] flex items-center justify-between gap-3 text-xs text-[#64748B]">
          <span className="tabular-nums">
            Jami: <strong className="text-[#0F172A]">{filteredRows.length}</strong> ta yozuv
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <span className="tabular-nums">
                {safePage} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
        </div>
      </PanelCard>
    </div>
  );
}
