'use client';

import React, { useDeferredValue, useMemo, useState } from 'react';
import { BookUp2, Check, GraduationCap, Plus, Search, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useLibrary } from '@/components/library-context';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Button,
  FieldLabel,
  Input,
  ModalDialog,
  PanelCard,
  SelectField,
} from '@/components/ui/primitives';
import { authFetch } from '@/lib/api-client';
import { patchLoansIssued, patchTeacherUpserted } from '@/lib/client-state-patch';
import { addDaysYmd, getTodayTashkent } from '@/lib/date-utils';
import type { BorrowerType } from '@/lib/types';

export function IssueView() {
  const { data, indexes, mutateData } = useLibrary();

  const today = data?.dashboard.today ?? getTodayTashkent();

  const [borrowerType, setBorrowerType] = useState<BorrowerType>('student');
  const [classFilter, setClassFilter] = useState('');
  const [borrowerQuery, setBorrowerQuery] = useState('');
  const deferredBorrowerQuery = useDeferredValue(borrowerQuery);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedTeacherId, setSelectedTeacherId] = useState('');

  // Quick-add teacher modal
  const [addTeacherOpen, setAddTeacherOpen] = useState(false);
  const [newTeacherName, setNewTeacherName] = useState('');
  const [newTeacherPosition, setNewTeacherPosition] = useState('');
  const [addingTeacher, setAddingTeacher] = useState(false);

  const [bookQuery, setBookQuery] = useState('');
  const deferredBookQuery = useDeferredValue(bookQuery);
  const [selectedBookId, setSelectedBookId] = useState('');
  const [selectedCopyId, setSelectedCopyId] = useState('');

  const [issuedDate, setIssuedDate] = useState(today);
  const [dueDate, setDueDate] = useState(() => addDaysYmd(today, 14));
  const [submitting, setSubmitting] = useState(false);

  const {
    sortedActiveStudents,
    sortedActiveTeachers,
    activeClasses,
    studentMap,
    teacherMap,
    bookMap,
    availableCopiesByBook,
    studentSearchText,
    teacherSearchText,
    bookSearchText,
  } = indexes;

  const activeLoansByStudent = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of data?.loans ?? []) {
      if (l.status === 'active' && (l.borrowerType ?? 'student') === 'student' && l.studentId) {
        map.set(l.studentId, (map.get(l.studentId) ?? 0) + 1);
      }
    }
    return map;
  }, [data?.loans]);

  const activeLoansByTeacher = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of data?.loans ?? []) {
      if (l.status === 'active' && l.borrowerType === 'teacher' && l.teacherId) {
        map.set(l.teacherId, (map.get(l.teacherId) ?? 0) + 1);
      }
    }
    return map;
  }, [data?.loans]);

  // sortedActiveStudents is already pre-sorted by class + name; early-stop at 60 matches!
  const filteredStudents = useMemo(() => {
    const q = deferredBorrowerQuery.trim().toLowerCase();
    const out = [];
    for (const s of sortedActiveStudents) {
      if (classFilter && s.className !== classFilter) continue;
      if (q && !(studentSearchText.get(s.id) ?? '').includes(q)) continue;
      out.push(s);
      if (out.length >= 60) break;
    }
    return out;
  }, [sortedActiveStudents, classFilter, deferredBorrowerQuery, studentSearchText]);

  const filteredTeachers = useMemo(() => {
    const q = deferredBorrowerQuery.trim().toLowerCase();
    const out = [];
    for (const t of sortedActiveTeachers) {
      if (q && !(teacherSearchText.get(t.id) ?? '').includes(q)) continue;
      out.push(t);
      if (out.length >= 60) break;
    }
    return out;
  }, [sortedActiveTeachers, deferredBorrowerQuery, teacherSearchText]);

  const availableBooks = useMemo(() => {
    const q = deferredBookQuery.trim().toLowerCase();
    const out = [];
    for (const b of data?.bookTitles ?? []) {
      const copies = availableCopiesByBook.get(b.id);
      if (!copies || copies.length === 0) continue;
      if (q && !(bookSearchText.get(b.id) ?? '').includes(q)) continue;
      out.push(b);
      if (out.length >= 60) break;
    }
    return out;
  }, [availableCopiesByBook, bookSearchText, data?.bookTitles, deferredBookQuery]);

  const selectedStudent = selectedStudentId ? studentMap.get(selectedStudentId) ?? null : null;
  const selectedTeacher = selectedTeacherId ? teacherMap.get(selectedTeacherId) ?? null : null;
  const selectedBook = selectedBookId ? bookMap.get(selectedBookId) ?? null : null;

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

  async function handleQuickAddTeacher(e: React.FormEvent) {
    e.preventDefault();
    if (newTeacherName.trim().length < 2 || newTeacherPosition.trim().length < 2) {
      toast.error('F.I.Sh. va lavozimni kiriting.');
      return;
    }
    setAddingTeacher(true);
    try {
      const res = await authFetch('/api/teachers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          fullName: newTeacherName.trim(),
          position: newTeacherPosition.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'O‘qituvchi qo‘shishda xatolik.');
      if (json.teacher) {
        mutateData((prev) => patchTeacherUpserted(prev, json.teacher));
        setSelectedTeacherId(json.teacher.id);
      }
      toast.success('O‘qituvchi qo‘shildi.');
      setAddTeacherOpen(false);
      setNewTeacherName('');
      setNewTeacherPosition('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setAddingTeacher(false);
    }
  }

  const hasSelectedBorrower =
    borrowerType === 'student' ? Boolean(selectedStudentId) : Boolean(selectedTeacherId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasSelectedBorrower) {
      toast.error(borrowerType === 'student' ? 'O‘quvchini tanlang.' : 'O‘qituvchini tanlang.');
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
          borrowerType,
          studentId: borrowerType === 'student' ? selectedStudentId : undefined,
          teacherId: borrowerType === 'teacher' ? selectedTeacherId : undefined,
          physicalCopyIds: [selectedCopyId],
          issuedDate,
          dueDate,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Kitob berishda xatolik.');
      if (Array.isArray(json.loans)) {
        mutateData((prev) => patchLoansIssued(prev, json.loans));
      }
      toast.success('Kitob muvaffaqiyatli berildi.');
      setSelectedBookId('');
      setSelectedCopyId('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* 1. Borrower Selection (O'quvchi / O'qituvchi) */}
          <PanelCard className="p-4 flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="text-sm font-semibold text-[#0F172A]">
                1. {borrowerType === 'student' ? 'O‘quvchini tanlang' : 'O‘qituvchini tanlang'}
              </h2>
              <div className="inline-flex rounded-lg border border-[#CBD5E1] p-0.5 bg-[#F8FAFC]">
                <button
                  type="button"
                  onClick={() => {
                    setBorrowerType('student');
                    setBorrowerQuery('');
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                    borrowerType === 'student'
                      ? 'bg-[#1E3A5F] text-white'
                      : 'text-[#475569] hover:text-[#0F172A]'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  O‘quvchi
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBorrowerType('teacher');
                    setBorrowerQuery('');
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                    borrowerType === 'teacher'
                      ? 'bg-[#1E3A5F] text-white'
                      : 'text-[#475569] hover:text-[#0F172A]'
                  }`}
                >
                  <GraduationCap className="w-3.5 h-3.5" />
                  O‘qituvchi
                </button>
              </div>
            </div>

            {borrowerType === 'student' ? (
              <>
                <div className="flex flex-col sm:flex-row gap-2 mb-3">
                  <SelectField
                    aria-label="Sinf filtri"
                    value={classFilter}
                    onChange={(e) => setClassFilter(e.target.value)}
                    className="sm:w-36"
                  >
                    <option value="">Barcha sinflar</option>
                    {activeClasses.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </SelectField>
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      value={borrowerQuery}
                      onChange={(e) => setBorrowerQuery(e.target.value)}
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
              </>
            ) : (
              <>
                <div className="flex flex-col sm:flex-row gap-2 mb-3">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      value={borrowerQuery}
                      onChange={(e) => setBorrowerQuery(e.target.value)}
                      placeholder="O‘qituvchi F.I.Sh. yoki lavozimi..."
                      aria-label="O‘qituvchini qidirish"
                      className="pl-8"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAddTeacherOpen(true)}
                    className="h-9"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Yangi
                  </Button>
                </div>

                <div className="border border-[#E2E8F0] rounded-lg divide-y divide-[#E2E8F0] max-h-72 overflow-y-auto">
                  {filteredTeachers.length === 0 ? (
                    <p className="py-8 px-4 text-center text-xs text-[#64748B]">
                      O‘qituvchilar topilmadi. &ldquo;Yangi&rdquo; tugmasi orqali qo‘shing.
                    </p>
                  ) : (
                    filteredTeachers.map((tch) => {
                      const isSelected = tch.id === selectedTeacherId;
                      const activeCount = activeLoansByTeacher.get(tch.id) ?? 0;
                      return (
                        <button
                          key={tch.id}
                          type="button"
                          onClick={() => setSelectedTeacherId(tch.id)}
                          className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between gap-2 text-sm transition-colors cursor-pointer ${
                            isSelected ? 'bg-[#1E3A5F] text-white' : 'hover:bg-[#F8FAFC] text-[#0F172A]'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="font-medium truncate">{tch.fullName}</div>
                            <div
                              className={`text-xs truncate ${
                                isSelected ? 'text-white/80' : 'text-[#64748B]'
                              }`}
                            >
                              {tch.position}
                            </div>
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
              </>
            )}
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
                disabled={submitting || !hasSelectedBorrower || !selectedCopyId}
                className="w-full md:w-auto"
              >
                <BookUp2 className="w-4 h-4" />
                {submitting ? 'Saqlanmoqda...' : 'Kitobni berish'}
              </Button>
            </div>
          </div>

          {(selectedStudent || selectedTeacher || selectedBook) && (
            <div className="mt-4 pt-3 border-t border-[#E2E8F0] flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-[#475569]">
              <span>
                {borrowerType === 'student' ? 'O‘quvchi' : 'O‘qituvchi'}:{' '}
                <strong className="text-[#0F172A]">
                  {borrowerType === 'student'
                    ? selectedStudent
                      ? `${selectedStudent.className} · ${selectedStudent.fullName}`
                      : 'Tanlanmagan'
                    : selectedTeacher
                      ? `${selectedTeacher.fullName} (${selectedTeacher.position})`
                      : 'Tanlanmagan'}
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

      {/* Quick Add Teacher Modal */}
      <ModalDialog
        open={addTeacherOpen}
        onOpenChange={setAddTeacherOpen}
        title="Yangi o‘qituvchi qo‘shish"
      >
        <form onSubmit={(e) => void handleQuickAddTeacher(e)} className="space-y-3.5">
          <div>
            <FieldLabel htmlFor="quick-tch-name" required>
              F.I.Sh.
            </FieldLabel>
            <Input
              id="quick-tch-name"
              placeholder="Masalan: Karimov Jasur"
              value={newTeacherName}
              onChange={(e) => setNewTeacherName(e.target.value)}
              required
            />
          </div>
          <div>
            <FieldLabel htmlFor="quick-tch-pos" required>
              Lavozimi
            </FieldLabel>
            <Input
              id="quick-tch-pos"
              placeholder="Masalan: Fizika o‘qituvchisi"
              value={newTeacherPosition}
              onChange={(e) => setNewTeacherPosition(e.target.value)}
              required
            />
          </div>
          <div className="pt-2 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAddTeacherOpen(false)}>
              Bekor qilish
            </Button>
            <Button type="submit" disabled={addingTeacher}>
              Saqlash va tanlash
            </Button>
          </div>
        </form>
      </ModalDialog>
    </>
  );
}
