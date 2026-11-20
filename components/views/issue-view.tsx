'use client';

import React, { useMemo, useState } from 'react';
import { BookUp2, Check, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useLibrary } from '@/components/library-context';
import { DatePicker } from '@/components/ui/date-picker';
import { Button, FieldLabel, Input, PanelCard, SelectField } from '@/components/ui/primitives';
import { authFetch } from '@/lib/api-client';
import { addDaysYmd, getTodayTashkent } from '@/lib/date-utils';
import { compareClassNames } from '@/lib/utils';

export function IssueView() {
  const { data, refreshData } = useLibrary();

  const today = data?.dashboard.today ?? getTodayTashkent();
  const [classFilter, setClassFilter] = useState('');
  const [studentQuery, setStudentQuery] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState('');

  const [bookQuery, setBookQuery] = useState('');
  const [selectedBookId, setSelectedBookId] = useState('');
  const [selectedCopyId, setSelectedCopyId] = useState('');

  const [issuedDate, setIssuedDate] = useState(today);
  const [dueDate, setDueDate] = useState(() => addDaysYmd(today, 14));
  const [submitting, setSubmitting] = useState(false);

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

  const activeLoansByStudent = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of data?.loans ?? []) {
      if (l.status === 'active') {
        map.set(l.studentId, (map.get(l.studentId) ?? 0) + 1);
      }
    }
    return map;
  }, [data?.loans]);

  const filteredStudents = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    return activeStudents
      .filter((s) => {
        if (classFilter && s.className !== classFilter) return false;
        if (!q) return true;
        return s.fullName.toLowerCase().includes(q) || s.className.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const c = compareClassNames(a.className, b.className);
        if (c !== 0) return c;
        return a.fullName.localeCompare(b.fullName, 'uz');
      })
      .slice(0, 60);
  }, [activeStudents, classFilter, studentQuery]);

  const availableCopiesByBook = useMemo(() => {
    const map = new Map<string, Array<{ id: string; inv: string }>>();
    for (const c of data?.physicalCopies ?? []) {
      if (c.confirmed && c.status === 'available') {
        const list = map.get(c.bookTitleId) ?? [];
        list.push({ id: c.id, inv: c.originalInventoryNumber || c.internalCopyCode });
        map.set(c.bookTitleId, list);
      }
    }
    return map;
  }, [data?.physicalCopies]);

  const availableBooks = useMemo(() => {
    const q = bookQuery.trim().toLowerCase();
    return (data?.bookTitles ?? [])
      .filter((b) => {
        const copies = availableCopiesByBook.get(b.id);
        if (!copies || copies.length === 0) return false;
        if (!q) return true;
        return (
          b.title.toLowerCase().includes(q) ||
          b.author.toLowerCase().includes(q) ||
          b.inventoryNumberRaw.toLowerCase().includes(q)
        );
      })
      .slice(0, 60);
  }, [availableCopiesByBook, bookQuery, data?.bookTitles]);

  const selectedStudent = useMemo(
    () => activeStudents.find((s) => s.id === selectedStudentId) ?? null,
    [activeStudents, selectedStudentId]
  );

  const selectedBook = useMemo(
    () => (data?.bookTitles ?? []).find((b) => b.id === selectedBookId) ?? null,
    [data?.bookTitles, selectedBookId]
  );

  const selectedBookCopies = useMemo(
    () => (selectedBookId ? availableCopiesByBook.get(selectedBookId) ?? [] : []),
    [availableCopiesByBook, selectedBookId]
  );

  if (!data) {
    return <p className="text-xs text-[#64748B]">Ma’lumotlar yuklanmoqda...</p>;
  }

  function handleSelectBook(bookId: string) {
    setSelectedBookId(bookId);
    const copies = availableCopiesByBook.get(bookId) ?? [];
    setSelectedCopyId(copies[0]?.id ?? '');
  }

  function applyPresetDays(days: number) {
    setDueDate(addDaysYmd(issuedDate || today, days));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedStudentId) {
      toast.error('O‘quvchini tanlang.');
      return;
    }
    if (!selectedCopyId) {
      toast.error('Mavjud kitobni tanlang.');
      return;
    }
    if (!dueDate || dueDate < issuedDate) {
      toast.error('Qaytarish sanasi berilgan sanadan oldin bo‘lishi mumkin emas.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await authFetch('/api/loans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'issue',
          studentId: selectedStudentId,
          physicalCopyIds: [selectedCopyId],
          issuedDate,
          dueDate,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Kitob berishda xatolik.');
      toast.success('Kitob muvaffaqiyatli berildi.');
      setSelectedBookId('');
      setSelectedCopyId('');
      await refreshData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 1. Student Selection */}
        <PanelCard className="p-4 flex flex-col">
          <h2 className="text-sm font-semibold text-[#0F172A] mb-3">1. O‘quvchini tanlang</h2>
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <SelectField
              aria-label="Sinf filtri"
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="sm:w-36"
            >
              <option value="">Barcha sinflar</option>
              {classes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectField>
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={studentQuery}
                onChange={(e) => setStudentQuery(e.target.value)}
                placeholder="Familiya va ism..."
                aria-label="O‘quvchini qidirish"
                className="pl-8"
              />
            </div>
          </div>

          <div className="border border-[#E2E8F0] rounded-lg divide-y divide-[#E2E8F0] max-h-72 overflow-y-auto">
            {filteredStudents.length === 0 ? (
              <p className="py-8 px-4 text-center text-xs text-[#64748B]">
                O‘quvchilar topilmadi.
              </p>
            ) : (
              filteredStudents.map((stu) => {
                const isSelected = stu.id === selectedStudentId;
                const activeCount = activeLoansByStudent.get(stu.id) ?? 0;
                return (
                  <button
                    key={stu.id}
                    type="button"
                    onClick={() => setSelectedStudentId(stu.id)}
                    className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between gap-2 text-sm transition-colors cursor-pointer ${
                      isSelected ? 'bg-[#1E3A5F] text-white' : 'hover:bg-[#F8FAFC] text-[#0F172A]'
                    }`}
                  >
                    <div className="min-w-0 flex items-center gap-2.5">
                      <span
                        className={`text-xs font-semibold w-11 shrink-0 ${
                          isSelected ? 'text-white/90' : 'text-[#1E3A5F]'
                        }`}
                      >
                        {stu.className}
                      </span>
                      <span className="truncate">{stu.fullName}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {activeCount > 0 && (
                        <span
                          className={`text-[11px] tabular-nums ${
                            isSelected ? 'text-white/80' : 'text-[#64748B]'
                          }`}
                        >
                          {activeCount} ta
                        </span>
                      )}
                      {isSelected && <Check className="w-4 h-4" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </PanelCard>

        {/* 2. Book Selection */}
        <PanelCard className="p-4 flex flex-col">
          <h2 className="text-sm font-semibold text-[#0F172A] mb-3">2. Kitobni tanlang</h2>
          <div className="relative mb-3">
            <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={bookQuery}
              onChange={(e) => setBookQuery(e.target.value)}
              placeholder="Kitob nomi, muallif yoki inventar №..."
              aria-label="Mavjud kitoblarni qidirish"
              className="pl-8"
            />
          </div>

          <div className="border border-[#E2E8F0] rounded-lg divide-y divide-[#E2E8F0] max-h-72 overflow-y-auto">
            {availableBooks.length === 0 ? (
              <p className="py-8 px-4 text-center text-xs text-[#64748B]">
                Mavjud kitob topilmadi.
              </p>
            ) : (
              availableBooks.map((book) => {
                const isSelected = book.id === selectedBookId;
                const copies = availableCopiesByBook.get(book.id) ?? [];
                return (
                  <button
                    key={book.id}
                    type="button"
                    onClick={() => handleSelectBook(book.id)}
                    className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between gap-2 text-sm transition-colors cursor-pointer ${
                      isSelected ? 'bg-[#1E3A5F] text-white' : 'hover:bg-[#F8FAFC] text-[#0F172A]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{book.title}</div>
                      <div
                        className={`text-xs truncate ${
                          isSelected ? 'text-white/80' : 'text-[#64748B]'
                        }`}
                      >
                        {book.inventoryNumberRaw ? `№ ${book.inventoryNumberRaw}` : ''}
                        {book.inventoryNumberRaw && book.author ? ' · ' : ''}
                        {book.author || ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-[11px] tabular-nums ${
                          isSelected ? 'text-white/90' : 'text-[#059669]'
                        }`}
                      >
                        {copies.length} mavjud
                      </span>
                      {isSelected && <Check className="w-4 h-4" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {selectedBookCopies.length > 1 && (
            <div className="mt-3">
              <FieldLabel htmlFor="copy-select">Nusxa (Inventar №)</FieldLabel>
              <SelectField
                id="copy-select"
                value={selectedCopyId}
                onChange={(e) => setSelectedCopyId(e.target.value)}
              >
                {selectedBookCopies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.inv}
                  </option>
                ))}
              </SelectField>
            </div>
          )}
        </PanelCard>
      </div>

      {/* 3. Dates & Submit */}
      <PanelCard className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <FieldLabel htmlFor="issue-date" required>
              Berilgan sana
            </FieldLabel>
            <DatePicker
              id="issue-date"
              value={issuedDate}
              onChange={(d) => {
                setIssuedDate(d);
                if (dueDate < d) setDueDate(addDaysYmd(d, 14));
              }}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="due-date" className="text-xs font-medium text-[#334155]">
                Qaytarish sanasi <span className="text-[#DC2626]">*</span>
              </label>
              <div className="flex items-center gap-1">
                {[7, 14, 30].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => applyPresetDays(d)}
                    className="px-1.5 py-0.5 text-[11px] rounded border border-[#CBD5E1] text-[#334155] hover:bg-[#F1F5F9] cursor-pointer"
                  >
                    {d} kun
                  </button>
                ))}
              </div>
            </div>
            <DatePicker
              id="due-date"
              value={dueDate}
              minYmd={issuedDate}
              onChange={setDueDate}
            />
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              size="lg"
              disabled={submitting || !selectedStudentId || !selectedCopyId}
              className="w-full md:w-auto"
            >
              <BookUp2 className="w-4 h-4" />
              {submitting ? 'Saqlanmoqda...' : 'Kitobni berish'}
            </Button>
          </div>
        </div>

        {(selectedStudent || selectedBook) && (
          <div className="mt-4 pt-3 border-t border-[#E2E8F0] flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-[#475569]">
            <span>
              O‘quvchi:{' '}
              <strong className="text-[#0F172A]">
                {selectedStudent ? `${selectedStudent.className} · ${selectedStudent.fullName}` : 'Tanlanmagan'}
              </strong>
            </span>
            <span>
              Kitob:{' '}
              <strong className="text-[#0F172A]">{selectedBook?.title ?? 'Tanlanmagan'}</strong>
            </span>
          </div>
        )}
      </PanelCard>
    </form>
  );
}
