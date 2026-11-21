'use client';

import React, { useDeferredValue, useMemo, useState } from 'react';
import {
  Archive,
  Check,
  Download,
  History,
  Pencil,
  Plus,
  RotateCcw,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLibrary } from '@/components/library-context';
import {
  Button,
  FieldLabel,
  Input,
  ModalDialog,
  PanelCard,
  SideDrawer,
  StatusText,
} from '@/components/ui/primitives';
import { authFetch } from '@/lib/api-client';
import { patchTeacherUpserted } from '@/lib/client-state-patch';
import { classifyLoanDeadline, formatYmdDisplay, getTodayTashkent } from '@/lib/date-utils';
import type { Teacher } from '@/lib/types';
import { compareUzText } from '@/lib/utils';

export function TeachersView() {
  const { data, indexes, mutateData, returnLoanOptimistic, downloadTableXlsx } = useLibrary();

  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [statusTab, setStatusTab] = useState<'active' | 'archived'>('active');
  const [busy, setBusy] = useState(false);

  // Add / Edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [fullName, setFullName] = useState('');
  const [position, setPosition] = useState('');

  // History drawer
  const [historyTeacher, setHistoryTeacher] = useState<Teacher | null>(null);
  const [returningLoanId, setReturningLoanId] = useState<string | null>(null);

  const today = data?.dashboard.today ?? getTodayTashkent();
  const { bookMap, copyMap, teacherSearchText, sortedActiveTeachers } = indexes;

  const teachers = useMemo(() => data?.teachers ?? [], [data?.teachers]);
  const archivedTeachers = useMemo(
    () =>
      teachers
        .filter((t) => t.status === 'archived')
        .sort((a, b) => compareUzText(a.fullName, b.fullName)),
    [teachers]
  );
  const activeCount = sortedActiveTeachers.length;
  const archivedCount = archivedTeachers.length;

  const teacherLoansMap = useMemo(() => {
    const map = new Map<string, { active: number; total: number }>();
    for (const l of data?.loans ?? []) {
      if (l.borrowerType === 'teacher' && l.teacherId) {
        const prev = map.get(l.teacherId) ?? { active: 0, total: 0 };
        prev.total += 1;
        if (l.status === 'active') prev.active += 1;
        map.set(l.teacherId, prev);
      }
    }
    return map;
  }, [data?.loans]);

  const filteredTeachers = useMemo(() => {
    const list = statusTab === 'active' ? sortedActiveTeachers : archivedTeachers;
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((t) => (teacherSearchText.get(t.id) ?? '').includes(q));
  }, [archivedTeachers, deferredSearch, sortedActiveTeachers, statusTab, teacherSearchText]);

  const historyLoans = useMemo(() => {
    if (!historyTeacher) return [];
    return (data?.loans ?? [])
      .filter((l) => l.borrowerType === 'teacher' && l.teacherId === historyTeacher.id)
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
        return b.issuedDate.localeCompare(a.issuedDate);
      });
  }, [data?.loans, historyTeacher]);

  if (!data) {
    return <p className="text-xs text-[#64748B]">Ma’lumotlar yuklanmoqda...</p>;
  }

  function openAddModal() {
    setEditingTeacher(null);
    setFullName('');
    setPosition('');
    setModalOpen(true);
  }

  function openEditModal(teacher: Teacher) {
    setEditingTeacher(teacher);
    setFullName(teacher.fullName);
    setPosition(teacher.position);
    setModalOpen(true);
  }

  async function handleSaveTeacher(e: React.FormEvent) {
    e.preventDefault();
    if (fullName.trim().length < 2 || position.trim().length < 2) {
      toast.error('F.I.Sh. va lavozimni to‘liq kiriting.');
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch('/api/teachers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          editingTeacher
            ? {
                action: 'update',
                teacherId: editingTeacher.id,
                fullName: fullName.trim(),
                position: position.trim(),
              }
            : {
                action: 'create',
                fullName: fullName.trim(),
                position: position.trim(),
              }
        ),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Saqlashda xatolik.');
      if (json.teacher) {
        mutateData((prev) => patchTeacherUpserted(prev, json.teacher));
      }
      toast.success(editingTeacher ? 'O‘qituvchi ma’lumotlari yangilandi.' : 'O‘qituvchi qo‘shildi.');
      setModalOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleArchive(teacher: Teacher) {
    setBusy(true);
    try {
      const res = await authFetch('/api/teachers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: teacher.status === 'active' ? 'archive' : 'restore',
          teacherId: teacher.id,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Holatni o‘zgartirishda xatolik.');
      if (json.teacher) {
        mutateData((prev) => patchTeacherUpserted(prev, json.teacher));
      }
      toast.success(
        teacher.status === 'active' ? 'O‘qituvchi arxivlandi.' : 'O‘qituvchi faol ro‘yxatga qaytarildi.'
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setBusy(false);
    }
  }

  async function handleReturnLoan(loanId: string) {
    setReturningLoanId(loanId);
    try {
      await returnLoanOptimistic(loanId);
    } finally {
      setReturningLoanId(null);
    }
  }

  function handleExportXlsx() {
    void downloadTableXlsx({
      fileName: `Oqituvchilar_${today}.xlsx`,
      sheetName: "O'qituvchilar",
      headers: ['F.I.Sh.', 'Lavozimi', 'Holat', 'Faol kitoblar', 'Jami olgan kitoblar'],
      rows: filteredTeachers.map((t) => {
        const stats = teacherLoansMap.get(t.id) ?? { active: 0, total: 0 };
        return [
          t.fullName,
          t.position,
          t.status === 'active' ? 'Faol' : 'Arxivlangan',
          stats.active,
          stats.total,
        ];
      }),
      columnWidths: [34, 30, 16, 14, 18],
    });
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="F.I.Sh. yoki lavozimi..."
              aria-label="O‘qituvchilarni qidirish"
              className="pl-8"
            />
          </div>

          {archivedCount > 0 && (
            <div className="inline-flex rounded-lg border border-[#CBD5E1] p-0.5 bg-white">
              <button
                type="button"
                onClick={() => setStatusTab('active')}
                className={`px-3 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                  statusTab === 'active'
                    ? 'bg-[#1E3A5F] text-white'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                Faol ({activeCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusTab('archived')}
                className={`px-3 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                  statusTab === 'archived'
                    ? 'bg-[#1E3A5F] text-white'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                Arxiv ({archivedCount})
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={openAddModal}>
            <Plus className="w-3.5 h-3.5" />
            O‘qituvchi qo‘shish
          </Button>
          <Button size="sm" variant="outline" onClick={handleExportXlsx}>
            <Download className="w-3.5 h-3.5" />
            XLSX yuklab olish
          </Button>
        </div>
      </div>

      {/* Teachers Table */}
      <PanelCard className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#1E3A5F] text-white text-xs font-medium">
                <th className="py-2.5 px-4 whitespace-nowrap">F.I.Sh.</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Lavozimi</th>
                <th className="py-2.5 px-4 whitespace-nowrap text-center">Faol kitoblar</th>
                <th className="py-2.5 px-4 whitespace-nowrap text-center">Jami olgan</th>
                <th className="py-2.5 px-4 text-right whitespace-nowrap">Amallar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-sm">
              {filteredTeachers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 px-4 text-center text-xs text-[#64748B]">
                    {statusTab === 'active'
                      ? 'Hozircha o‘qituvchilar qo‘shilmagan. "O‘qituvchi qo‘shish" tugmasini bosing.'
                      : 'Arxivlangan o‘qituvchilar yo‘q.'}
                  </td>
                </tr>
              ) : (
                filteredTeachers.map((teacher) => {
                  const stats = teacherLoansMap.get(teacher.id) ?? { active: 0, total: 0 };
                  return (
                    <tr key={teacher.id} className="hover:bg-[#F8FAFC]">
                      <td className="py-2.5 px-4 font-medium text-[#0F172A]">{teacher.fullName}</td>
                      <td className="py-2.5 px-4 text-[#475569]">{teacher.position}</td>
                      <td className="py-2.5 px-4 text-center tabular-nums">
                        {stats.active > 0 ? (
                          <span className="font-semibold text-[#1E3A5F]">{stats.active}</span>
                        ) : (
                          <span className="text-[#94A3B8]">0</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-center tabular-nums text-[#64748B]">
                        {stats.total}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setHistoryTeacher(teacher)}
                          >
                            <History className="w-3.5 h-3.5" />
                            Tarix
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Tahrirlash"
                            onClick={() => openEditModal(teacher)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            title={teacher.status === 'active' ? 'Arxivlash' : 'Tiklash'}
                            aria-label={teacher.status === 'active' ? 'Arxivlash' : 'Tiklash'}
                            onClick={() => void handleToggleArchive(teacher)}
                          >
                            {teacher.status === 'active' ? (
                              <Archive className="w-3.5 h-3.5 text-[#64748B]" />
                            ) : (
                              <RotateCcw className="w-3.5 h-3.5 text-[#059669]" />
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-[#E2E8F0] text-xs text-[#64748B] tabular-nums">
          Jami: <strong className="text-[#0F172A]">{filteredTeachers.length}</strong> nafar o‘qituvchi
        </div>
      </PanelCard>

      {/* Add / Edit Teacher Modal */}
      <ModalDialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editingTeacher ? 'O‘qituvchini tahrirlash' : 'Yangi o‘qituvchi qo‘shish'}
      >
        <form onSubmit={(e) => void handleSaveTeacher(e)} className="space-y-3.5">
          <div>
            <FieldLabel htmlFor="tch-name" required>
              F.I.Sh.
            </FieldLabel>
            <Input
              id="tch-name"
              placeholder="Masalan: Karimova Dilnoza Alisherovna"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
          <div>
            <FieldLabel htmlFor="tch-position" required>
              Lavozimi
            </FieldLabel>
            <Input
              id="tch-position"
              placeholder="Masalan: Matematika o‘qituvchisi"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              required
            />
          </div>
          <div className="pt-2 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Bekor qilish
            </Button>
            <Button type="submit" disabled={busy}>
              Saqlash
            </Button>
          </div>
        </form>
      </ModalDialog>

      {/* Teacher Loan History Drawer */}
      <SideDrawer
        open={Boolean(historyTeacher)}
        onOpenChange={(open) => {
          if (!open) setHistoryTeacher(null);
        }}
        title={historyTeacher?.fullName ?? ''}
        subtitle={historyTeacher ? `${historyTeacher.position} · Kitob olish tarixi` : ''}
      >
        {historyLoans.length === 0 ? (
          <p className="text-xs text-[#64748B] py-8 text-center">
            Bu o‘qituvchi hali kutubxonadan kitob olmagan.
          </p>
        ) : (
          <div className="space-y-3">
            {historyLoans.map((loan) => {
              const book = bookMap.get(loan.bookTitleId);
              const copy = copyMap.get(loan.physicalCopyId);
              const dl = classifyLoanDeadline(loan, today);
              const isOverdue = loan.status === 'active' && dl.bucket === 'overdue';

              return (
                <div
                  key={loan.id}
                  className={`p-3.5 rounded-lg border ${
                    isOverdue ? 'border-[#FECACA] bg-[#FEF2F2]/60' : 'border-[#E2E8F0] bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[#0F172A] truncate">
                        {book?.title ?? 'Noma’lum kitob'}
                      </div>
                      <div className="text-xs text-[#64748B] mt-0.5 font-mono">
                        № {copy?.originalInventoryNumber || copy?.internalCopyCode || '—'}
                      </div>
                    </div>
                    {loan.status === 'returned' ? (
                      <StatusText tone="green">Qaytarilgan</StatusText>
                    ) : isOverdue ? (
                      <StatusText tone="red">{Math.abs(dl.deltaDays)} kun kechikkan</StatusText>
                    ) : dl.bucket === 'due_today' ? (
                      <StatusText tone="amber">Bugun</StatusText>
                    ) : (
                      <StatusText tone="blue">Faol</StatusText>
                    )}
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[#64748B] tabular-nums">
                    <div className="flex items-center gap-4">
                      <span>Berilgan: {formatYmdDisplay(loan.issuedDate)}</span>
                      <span>
                        {loan.status === 'returned'
                          ? `Qaytarilgan: ${formatYmdDisplay(loan.returnedDate)}`
                          : `Muddat: ${formatYmdDisplay(loan.dueDate)}`}
                      </span>
                    </div>
                    {loan.status === 'active' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={returningLoanId === loan.id}
                        onClick={() => void handleReturnLoan(loan.id)}
                      >
                        <Check className="w-3.5 h-3.5 text-[#059669]" />
                        Qaytarildi
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SideDrawer>
    </div>
  );
}
