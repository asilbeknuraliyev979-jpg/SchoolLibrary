'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Plus,
  Search,
  Settings2,
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
  SideDrawer,
  StatusText,
} from '@/components/ui/primitives';
import { authFetch } from '@/lib/api-client';
import { getTodayTashkent } from '@/lib/date-utils';
import type { BookTitle } from '@/lib/types';

const PAGE_SIZE = 50;

export function CatalogView() {
  const { data, refreshData, downloadTableXlsx } = useLibrary();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'issued' | 'needs_review'>('all');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  // Add Book Modal
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newAuthor, setNewAuthor] = useState('');
  const [newInv, setNewInv] = useState('');
  const [newYear, setNewYear] = useState('');
  const [newCopies, setNewCopies] = useState('1');

  // Edit / Confirm Drawer
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editAuthor, setEditAuthor] = useState('');
  const [editYear, setEditYear] = useState('');
  const [editInv, setEditInv] = useState('');
  const [addCopyCount, setAddCopyCount] = useState('1');

  const copiesByBook = useMemo(() => {
    const map = new Map<string, { total: number; available: number; issued: number }>();
    for (const c of data?.physicalCopies ?? []) {
      const entry = map.get(c.bookTitleId) ?? { total: 0, available: 0, issued: 0 };
      if (c.confirmed && c.status !== 'archived') {
        entry.total += 1;
        if (c.status === 'available') entry.available += 1;
        if (c.status === 'issued') entry.issued += 1;
      }
      map.set(c.bookTitleId, entry);
    }
    return map;
  }, [data?.physicalCopies]);

  const filteredBooks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.bookTitles ?? []).filter((book) => {
      if (book.reviewStatus === 'archived') return false;
      const counts = copiesByBook.get(book.id) ?? { total: 0, available: 0, issued: 0 };
      if (statusFilter === 'available' && counts.available === 0) return false;
      if (statusFilter === 'issued' && counts.issued === 0) return false;
      if (statusFilter === 'needs_review' && book.reviewStatus !== 'needs_review') return false;
      if (!q) return true;
      return (
        book.title.toLowerCase().includes(q) ||
        book.author.toLowerCase().includes(q) ||
        book.inventoryNumberRaw.toLowerCase().includes(q) ||
        book.originalAuthorTitle.toLowerCase().includes(q)
      );
    });
  }, [copiesByBook, data?.bookTitles, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredBooks.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filteredBooks.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const selectedBook = useMemo(
    () => (data?.bookTitles ?? []).find((b) => b.id === selectedBookId) ?? null,
    [data?.bookTitles, selectedBookId]
  );

  if (!data) {
    return <p className="text-xs text-[#64748B]">Ma’lumotlar yuklanmoqda...</p>;
  }

  function openBookDrawer(book: BookTitle) {
    setSelectedBookId(book.id);
    setEditTitle(book.title);
    setEditAuthor(book.author);
    setEditYear(book.publicationYear ? String(book.publicationYear) : '');
    setEditInv(book.inventoryNumberRaw);
    setAddCopyCount('1');
  }

  async function handleImportAttached() {
    setBusy(true);
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
      if (!res.ok) throw new Error(json.error || 'Importda xatolik.');
      if (json.skippedDuplicateFile) {
        toast.info('Inventar.xlsx fayli avval import qilingan (takroriy import bloklandi).');
      } else {
        toast.success(`${json.batch?.bookRowsCount ?? 0} ta kitob import qilindi.`);
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
      formData.append('autoConfirmClearSingleCopies', 'true');
      const res = await authFetch('/api/import/commit', {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'XLSX faylni yuklashda xatolik.');
      if (json.skippedDuplicateFile) {
        toast.info('Bu fayl avval import qilingan.');
      } else {
        toast.success(`${json.batch?.bookRowsCount ?? 0} ta kitob import qilindi.`);
      }
      await refreshData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleCreateBook(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) {
      toast.error('Kitob nomini kiriting.');
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          title: newTitle.trim(),
          author: newAuthor.trim(),
          inventoryNumberRaw: newInv.trim(),
          publicationYear: newYear.trim() ? Number(newYear.trim()) : null,
          initialCopies: Math.max(1, Number(newCopies) || 1),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Kitob qo‘shishda xatolik.');
      toast.success('Kitob muvaffaqiyatli qo‘shildi.');
      setAddOpen(false);
      setNewTitle('');
      setNewAuthor('');
      setNewInv('');
      setNewYear('');
      setNewCopies('1');
      await refreshData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveBook(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBook) return;
    setBusy(true);
    try {
      const res = await authFetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          bookId: selectedBook.id,
          title: editTitle.trim(),
          author: editAuthor.trim(),
          publicationYear: editYear.trim() ? Number(editYear.trim()) : null,
          inventoryNumberRaw: editInv.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Saqlashda xatolik.');
      toast.success('Kitob ma’lumotlari saqlandi.');
      await refreshData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmCopies() {
    if (!selectedBook) return;
    const count = Math.max(1, Math.min(200, Number(addCopyCount) || 1));
    setBusy(true);
    try {
      const res = await authFetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm_range',
          bookId: selectedBook.id,
          copyCount: count,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Nusxa qo‘shishda xatolik.');
      toast.success(`${count} ta nusxa tasdiqlandi.`);
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
      fileName: `Kitoblar_${today}.xlsx`,
      sheetName: 'Kitoblar',
      headers: ['Inventar №', 'Kitob nomi', 'Muallif', 'Nashr yili', 'Jami nusxa', 'Mavjud', 'Holat'],
      rows: filteredBooks.map((b) => {
        const c = copiesByBook.get(b.id) ?? { total: 0, available: 0, issued: 0 };
        return [
          b.inventoryNumberRaw || '—',
          b.title,
          b.author || '—',
          b.publicationYear ?? b.publicationYearRaw ?? '—',
          c.total,
          c.available,
          c.available > 0 ? 'Mavjud' : c.total > 0 ? 'Berilgan' : 'Tasdiqlanmagan',
        ];
      }),
      columnWidths: [16, 44, 28, 12, 12, 12, 16],
    });
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Kitob nomi, muallif, inventar №..."
              aria-label="Kitoblarni qidirish"
              className="pl-8"
            />
          </div>
          <SelectField
            aria-label="Holat filtri"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as typeof statusFilter);
              setPage(1);
            }}
            className="w-full sm:w-44"
          >
            <option value="all">Barcha kitoblar</option>
            <option value="available">Mavjud kitoblar</option>
            <option value="issued">Berilgan kitoblar</option>
            <option value="needs_review">Tasdiqlash kerak</option>
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
            Inventar.xlsx import
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
            Kitob qo‘shish
          </Button>
          <Button size="sm" variant="outline" onClick={handleExportXlsx}>
            <Download className="w-3.5 h-3.5" />
            XLSX yuklab olish
          </Button>
        </div>
      </div>

      {/* Table */}
      <PanelCard className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#1E3A5F] text-white text-xs font-medium">
                <th className="py-2.5 px-4 whitespace-nowrap">Inventar №</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Kitob nomi</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Muallif</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Yil</th>
                <th className="py-2.5 px-4 text-right whitespace-nowrap">Nusxa</th>
                <th className="py-2.5 px-4 text-right whitespace-nowrap">Mavjud</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Holat</th>
                <th className="py-2.5 px-4 text-right whitespace-nowrap">Amal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-sm">
              {pageItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 px-4 text-center text-xs text-[#64748B]">
                    Kitoblar topilmadi. Yuqoridagi &ldquo;Inventar.xlsx import&rdquo; tugmasini bosing.
                  </td>
                </tr>
              ) : (
                pageItems.map((book) => {
                  const counts = copiesByBook.get(book.id) ?? { total: 0, available: 0, issued: 0 };
                  return (
                    <tr key={book.id} className="hover:bg-[#F8FAFC]">
                      <td className="py-2.5 px-4 font-mono text-xs text-[#1E3A5F] whitespace-nowrap">
                        {book.inventoryNumberRaw || '—'}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-[#0F172A] max-w-[340px] truncate">
                        {book.title}
                      </td>
                      <td className="py-2.5 px-4 text-[#475569] max-w-[200px] truncate">
                        {book.author || '—'}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-[#64748B] tabular-nums whitespace-nowrap">
                        {book.publicationYear ?? (book.publicationYearRaw || '—')}
                      </td>
                      <td className="py-2.5 px-4 text-right text-xs tabular-nums text-[#0F172A]">
                        {counts.total}
                      </td>
                      <td className="py-2.5 px-4 text-right text-xs tabular-nums font-medium text-[#059669]">
                        {counts.available}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        {counts.available > 0 ? (
                          <StatusText tone="green">Mavjud</StatusText>
                        ) : counts.total > 0 ? (
                          <StatusText tone="blue">Berilgan</StatusText>
                        ) : (
                          <StatusText tone="amber">Nusxa kiritilmagan</StatusText>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => openBookDrawer(book)}>
                          <Settings2 className="w-3.5 h-3.5" />
                          Boshqarish
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-4 py-3 border-t border-[#E2E8F0] flex items-center justify-between gap-3 text-xs text-[#64748B]">
          <span className="tabular-nums">
            Jami: <strong className="text-[#0F172A]">{filteredBooks.length.toLocaleString('uz-UZ')}</strong> ta kitob
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

      {/* Add Book Modal */}
      <ModalDialog open={addOpen} onOpenChange={setAddOpen} title="Yangi kitob qo‘shish">
        <form onSubmit={(e) => void handleCreateBook(e)} className="space-y-3.5">
          <div>
            <FieldLabel htmlFor="new-title" required>
              Kitob nomi
            </FieldLabel>
            <Input
              id="new-title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <FieldLabel htmlFor="new-author">Muallif</FieldLabel>
              <Input
                id="new-author"
                value={newAuthor}
                onChange={(e) => setNewAuthor(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="new-inv">Inventar raqami</FieldLabel>
              <Input id="new-inv" value={newInv} onChange={(e) => setNewInv(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <FieldLabel htmlFor="new-year">Nashr yili</FieldLabel>
              <Input
                id="new-year"
                type="number"
                value={newYear}
                onChange={(e) => setNewYear(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="new-copies">Nusxalar soni</FieldLabel>
              <Input
                id="new-copies"
                type="number"
                min={1}
                max={200}
                value={newCopies}
                onChange={(e) => setNewCopies(e.target.value)}
              />
            </div>
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

      {/* Book Manage Drawer */}
      <SideDrawer
        open={Boolean(selectedBook)}
        onOpenChange={(open) => {
          if (!open) setSelectedBookId(null);
        }}
        title={selectedBook?.title ?? 'Kitob'}
        subtitle={
          selectedBook?.inventoryNumberRaw
            ? `Inventar №: ${selectedBook.inventoryNumberRaw}`
            : undefined
        }
      >
        {selectedBook && (
          <div className="space-y-6">
            <form onSubmit={(e) => void handleSaveBook(e)} className="space-y-3.5">
              <div>
                <FieldLabel htmlFor="edit-title" required>
                  Kitob nomi
                </FieldLabel>
                <Input
                  id="edit-title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  required
                />
              </div>
              <div>
                <FieldLabel htmlFor="edit-author">Muallif</FieldLabel>
                <Input
                  id="edit-author"
                  value={editAuthor}
                  onChange={(e) => setEditAuthor(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel htmlFor="edit-inv">Inventar raqami</FieldLabel>
                  <Input
                    id="edit-inv"
                    value={editInv}
                    onChange={(e) => setEditInv(e.target.value)}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="edit-year">Nashr yili</FieldLabel>
                  <Input
                    id="edit-year"
                    type="number"
                    value={editYear}
                    onChange={(e) => setEditYear(e.target.value)}
                  />
                </div>
              </div>
              <Button type="submit" size="sm" disabled={busy}>
                O‘zgarishlarni saqlash
              </Button>
            </form>

            <div className="pt-4 border-t border-[#E2E8F0] space-y-3">
              <h3 className="text-sm font-semibold text-[#0F172A]">Nusxa qo‘shish / tasdiqlash</h3>
              {selectedBook.isRangeRecord && (
                <p className="text-xs text-[#64748B]">
                  Inventar diapazoni: <strong className="text-[#0F172A]">{selectedBook.inventoryNumberRaw}</strong>.
                  Haqiqiy nusxalar sonini kiriting.
                </p>
              )}
              <div className="flex items-end gap-2">
                <div className="w-32">
                  <FieldLabel htmlFor="add-copy-count">Nusxa soni</FieldLabel>
                  <Input
                    id="add-copy-count"
                    type="number"
                    min={1}
                    max={200}
                    value={addCopyCount}
                    onChange={(e) => setAddCopyCount(e.target.value)}
                  />
                </div>
                <Button size="md" onClick={() => void handleConfirmCopies()} disabled={busy}>
                  Tasdiqlash
                </Button>
              </div>
            </div>
          </div>
        )}
      </SideDrawer>
    </div>
  );
}
