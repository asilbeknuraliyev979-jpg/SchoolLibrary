'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Plus,
  RotateCcw,
  Search,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLibrary } from '@/components/library-context';
import {
  Button,
  FieldLabel,
  Input,
  ModalDialog,
  PanelCard,
  SelectField,
} from '@/components/ui/primitives';
import { authFetch } from '@/lib/api-client';
import { formatDateTimeTashkent, getTodayTashkent } from '@/lib/date-utils';
import type { StudentReplacePreview } from '@/lib/types';
import { compareClassNames } from '@/lib/utils';

const PAGE_SIZE = 50;

export function StudentsView() {
  const { data, refreshData, downloadTableXlsx } = useLibrary();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [statusView, setStatusView] = useState<'active' | 'archived'>('active');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  // Add Student Modal
  const [addOpen, setAddOpen] = useState(false);
  const [newClass, setNewClass] = useState('');
  const [newFullName, setNewFullName] = useState('');

  // Replace-Import Preview Modal
  const [preview, setPreview] = useState<StudentReplacePreview | null>(null);

  // Rollback Confirmation Modal
  const [rollbackOpen, setRollbackOpen] = useState(false);

  const allStudents = useMemo(() => data?.students ?? [], [data?.students]);
  const activeStudents = useMemo(
    () => allStudents.filter((s) => s.status === 'active'),
    [allStudents]
  );
  const archivedStudents = useMemo(
    () => allStudents.filter((s) => s.status === 'archived'),
    [allStudents]
  );

  const currentList = statusView === 'active' ? activeStudents : archivedStudents;

  const classes = useMemo(() => {
    const set = new Set<string>();
    for (const s of currentList) {
      if (s.className) set.add(s.className);
    }
    return Array.from(set).sort(compareClassNames);
  }, [currentList]);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return currentList
      .filter((s) => {
        if (classFilter && s.className !== classFilter) return false;
        if (!q) return true;
        return (
          s.fullName.toLowerCase().includes(q) || s.className.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const c = compareClassNames(a.className, b.className);
        if (c !== 0) return c;
        return a.fullName.localeCompare(b.fullName, 'uz');
      });
  }, [currentList, classFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredStudents.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filteredStudents.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (!data) {
    return <p className="text-xs text-[#64748B]">Ma’lumotlar yuklanmoqda...</p>;
  }

  const latestBackup = data.studentImportBackups?.[0] ?? null;

  async function handlePreviewAttached() {
    setBusy(true);
    try {
      const res = await authFetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'preview_attached' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Faylni tahlil qilishda xatolik.');
      setPreview(json.preview as StudentReplacePreview);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadXlsxForPreview(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', 'preview');
      const res = await authFetch('/api/students', {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'XLSX faylni tahlil qilishda xatolik.');
      setPreview(json.preview as StudentReplacePreview);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleConfirmReplace() {
    if (!preview) return;
    setBusy(true);
    try {
      const res = await authFetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'commit_replace_rows',
          fileName: preview.fileName,
          rows: preview.rows,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Yangilashda xatolik yuz berdi.');
      toast.success(
        `O‘quvchilar bazasi yangilandi: ${json.activeTotal} faol (+${json.added} yangi, ${json.archived} arxivlandi).`
      );
      setPreview(null);
      setStatusView('active');
      setClassFilter('');
      setPage(1);
      await refreshData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmRollback() {
    setBusy(true);
    try {
      const res = await authFetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rollback_last' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Qayta tiklashda xatolik.');
      toast.success(
        `Avvalgi ro‘yxat tiklandi (${json.restoredActiveCount} nafar faol o‘quvchi).`
      );
      setRollbackOpen(false);
      setStatusView('active');
      await refreshData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAddStudent(e: React.FormEvent) {
    e.preventDefault();
    if (!newClass.trim() || !newFullName.trim()) {
      toast.error('Sinf va familiya-ismni kiriting.');
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          className: newClass.trim(),
          fullName: newFullName.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'O‘quvchi qo‘shishda xatolik.');
      toast.success('O‘quvchi qo‘shildi.');
      setAddOpen(false);
      setNewClass('');
      setNewFullName('');
      await refreshData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setBusy(false);
    }
  }

  function handleExportXlsx() {
    const today = getTodayTashkent();
    void downloadTableXlsx({
      fileName: `Oquvchilar_${statusView}_${classFilter || 'Barchasi'}_${today}.xlsx`,
      sheetName: statusView === 'active' ? 'Oquvchilar' : 'Arxivlangan oquvchilar',
      headers: ['Sinf', 'Familiya va ism'],
      rows: filteredStudents.map((s) => [s.className, s.fullName]),
      columnWidths: [14, 42],
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
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Familiya, ism yoki sinf..."
              aria-label="O‘quvchilarni qidirish"
              className="pl-8"
            />
          </div>
          <SelectField
            aria-label="Sinf bo‘yicha filtr"
            value={classFilter}
            onChange={(e) => {
              setClassFilter(e.target.value);
              setPage(1);
            }}
            className="w-full sm:w-40"
          >
            <option value="">Barcha sinflar</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectField>

          {archivedStudents.length > 0 && (
            <div className="inline-flex rounded-lg border border-[#CBD5E1] p-0.5 bg-white">
              <button
                type="button"
                onClick={() => {
                  setStatusView('active');
                  setClassFilter('');
                  setPage(1);
                }}
                className={`px-3 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                  statusView === 'active'
                    ? 'bg-[#1E3A5F] text-white'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                Faol ({activeStudents.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setStatusView('archived');
                  setClassFilter('');
                  setPage(1);
                }}
                className={`px-3 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                  statusView === 'archived'
                    ? 'bg-[#1E3A5F] text-white'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                Arxiv ({archivedStudents.length})
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => void handleUploadXlsxForPreview(e)}
            className="hidden"
          />
          <Button size="sm" onClick={() => void handlePreviewAttached()} disabled={busy}>
            <FileSpreadsheet className="w-3.5 h-3.5" />
            426 o‘quvchini import qilish
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            <Upload className="w-3.5 h-3.5" />
            XLSX yuklash
          </Button>
          {latestBackup && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRollbackOpen(true)}
              disabled={busy}
              title={`Oxirgi importni bekor qilish (${latestBackup.fileName})`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Qayta tiklash
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            Qo‘shish
          </Button>
          <Button size="sm" variant="outline" onClick={handleExportXlsx}>
            <Download className="w-3.5 h-3.5" />
            XLSX yuklab olish
          </Button>
        </div>
      </div>

      {/* Strictly 2-column Table: Sinf | Familiya va ism */}
      <PanelCard className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#1E3A5F] text-white text-xs font-medium">
                <th className="py-2.5 px-4 w-32 whitespace-nowrap">Sinf</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Familiya va ism</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-sm">
              {pageItems.length === 0 ? (
                <tr>
                  <td colSpan={2} className="py-10 px-4 text-center text-xs text-[#64748B]">
                    {statusView === 'active'
                      ? 'O‘quvchilar ro‘yxati bo‘sh. "426 o‘quvchini import qilish" yoki "XLSX yuklash" tugmasini bosing.'
                      : 'Arxivlangan o‘quvchilar mavjud emas.'}
                  </td>
                </tr>
              ) : (
                pageItems.map((student) => (
                  <tr key={student.id} className="hover:bg-[#F8FAFC]">
                    <td className="py-2.5 px-4 font-medium text-[#1E3A5F] whitespace-nowrap">
                      {student.className}
                    </td>
                    <td className="py-2.5 px-4 text-[#0F172A]">{student.fullName}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-4 py-3 border-t border-[#E2E8F0] flex items-center justify-between gap-3 text-xs text-[#64748B]">
          <span className="tabular-nums">
            Jami: <strong className="text-[#0F172A]">{filteredStudents.length.toLocaleString('uz-UZ')}</strong> nafar{' '}
            {statusView === 'active' ? 'faol' : 'arxivlangan'} o‘quvchi
            {classes.length > 0 && ` · ${classes.length} ta sinf`}
          </span>
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
        </div>
      </PanelCard>

      {/* Pre-Import Preview & Confirmation Modal */}
      <ModalDialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open && !busy) setPreview(null);
        }}
        title="O‘quvchilar bazasini yangilash — Tasdiqlash"
        description={
          preview
            ? `Fayl: ${preview.fileName}. Yangi ro‘yxat faol o‘quvchilarni almashtiradi, yo‘q o‘quvchilar arxivlanadi (kitob tarixi saqlanadi).`
            : ''
        }
        maxWidth="max-w-2xl"
      >
        {preview && (
          <div className="space-y-4">
            {/* Summary Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]">
                <div className="text-[11px] text-[#64748B]">Yangi qo‘shiladi</div>
                <div className="text-lg font-semibold text-[#059669] tabular-nums mt-0.5">
                  +{preview.toAddCount}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]">
                <div className="text-[11px] text-[#64748B]">Saqlanib qoladi</div>
                <div className="text-lg font-semibold text-[#1E3A5F] tabular-nums mt-0.5">
                  {preview.toKeepCount}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]">
                <div className="text-[11px] text-[#64748B]">Qayta faollashadi</div>
                <div className="text-lg font-semibold text-[#0284C7] tabular-nums mt-0.5">
                  {preview.toReactivateCount}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]">
                <div className="text-[11px] text-[#64748B]">Arxivlanadi</div>
                <div className="text-lg font-semibold text-[#D97706] tabular-nums mt-0.5">
                  {preview.toArchiveCount}
                </div>
              </div>
            </div>

            {(preview.duplicatesInFile > 0 || preview.skippedInvalidRows > 0) && (
              <div className="text-xs text-[#475569] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3.5 py-2.5">
                Fayldan <strong>{preview.uniqueRowsInFile}</strong> nafar noyob o‘quvchi aniqlandi
                {preview.duplicatesInFile > 0 && ` · ${preview.duplicatesInFile} ta takroriy qator chiqarildi`}
                {preview.skippedInvalidRows > 0 && ` · ${preview.skippedInvalidRows} ta noto‘g‘ri qator o‘tkazildi`}.
              </div>
            )}

            {preview.archivedWithActiveLoansCount > 0 && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] text-xs text-[#92400E]">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#D97706]" />
                <div>
                  Arxivlanadigan o‘quvchilar orasida <strong>{preview.archivedWithActiveLoansCount}</strong> nafarining
                  qo‘lida qaytarilmagan kitob mavjud. Ularning faol kitoblari va olish tarixi o‘chirilmaydi — monitoringda
                  ko‘rinib turadi.
                </div>
              </div>
            )}

            {/* Preview Sample: Incoming Students */}
            {preview.sampleAdd.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-[#0F172A] mb-1.5">
                  Yangi qo‘shiladigan o‘quvchilar namunasi (faqat Sinf va Familiya-ism)
                </div>
                <div className="border border-[#E2E8F0] rounded-lg overflow-hidden max-h-44 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-[#1E3A5F] text-white">
                        <th className="py-1.5 px-3 w-24">Sinf</th>
                        <th className="py-1.5 px-3">Familiya va ism</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {preview.sampleAdd.map((r, i) => (
                        <tr key={`${r.className}-${r.fullName}-${i}`}>
                          <td className="py-1.5 px-3 font-medium text-[#1E3A5F]">{r.className}</td>
                          <td className="py-1.5 px-3 text-[#0F172A]">{r.fullName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Preview Sample: Students to Archive */}
            {preview.sampleArchive.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-[#92400E] mb-1.5">
                  Arxivga o‘tkaziladigan o‘quvchilar ({preview.toArchiveCount} nafar)
                </div>
                <div className="border border-[#E2E8F0] rounded-lg overflow-hidden max-h-36 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-[#F1F5F9] text-[#334155]">
                        <th className="py-1.5 px-3 w-24">Sinf</th>
                        <th className="py-1.5 px-3">Familiya va ism</th>
                        <th className="py-1.5 px-3 text-right">Faol qarz</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {preview.sampleArchive.map((r, i) => (
                        <tr key={`${r.className}-${r.fullName}-${i}`}>
                          <td className="py-1.5 px-3 font-medium text-[#475569]">{r.className}</td>
                          <td className="py-1.5 px-3 text-[#0F172A]">{r.fullName}</td>
                          <td className="py-1.5 px-3 text-right tabular-nums">
                            {r.activeLoans > 0 ? (
                              <span className="text-[#DC2626] font-medium">{r.activeLoans} ta</span>
                            ) : (
                              <span className="text-[#94A3B8]">0</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="pt-2 flex justify-end gap-2 border-t border-[#E2E8F0]">
              <Button variant="outline" onClick={() => setPreview(null)} disabled={busy}>
                Bekor qilish
              </Button>
              <Button onClick={() => void handleConfirmReplace()} disabled={busy}>
                {busy ? 'Yangilanmoqda...' : 'Tasdiqlash va yangilash'}
              </Button>
            </div>
          </div>
        )}
      </ModalDialog>

      {/* Rollback Confirmation Modal */}
      <ModalDialog
        open={rollbackOpen}
        onOpenChange={setRollbackOpen}
        title="Oxirgi importni bekor qilish"
        description={
          latestBackup
            ? `${latestBackup.fileName} (${formatDateTimeTashkent(latestBackup.createdAt)}) importidan oldingi o‘quvchilar ro‘yxati tiklanadi. Kitob qarz tarixi saqlanadi.`
            : ''
        }
      >
        <div className="pt-2 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setRollbackOpen(false)} disabled={busy}>
            Bekor qilish
          </Button>
          <Button onClick={() => void handleConfirmRollback()} disabled={busy}>
            {busy ? 'Tiklanmoqda...' : 'Avvalgi ro‘yxatni tiklash'}
          </Button>
        </div>
      </ModalDialog>

      {/* Add Student Modal */}
      <ModalDialog open={addOpen} onOpenChange={setAddOpen} title="Yangi o‘quvchi qo‘shish">
        <form onSubmit={(e) => void handleAddStudent(e)} className="space-y-3.5">
          <div>
            <FieldLabel htmlFor="stu-class" required>
              Sinf
            </FieldLabel>
            <Input
              id="stu-class"
              placeholder="Masalan: 7-A"
              value={newClass}
              onChange={(e) => setNewClass(e.target.value)}
              required
            />
          </div>
          <div>
            <FieldLabel htmlFor="stu-name" required>
              Familiya va ism
            </FieldLabel>
            <Input
              id="stu-name"
              placeholder="Masalan: Abdullayev Sardor"
              value={newFullName}
              onChange={(e) => setNewFullName(e.target.value)}
              required
            />
          </div>
          <div className="pt-2 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Bekor qilish
            </Button>
            <Button type="submit" disabled={busy}>
              Saqlash
            </Button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
