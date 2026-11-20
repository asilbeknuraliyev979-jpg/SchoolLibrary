'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Plus,
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
import { getTodayTashkent } from '@/lib/date-utils';
import { compareClassNames } from '@/lib/utils';

const PAGE_SIZE = 50;

export function StudentsView() {
  const { data, refreshData, downloadTableXlsx } = useLibrary();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  // Add Student Modal
  const [addOpen, setAddOpen] = useState(false);
  const [newClass, setNewClass] = useState('');
  const [newFullName, setNewFullName] = useState('');

  const activeStudents = useMemo(
    () => (data?.students ?? []).filter((s) => s.status === 'active'),
    [data?.students]
  );

  const classes = useMemo(() => {
    const set = new Set<string>();
    for (const s of activeStudents) {
      if (s.className) set.add(s.className);
    }
    return Array.from(set).sort(compareClassNames);
  }, [activeStudents]);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeStudents
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
  }, [activeStudents, classFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredStudents.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filteredStudents.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (!data) {
    return <p className="text-xs text-[#64748B]">Ma’lumotlar yuklanmoqda...</p>;
  }

  async function handleImportAttached() {
    setBusy(true);
    try {
      const res = await authFetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import_attached' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Importda xatolik yuz berdi.');
      if (json.imported === 0 && json.skipped > 0) {
        toast.info(`Barcha ${json.skipped} nafar o‘quvchi avval import qilingan (takroriy import oldi olindi).`);
      } else {
        toast.success(
          `${json.imported} nafar o‘quvchi import qilindi${json.skipped ? ` (${json.skipped} ta takroriy o‘tkazib yuborildi)` : ''}.`
        );
      }
      await refreshData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadXlsx(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await authFetch('/api/students', {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'XLSX faylni yuklashda xatolik.');
      if (json.imported === 0 && json.skipped > 0) {
        toast.info(`Barcha ${json.skipped} ta yozuv avval mavjud (takroriy import oldi olindi).`);
      } else {
        toast.success(
          `${json.imported} nafar o‘quvchi import qilindi${json.skipped ? ` (${json.skipped} ta takroriy o‘tkazib yuborildi)` : ''}.`
        );
      }
      await refreshData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
      fileName: `Oquvchilar_${classFilter || 'Barchasi'}_${today}.xlsx`,
      sheetName: 'Oquvchilar',
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
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => void handleUploadXlsx(e)}
            className="hidden"
          />
          <Button size="sm" onClick={() => void handleImportAttached()} disabled={busy}>
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
                    O‘quvchilar ro‘yxati bo‘sh. &ldquo;426 o‘quvchini import qilish&rdquo; tugmasini bosing.
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
            Jami: <strong className="text-[#0F172A]">{filteredStudents.length.toLocaleString('uz-UZ')}</strong> nafar o‘quvchi
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
