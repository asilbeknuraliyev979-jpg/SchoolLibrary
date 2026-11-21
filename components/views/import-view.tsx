'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Filter,
  Loader2,
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
  StatusText,
} from '@/components/ui/primitives';
import { formatDateTimeTashkent } from '@/lib/date-utils';
import { authFetch } from '@/lib/api-client';
import { ISSUE_LABELS } from '@/lib/labels';
import type { BookTitle, ImportBatch, ImportPreviewResult, ReviewIssueCode } from '@/lib/types';

const WIZARD_STAGES = [
  '1. Faylni tanlash',
  '2. Ma’lumotlarni tekshirish',
  '3. Muammolarni ko‘rib chiqish',
  '4. Importni tasdiqlash',
  '5. Natijalarni ko‘rish',
];

type PreviewFilter = 'all' | 'issues' | 'ranges' | 'duplicates' | 'invalid_year' | 'missing_inv' | 'skipped';
type ReviewQueueFilter =
  | 'all'
  | 'range_ambiguous'
  | 'duplicate_inventory'
  | 'invalid_year'
  | 'missing_inventory_number'
  | 'uncertain_author_split'
  | 'unconfirmed_only';

export function ImportView() {
  const { data, ensureFullData, refreshData } = useLibrary();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void ensureFullData();
  }, [ensureFullData]);

  const [activeMode, setActiveMode] = useState<'wizard' | 'review' | 'history'>('wizard');
  const [stage, setStage] = useState<number>(0);
  const [sourceMode, setSourceMode] = useState<'attached' | 'upload'>('attached');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [previewFilter, setPreviewFilter] = useState<PreviewFilter>('issues');
  const [previewPage, setPreviewPage] = useState(1);
  const [autoConfirmClear, setAutoConfirmClear] = useState(false);
  const [loading, setLoading] = useState(false);
  const [commitResult, setCommitResult] = useState<{
    batch: ImportBatch;
    skippedDuplicateFile: boolean;
  } | null>(null);

  // Review queue state
  const [reviewFilter, setReviewFilter] = useState<ReviewQueueFilter>('all');
  const [reviewSearch, setReviewSearch] = useState('');
  const [reviewPage, setReviewPage] = useState(1);
  const [editingBook, setEditingBook] = useState<BookTitle | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editAuthor, setEditAuthor] = useState('');
  const [editYear, setEditYear] = useState('');
  const [editDept, setEditDept] = useState('');
  const [editInv, setEditInv] = useState('');
  const [rangeBook, setRangeBook] = useState<BookTitle | null>(null);
  const [rangeCopyCount, setRangeCopyCount] = useState('1');
  const [savingReview, setSavingReview] = useState(false);

  const sourceRecordMap = useMemo(
    () => new Map((data?.sourceInventoryRecords ?? []).map((r) => [r.id, r])),
    [data?.sourceInventoryRecords]
  );

  const copyCountByBook = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of data?.physicalCopies ?? []) {
      if (c.confirmed && c.status !== 'archived') {
        map.set(c.bookTitleId, (map.get(c.bookTitleId) ?? 0) + 1);
      }
    }
    return map;
  }, [data?.physicalCopies]);

  const filteredPreviewRows = useMemo(() => {
    if (!preview) return [];
    return preview.rows.filter((r) => {
      if (previewFilter === 'all') return true;
      if (previewFilter === 'issues') return r.issues.length > 0;
      if (previewFilter === 'ranges') return r.isRange;
      if (previewFilter === 'duplicates') return r.issues.includes('duplicate_inventory');
      if (previewFilter === 'invalid_year') return r.issues.includes('invalid_year');
      if (previewFilter === 'missing_inv') return r.issues.includes('missing_inventory_number');
      if (previewFilter === 'skipped') {
        return (
          r.validationStatus === 'skipped_subtotal' ||
          r.validationStatus === 'skipped_date_only' ||
          r.validationStatus === 'skipped_empty'
        );
      }
      return true;
    });
  }, [preview, previewFilter]);

  const previewPerPage = 25;
  const pagedPreviewRows = filteredPreviewRows.slice(
    (previewPage - 1) * previewPerPage,
    previewPage * previewPerPage
  );

  const reviewQueue = useMemo(() => {
    const q = reviewSearch.trim().toLowerCase();
    return (data?.bookTitles ?? []).filter((b) => {
      if (b.reviewStatus === 'archived') return false;
      const confirmedCopies = copyCountByBook.get(b.id) ?? 0;
      const needsAttention = b.reviewStatus === 'needs_review' || confirmedCopies === 0;
      if (!needsAttention) return false;

      if (reviewFilter === 'unconfirmed_only' && confirmedCopies > 0) return false;
      if (
        reviewFilter !== 'all' &&
        reviewFilter !== 'unconfirmed_only' &&
        !b.reviewIssues.includes(reviewFilter as ReviewIssueCode)
      ) {
        return false;
      }

      if (q) {
        const hay = `${b.title} ${b.author} ${b.originalAuthorTitle} ${b.inventoryNumberRaw} ${b.departmentCode}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data?.bookTitles, copyCountByBook, reviewFilter, reviewSearch]);

  const reviewPerPage = 20;
  const pagedReview = reviewQueue.slice(
    (reviewPage - 1) * reviewPerPage,
    reviewPage * reviewPerPage
  );

  async function runPreview(mode: 'attached' | 'upload', file?: File | null) {
    setLoading(true);
    try {
      let res: Response;
      if (mode === 'upload') {
        if (!file) {
          toast.error('Iltimos, avval .xlsx faylni tanlang.');
          setLoading(false);
          return;
        }
        const fd = new FormData();
        fd.append('file', file);
        res = await authFetch('/api/import/preview', { method: 'POST', body: fd });
      } else {
        res = await authFetch('/api/import/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ useAttachedWorkbook: true }),
        });
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Faylni o‘qishda xatolik.');
      setSourceMode(mode);
      setPreview(json as ImportPreviewResult);
      setPreviewPage(1);
      setStage(1);
      toast.success(`${json.fileName} muvaffaqiyatli tekshirildi (${json.totalRowsScanned} qator).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Faylni tahlil qilishda xatolik.');
    } finally {
      setLoading(false);
    }
  }

  async function downloadErrorReport() {
    if (!preview) return;
    const id = toast.loading('Tekshiruv va xatoliklar hisoboti tayyorlanmoqda...');
    try {
      const res = await authFetch('/api/import/error-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: preview.fileName, rows: preview.rows }),
      });
      if (!res.ok) throw new Error('Hisobotni yuklab bo‘lmadi.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Inventar_Tekshiruv_Hisoboti.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Tekshiruv hisoboti yuklab olindi.', { id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Yuklab olishda xatolik.', { id });
    }
  }

  async function runCommit() {
    setLoading(true);
    try {
      let res: Response;
      if (sourceMode === 'upload' && selectedFile) {
        const fd = new FormData();
        fd.append('file', selectedFile);
        fd.append('autoConfirmClearSingleCopies', String(autoConfirmClear));
        res = await authFetch('/api/import/commit', { method: 'POST', body: fd });
      } else {
        res = await authFetch('/api/import/commit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            useAttachedWorkbook: true,
            autoConfirmClearSingleCopies: autoConfirmClear,
          }),
        });
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Importni saqlashda xatolik.');
      setCommitResult(json);
      setStage(4);
      await refreshData();
      if (json.skippedDuplicateFile) {
        toast.info('Ushbu fayl avval import qilingan. Takroriy yozuvlar yaratilmadi.');
      } else {
        toast.success(`Import yakunlandi: ${json.batch?.bookRowsCount ?? 0} ta yozuv saqlandi.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import xatoligi.');
    } finally {
      setLoading(false);
    }
  }

  async function batchConfirmClear() {
    setSavingReview(true);
    try {
      const res = await authFetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'batch_confirm_clear' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Tasdiqlashda xatolik.');
      await refreshData();
      toast.success(
        `${json.confirmedBooks} ta aniq yakka yozuv tasdiqlandi (${json.createdCopies} ta fizik nusxa yaratildi).`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setSavingReview(false);
    }
  }

  function openEditModal(book: BookTitle) {
    setEditingBook(book);
    setEditTitle(book.title);
    setEditAuthor(book.author);
    setEditYear(book.publicationYear ? String(book.publicationYear) : '');
    setEditDept(book.departmentCode);
    setEditInv(book.inventoryNumberRaw);
  }

  async function saveBookReview(markConfirmed: boolean) {
    if (!editingBook) return;
    setSavingReview(true);
    try {
      const res = await authFetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          bookId: editingBook.id,
          title: editTitle,
          author: editAuthor,
          publicationYear: editYear.trim() ? Number(editYear) : null,
          departmentCode: editDept,
          inventoryNumberRaw: editInv,
          reviewStatus: markConfirmed ? 'confirmed' : editingBook.reviewStatus,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Saqlashda xatolik.');

      // If confirming a non-range record that has 0 copies, let librarian explicitly confirm 1 copy if desired
      await refreshData();
      setEditingBook(null);
      toast.success('Yozuv ma’lumotlari yangilandi (asl inventar matni saqlab qolindi).');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setSavingReview(false);
    }
  }

  async function submitRangeConfirmation(e: React.FormEvent) {
    e.preventDefault();
    if (!rangeBook) return;
    const count = Number(rangeCopyCount);
    if (!Number.isInteger(count) || count < 1 || count > 500) {
      toast.error('Nusxalar soni 1 dan 500 gacha butun son bo‘lishi kerak.');
      return;
    }
    setSavingReview(true);
    try {
      const res = await authFetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm_range',
          bookId: rangeBook.id,
          copyCount: count,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Tasdiqlashda xatolik.');
      await refreshData();
      setRangeBook(null);
      toast.success(`${count} ta tasdiqlangan fizik nusxa yaratildi.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setSavingReview(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header & Top Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[#0F172A]">Inventar faylini yuklash</h2>
          <p className="text-xs text-[#64748B] mt-1">
            Maktabning asl XLSX inventar daftarini xavfsiz import qilish va ma’lumotlarni bosqichma-bosqich tekshirish
          </p>
        </div>
        <div className="inline-flex rounded-[10px] border border-[#E2E8F0] bg-white p-1 shrink-0">
          <button
            type="button"
            onClick={() => setActiveMode('wizard')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
              activeMode === 'wizard' ? 'bg-[#2563EB] text-white' : 'text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            Import ustasi
          </button>
          <button
            type="button"
            onClick={() => setActiveMode('review')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
              activeMode === 'review' ? 'bg-[#2563EB] text-white' : 'text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            Ma’lumotlarni tekshirish ({reviewQueue.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveMode('history')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
              activeMode === 'history' ? 'bg-[#2563EB] text-white' : 'text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            Import tarixi ({data?.importBatches.length ?? 0})
          </button>
        </div>
      </div>

      {/* MODE 1: 5-STAGE IMPORT WIZARD */}
      {activeMode === 'wizard' && (
        <div className="space-y-5">
          {/* Stepper */}
          <PanelCard className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {WIZARD_STAGES.map((label, idx) => {
                const isDone = idx < stage;
                const isCurrent = idx === stage;
                return (
                  <div
                    key={label}
                    className={`px-3 py-2 rounded-[9px] text-xs font-medium border transition-colors ${
                      isCurrent
                        ? 'border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]'
                        : isDone
                          ? 'border-[#E2E8F0] bg-[#F8FAFC] text-[#059669]'
                          : 'border-transparent text-[#64748B]'
                    }`}
                  >
                    <div className="truncate">{label}</div>
                  </div>
                );
              })}
            </div>
          </PanelCard>

          {/* Stage 0: Faylni tanlash */}
          {stage === 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <PanelCard className="p-6 flex flex-col justify-between">
                <div>
                  <div className="w-10 h-10 rounded-[10px] bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center mb-4">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-semibold text-[#0F172A]">
                    Biriktirilgan maktab inventari (Inventar.xlsx)
                  </h3>
                  <p className="text-xs text-[#64748B] mt-1.5 leading-relaxed">
                    Kattaqo‘rg‘on tuman ixtisoslashtirilgan maktabining tayyorlangan 1 488 qatorli asl inventar
                    faylini (`Лист1` varag‘i, 10 ta ustun) to‘g‘ridan-to‘g‘ri tekshirish va import qilish.
                  </p>
                  <ul className="mt-4 space-y-1.5 text-xs text-[#475569]">
                    <li>• Barcha 10 ta asl ustun va qator raqami o‘zgartirilmasdan saqlanadi</li>
                    <li>• Oraliq raqamlar (`1-72`, `1-96`) avtomatik nusxaga aylantirilmaydi</li>
                    <li>• Jami qatorlar (`Jami: 3769`) va bo‘sh sana qatorlari alohida hisobotlanadi</li>
                    <li>• Shubhali yillar (`20019`, `2028`) va takroriy raqamlar belgilanadi</li>
                  </ul>
                </div>
                <div className="mt-6">
                  <Button
                    variant="primary"
                    size="lg"
                    className="w-full"
                    disabled={loading}
                    onClick={() => void runPreview('attached')}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Fayl o‘qilmoqda...
                      </>
                    ) : (
                      <>
                        <FileSpreadsheet className="w-4 h-4" />
                        Inventar.xlsx faylini tekshirish
                      </>
                    )}
                  </Button>
                </div>
              </PanelCard>

              <PanelCard className="p-6 flex flex-col justify-between">
                <div>
                  <div className="w-10 h-10 rounded-[10px] bg-[#F8FAFC] border border-[#E2E8F0] text-[#475569] flex items-center justify-center mb-4">
                    <Upload className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-semibold text-[#0F172A]">
                    Kompyuterdan XLSX fayl yuklash
                  </h3>
                  <p className="text-xs text-[#64748B] mt-1.5 leading-relaxed">
                    Yangilangan yoki qo‘shimcha maktab inventar faylini (`.xlsx` formatida) tanlab yuklang.
                  </p>

                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-5 border-2 border-dashed border-[#CBD5E1] hover:border-[#2563EB] rounded-[12px] p-6 text-center cursor-pointer transition-colors bg-[#F8FAFC]"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx"
                      className="hidden"
                      onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                    />
                    <Upload className="w-6 h-6 text-[#64748B] mx-auto mb-2" />
                    <p className="text-xs font-medium text-[#0F172A]">
                      {selectedFile ? selectedFile.name : 'XLSX faylni tanlash uchun bosing'}
                    </p>
                    <p className="text-[11px] text-[#94A3B8] mt-1">
                      Faqat .xlsx format · 10 ustunli inventar jadvali
                    </p>
                  </div>
                </div>

                <div className="mt-6">
                  <Button
                    variant="outline"
                    size="lg"
                    className="w-full"
                    disabled={loading || !selectedFile}
                    onClick={() => void runPreview('upload', selectedFile)}
                  >
                    {loading ? 'Tekshirilmoqda...' : 'Tanlangan faylni tekshirish'}
                  </Button>
                </div>
              </PanelCard>
            </div>
          )}

          {/* Stage 1: Ma'lumotlarni tekshirish (Summary & Idempotency check) */}
          {stage === 1 && preview && (
            <PanelCard className="p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-[#0F172A]">
                    2-bosqich: Ma’lumotlar tahlili — {preview.fileName}
                  </h3>
                  <p className="text-xs text-[#64748B] mt-0.5">
                    Varag‘i: <span className="font-mono">{preview.sheetName}</span> · SHA-256:{' '}
                    <span className="font-mono">{preview.fileChecksum.slice(0, 14)}...</span>
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void downloadErrorReport()}>
                  <Download className="w-3.5 h-3.5" />
                  Tekshiruv hisobotini yuklab olish (XLSX)
                </Button>
              </div>

              {preview.alreadyImported && (
                <div className="p-4 rounded-[10px] border border-amber-200 bg-amber-50/70 flex items-start gap-3">
                  <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0 mt-0.5" />
                  <div className="text-xs text-[#92400E]">
                    <div className="font-semibold">Bu fayl avval import qilingan</div>
                    <p className="mt-0.5">
                      Faylning nazorat summasi mavjud import partiyasiga mos keldi. Qayta import qilinsa,
                      takroriy kitob yozuvlari yaratilmaydi (idempotent himoya faol).
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Jami tekshirilgan qatorlar', val: preview.totalRowsScanned },
                  { label: 'Kitob yozuvlari', val: preview.bookRowsCount },
                  { label: 'Aniq yakka yozuvlar', val: preview.clearSingleRecordsCount },
                  { label: 'Tekshiruv talab qiladiganlar', val: preview.needsReviewCount },
                  { label: 'Oraliq yozuvlar (1-72 kabi)', val: preview.rangeRecordCount },
                  { label: 'Takroriy inventar raqamlari', val: preview.duplicateInventoryCount },
                  { label: 'Shubhali nashr yillari', val: preview.invalidYearCount },
                  {
                    label: 'O‘tkazib yuborilgan qatorlar',
                    val: preview.skippedSubtotalCount + preview.skippedDateOnlyCount + preview.skippedEmptyCount,
                  },
                ].map((m) => (
                  <div key={m.label} className="p-4 rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC]">
                    <div className="text-[11px] text-[#64748B]">{m.label}</div>
                    <div className="text-xl font-semibold text-[#0F172A] tabular-nums mt-1">
                      {m.val.toLocaleString('uz-Latn-UZ')}
                    </div>
                  </div>
                ))}
              </div>

              <div className="text-xs text-[#475569] bg-[#F8FAFC] border border-[#E2E8F0] rounded-[10px] p-4 space-y-1">
                <div>
                  • O‘tkazib yuborilgan jami (subtotal) qatorlar:{' '}
                  <span className="font-mono font-medium">{preview.skippedSubtotalCount}</span>
                </div>
                <div>
                  • Kitob nomi bo‘lmagan, faqat sana yozilgan qatorlar:{' '}
                  <span className="font-mono font-medium">{preview.skippedDateOnlyCount}</span>
                </div>
                <div>
                  • Inventar raqami yo‘q kitob qatorlari:{' '}
                  <span className="font-mono font-medium">{preview.missingInventoryCount}</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button variant="outline" onClick={() => setStage(0)}>
                  Orqaga
                </Button>
                <Button variant="primary" onClick={() => setStage(2)}>
                  Muammolarni ko‘rib chiqish
                </Button>
              </div>
            </PanelCard>
          )}

          {/* Stage 2: Muammolarni ko'rib chiqish */}
          {stage === 2 && preview && (
            <PanelCard className="p-6 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-[#0F172A]">
                    3-bosqich: Muammoli va maxsus qatorlarni ko‘rib chiqish
                  </h3>
                  <p className="text-xs text-[#64748B] mt-0.5">
                    Barcha qatorlar asl matni bilan ko‘rsatiladi. Hech qanday sarlavha yoki nusxa soni yashirincha o‘zgartirilmaydi.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <SelectField
                    aria-label="Qatorlar filtri"
                    value={previewFilter}
                    onChange={(e) => {
                      setPreviewFilter(e.target.value as PreviewFilter);
                      setPreviewPage(1);
                    }}
                    className="w-56 h-9 text-xs"
                  >
                    <option value="issues">Barcha muammoli qatorlar</option>
                    <option value="ranges">Oraliq inventarlar (1-72 kabi)</option>
                    <option value="duplicates">Takroriy inventar raqamlari</option>
                    <option value="invalid_year">Shubhali nashr yillari</option>
                    <option value="missing_inv">Inventar raqami yo‘qlar</option>
                    <option value="skipped">O‘tkazib yuborilganlar (Jami / sana)</option>
                    <option value="all">Barcha qatorlar ({preview.rows.length})</option>
                  </SelectField>
                  <Button variant="outline" size="sm" onClick={() => void downloadErrorReport()}>
                    <Download className="w-3.5 h-3.5" />
                    Xatoliklar XLSX
                  </Button>
                </div>
              </div>

              <div className="overflow-x-auto border border-[#E2E8F0] rounded-[10px]">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[11px] font-medium text-[#64748B]">
                      <th className="py-2.5 px-3">Qator</th>
                      <th className="py-2.5 px-3">Asl inventar</th>
                      <th className="py-2.5 px-3">Asl matn (Muallif va kitob nomi)</th>
                      <th className="py-2.5 px-3">Taklif qilingan nomi / muallif</th>
                      <th className="py-2.5 px-3">Yil</th>
                      <th className="py-2.5 px-3">Bo‘lim</th>
                      <th className="py-2.5 px-3">Tekshiruv izohi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9] text-xs">
                    {pagedPreviewRows.map((row) => (
                      <tr key={row.sourceRowNumber} className="hover:bg-[#F8FAFC]">
                        <td className="py-2.5 px-3 font-mono text-[#64748B] tabular-nums">
                          #{row.sourceRowNumber}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[#0F172A] whitespace-nowrap">
                          {row.rawColumns.col2_inventoryNumber || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-[#0F172A] max-w-[240px] truncate" title={row.rawColumns.col4_authorTitle}>
                          {row.rawColumns.col4_authorTitle || '—'}
                        </td>
                        <td className="py-2.5 px-3 max-w-[220px]">
                          <div className="text-[#0F172A] truncate">{row.suggestedTitle || '—'}</div>
                          <div className="text-[11px] text-[#64748B] truncate">
                            {row.suggestedAuthor || 'Muallif ajratilmadi'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono tabular-nums whitespace-nowrap">
                          {row.rawColumns.col5_publicationYear || '—'}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[#475569]">
                          {row.rawColumns.col8_department || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-[11px]">
                          {row.validationStatus === 'skipped_subtotal' ? (
                            <StatusText tone="slate">Jami qatori (o‘tkaziladi)</StatusText>
                          ) : row.validationStatus === 'skipped_date_only' ? (
                            <StatusText tone="slate">Faqat sana (o‘tkaziladi)</StatusText>
                          ) : row.issues.length > 0 ? (
                            <StatusText tone="amber">
                              {row.issues.map((i) => ISSUE_LABELS[i]).join('; ')}
                            </StatusText>
                          ) : (
                            <StatusText tone="green">Aniq yozuv</StatusText>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between text-xs text-[#64748B]">
                <span>
                  Ko‘rsatilmoqda: {filteredPreviewRows.length} ta qatordan{' '}
                  {Math.min((previewPage - 1) * previewPerPage + 1, filteredPreviewRows.length)}–
                  {Math.min(previewPage * previewPerPage, filteredPreviewRows.length)}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={previewPage <= 1}
                    onClick={() => setPreviewPage((p) => p - 1)}
                  >
                    Oldingi
                  </Button>
                  <span className="font-mono tabular-nums">
                    {previewPage} / {Math.max(1, Math.ceil(filteredPreviewRows.length / previewPerPage))}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={previewPage * previewPerPage >= filteredPreviewRows.length}
                    onClick={() => setPreviewPage((p) => p + 1)}
                  >
                    Keyingi
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0]">
                <Button variant="outline" onClick={() => setStage(1)}>
                  Orqaga
                </Button>
                <Button variant="primary" onClick={() => setStage(3)}>
                  Importni tasdiqlash bosqichiga o‘tish
                </Button>
              </div>
            </PanelCard>
          )}

          {/* Stage 3: Importni tasdiqlash */}
          {stage === 3 && preview && (
            <PanelCard className="p-6 max-w-2xl space-y-5">
              <div>
                <h3 className="text-base font-semibold text-[#0F172A]">
                  4-bosqich: Importni tasdiqlash
                </h3>
                <p className="text-xs text-[#64748B] mt-1">
                  Quyidagi sozlamalarni tekshirib, ma’lumotlarni bazaga saqlashni tasdiqlang.
                </p>
              </div>

              <div className="p-4 rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC] space-y-2 text-xs text-[#334155]">
                <div className="flex justify-between">
                  <span>Fayl nomi:</span>
                  <span className="font-mono font-medium text-[#0F172A]">{preview.fileName}</span>
                </div>
                <div className="flex justify-between">
                  <span>Import qilinadigan kitob yozuvlari:</span>
                  <span className="font-mono font-semibold text-[#0F172A]">{preview.bookRowsCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Oraliq yozuvlar (avtomatik nusxa yaratilmaydi):</span>
                  <span className="font-mono font-semibold text-[#D97706]">{preview.rangeRecordCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>O‘tkazib yuboriladigan jami/bo‘sh qatorlar:</span>
                  <span className="font-mono text-[#64748B]">
                    {preview.skippedSubtotalCount + preview.skippedDateOnlyCount + preview.skippedEmptyCount}
                  </span>
                </div>
              </div>

              <label className="flex items-start gap-3 p-4 rounded-[10px] border border-[#E2E8F0] cursor-pointer hover:bg-[#F8FAFC]">
                <input
                  type="checkbox"
                  checked={autoConfirmClear}
                  onChange={(e) => setAutoConfirmClear(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-[#CBD5E1] text-[#2563EB]"
                />
                <div className="text-xs">
                  <div className="font-medium text-[#0F172A]">
                    Aniq yakka inventar yozuvlarini ({preview.clearSingleRecordsCount} ta) 1 nusxa sifatida tasdiqlash
                  </div>
                  <div className="text-[#64748B] mt-0.5">
                    Oraliq raqamlar (`1-72`, `1-96`), takroriy raqamlar, shubhali yillar va raqamsiz yozuvlar baribir
                    “Tekshiruv talab qilinadi” holatida qoladi va ularga avtomatik nusxa yaratilmaydi.
                  </div>
                </div>
              </label>

              <div className="flex items-center justify-between pt-2">
                <Button variant="outline" onClick={() => setStage(2)}>
                  Orqaga
                </Button>
                <Button variant="primary" disabled={loading} onClick={() => void runCommit()}>
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Bazaga saqlanmoqda...
                    </>
                  ) : (
                    'Importni tasdiqlash va saqlash'
                  )}
                </Button>
              </div>
            </PanelCard>
          )}

          {/* Stage 4: Natijalarni ko'rish */}
          {stage === 4 && commitResult && (
            <PanelCard className="p-6 space-y-6">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-[10px] bg-emerald-50 text-[#059669] flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-[#0F172A]">
                    5-bosqich: Import natijalari
                  </h3>
                  <p className="text-xs text-[#64748B] mt-0.5">
                    {commitResult.skippedDuplicateFile
                      ? 'Ushbu fayl avval import qilingani sababli takroriy yozuvlar qo‘shilmadi.'
                      : 'Asl inventar qatorlari va katalog yozuvlari ma’lumotlar bazasiga saqlandi.'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Jami tekshirilgan qatorlar', val: commitResult.batch?.totalRowsScanned ?? 0 },
                  { label: 'Kitob yozuvlari', val: commitResult.batch?.bookRowsCount ?? 0 },
                  { label: 'Tasdiqlangan yozuvlar', val: commitResult.batch?.confirmedCount ?? 0 },
                  { label: 'Tekshiruv talab qiladigan yozuvlar', val: commitResult.batch?.needsReviewCount ?? 0 },
                  { label: 'O‘tkazib yuborilgan qatorlar', val: commitResult.batch?.skippedCount ?? 0 },
                  { label: 'Takroriy inventar raqamlari', val: commitResult.batch?.duplicateInventoryCount ?? 0 },
                  { label: 'Oraliq yozuvlar (tasdiqlanmagan)', val: commitResult.batch?.rangeRecordCount ?? 0 },
                  { label: 'Xatoliklar', val: commitResult.batch?.errorCount ?? 0 },
                ].map((m) => (
                  <div key={m.label} className="p-4 rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC]">
                    <div className="text-[11px] text-[#64748B]">{m.label}</div>
                    <div className="text-xl font-semibold text-[#0F172A] tabular-nums mt-1">
                      {Number(m.val ?? 0).toLocaleString('uz-Latn-UZ')}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" onClick={() => setActiveMode('review')}>
                  Ma’lumotlarni tekshirish paneliga o‘tish
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setStage(0);
                    setPreview(null);
                    setCommitResult(null);
                  }}
                >
                  Yangi fayl yuklash
                </Button>
              </div>
            </PanelCard>
          )}
        </div>
      )}

      {/* MODE 2: MA'LUMOTLARNI TEKSHIRISH (Side-by-side discrepancy review panel) */}
      {activeMode === 'review' && (
        <div className="space-y-4">
          <PanelCard className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 flex-1">
              <Input
                value={reviewSearch}
                onChange={(e) => {
                  setReviewSearch(e.target.value);
                  setReviewPage(1);
                }}
                placeholder="Sarlavha, muallif yoki inventar raqami bo‘yicha qidirish..."
                className="max-w-xs h-9 text-xs"
              />
              <div className="flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-[#64748B]" />
                <SelectField
                  aria-label="Muammo turi"
                  value={reviewFilter}
                  onChange={(e) => {
                    setReviewFilter(e.target.value as ReviewQueueFilter);
                    setReviewPage(1);
                  }}
                  className="h-9 text-xs w-60"
                >
                  <option value="all">Barcha tekshiruv yozuvlari ({reviewQueue.length})</option>
                  <option value="range_ambiguous">Oraliq inventarlar (1-72, 1-96...)</option>
                  <option value="duplicate_inventory">Takroriy inventar raqamlari</option>
                  <option value="invalid_year">Shubhali nashr yillari</option>
                  <option value="missing_inventory_number">Inventar raqami yo‘qlar</option>
                  <option value="uncertain_author_split">Muallif ajratilishi noaniq</option>
                  <option value="unconfirmed_only">Fizik nusxasi tasdiqlanmaganlar</option>
                </SelectField>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              disabled={savingReview}
              onClick={() => void batchConfirmClear()}
            >
              <Check className="w-3.5 h-3.5" />
              Aniq yakka yozuvlarni ommaviy tasdiqlash
            </Button>
          </PanelCard>

          <PanelCard className="overflow-hidden">
            {pagedReview.length === 0 ? (
              <div className="py-16 text-center text-xs text-[#64748B]">
                Ushbu filtr bo‘yicha tekshiruv talab qiladigan yozuvlar topilmadi.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[11px] font-medium text-[#64748B]">
                      <th className="py-2.5 px-4">Asl manba (qator va matn)</th>
                      <th className="py-2.5 px-4">Taklif / joriy ma’lumotlar</th>
                      <th className="py-2.5 px-4">Tekshiruv sabablari</th>
                      <th className="py-2.5 px-4 text-right">Tasdiqlangan nusxalar</th>
                      <th className="py-2.5 px-4 text-right">Amallar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9] text-xs">
                    {pagedReview.map((bk) => {
                      const src = bk.sourceRecordId ? sourceRecordMap.get(bk.sourceRecordId) : null;
                      const copies = copyCountByBook.get(bk.id) ?? 0;
                      return (
                        <tr key={bk.id} className="hover:bg-[#F8FAFC]">
                          <td className="py-3 px-4 max-w-[260px]">
                            <div className="font-mono text-[11px] text-[#64748B]">
                              Qator #{bk.sourceRowNumber ?? '—'} · Inv: {bk.inventoryNumberRaw || 'yo‘q'}
                            </div>
                            <div className="text-[#0F172A] mt-0.5 truncate" title={bk.originalAuthorTitle}>
                              {bk.originalAuthorTitle}
                            </div>
                            {src && (
                              <div className="text-[11px] text-[#94A3B8] mt-0.5">
                                Asl yil: {src.rawColumns.col5_publicationYear || '—'} · Bo‘lim:{' '}
                                {src.rawColumns.col8_department || '—'}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 max-w-[240px]">
                            <div className="font-medium text-[#0F172A] truncate">{bk.title}</div>
                            <div className="text-[11px] text-[#64748B] truncate">
                              {bk.author || 'Muallif kiritilmagan'} · Yil: {bk.publicationYear ?? '—'} · Bo‘lim:{' '}
                              {bk.departmentCode || '—'}
                            </div>
                          </td>
                          <td className="py-3 px-4 max-w-[220px]">
                            {bk.reviewIssues.length > 0 ? (
                              <StatusText tone="amber">
                                {bk.reviewIssues.map((i) => ISSUE_LABELS[i]).join(' · ')}
                              </StatusText>
                            ) : (
                              <StatusText tone="slate">Nusxa soni tasdiqlanmagan</StatusText>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-[#0F172A]">
                            {copies}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <Button variant="outline" size="sm" onClick={() => openEditModal(bk)}>
                                Tahrirlash
                              </Button>
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => {
                                  setRangeBook(bk);
                                  const suggested =
                                    bk.isRangeRecord && bk.rangeStart && bk.rangeEnd
                                      ? Math.min(200, Math.max(1, bk.rangeEnd - bk.rangeStart + 1))
                                      : 1;
                                  setRangeCopyCount(String(suggested));
                                }}
                              >
                                {bk.isRangeRecord ? 'Oraliqni tasdiqlash' : 'Nusxa tasdiqlash'}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {reviewQueue.length > reviewPerPage && (
              <div className="px-4 py-3 border-t border-[#E2E8F0] flex items-center justify-between text-xs text-[#64748B]">
                <span>Jami {reviewQueue.length} ta yozuv</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={reviewPage <= 1}
                    onClick={() => setReviewPage((p) => p - 1)}
                  >
                    Oldingi
                  </Button>
                  <span className="font-mono tabular-nums">
                    {reviewPage} / {Math.ceil(reviewQueue.length / reviewPerPage)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={reviewPage * reviewPerPage >= reviewQueue.length}
                    onClick={() => setReviewPage((p) => p + 1)}
                  >
                    Keyingi
                  </Button>
                </div>
              </div>
            )}
          </PanelCard>
        </div>
      )}

      {/* MODE 3: IMPORT HISTORY */}
      {activeMode === 'history' && (
        <PanelCard className="overflow-hidden">
          {(data?.importBatches.length ?? 0) === 0 ? (
            <div className="py-16 text-center text-xs text-[#64748B]">
              Hozircha birorta import partiyasi mavjud emas.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[11px] font-medium text-[#64748B]">
                    <th className="py-2.5 px-4">Fayl nomi</th>
                    <th className="py-2.5 px-4">Sana va vaqt</th>
                    <th className="py-2.5 px-4 text-right">Tekshirilgan</th>
                    <th className="py-2.5 px-4 text-right">Kitoblar</th>
                    <th className="py-2.5 px-4 text-right">Tasdiqlangan</th>
                    <th className="py-2.5 px-4 text-right">Tekshiruvda</th>
                    <th className="py-2.5 px-4 text-right">O‘tkazilgan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9] text-xs">
                  {(data?.importBatches ?? []).map((b) => (
                    <tr key={b.id} className="hover:bg-[#F8FAFC]">
                      <td className="py-3 px-4 font-medium text-[#0F172A]">
                        {b.fileName}
                        <div className="text-[11px] font-mono text-[#94A3B8]">{b.sheetName}</div>
                      </td>
                      <td className="py-3 px-4 font-mono text-[#64748B] tabular-nums">
                        {formatDateTimeTashkent(b.createdAt)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">{b.totalRowsScanned}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">{b.bookRowsCount}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-[#059669]">
                        {b.confirmedCount}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-[#D97706]">
                        {b.needsReviewCount}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-[#64748B]">
                        {b.skippedCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PanelCard>
      )}

      {/* Side-by-side Edit Modal */}
      <ModalDialog
        open={Boolean(editingBook)}
        onOpenChange={(open) => !open && setEditingBook(null)}
        title="Inventar yozuvini tekshirish va tahrirlash"
        description="Asl Excel matni o‘zgarmas holda saqlanadi; katalog ma’lumotlarini aniqlashtiring."
        maxWidth="max-w-xl"
      >
        {editingBook && (
          <div className="space-y-4">
            <div className="p-3.5 rounded-[10px] bg-[#F8FAFC] border border-[#E2E8F0] text-xs space-y-1">
              <div className="text-[11px] font-medium text-[#64748B]">
                Asl Excel qatori (#{editingBook.sourceRowNumber ?? '—'})
              </div>
              <div className="text-[#0F172A] font-medium">{editingBook.originalAuthorTitle}</div>
              <div className="text-[#64748B] font-mono text-[11px]">
                Inventar: {editingBook.inventoryNumberRaw || '—'} · Yil: {editingBook.publicationYearRaw || '—'} ·
                Bo‘lim: {editingBook.departmentCode || '—'}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <FieldLabel htmlFor="rev-title" required>
                  Kitob nomi
                </FieldLabel>
                <Input id="rev-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              </div>
              <div>
                <FieldLabel htmlFor="rev-author">Muallif</FieldLabel>
                <Input id="rev-author" value={editAuthor} onChange={(e) => setEditAuthor(e.target.value)} />
              </div>
              <div>
                <FieldLabel htmlFor="rev-inv">Inventar raqami</FieldLabel>
                <Input id="rev-inv" value={editInv} onChange={(e) => setEditInv(e.target.value)} />
              </div>
              <div>
                <FieldLabel htmlFor="rev-year">Nashr yili (masalan, 2019)</FieldLabel>
                <Input
                  id="rev-year"
                  type="number"
                  value={editYear}
                  onChange={(e) => setEditYear(e.target.value)}
                />
              </div>
              <div>
                <FieldLabel htmlFor="rev-dept">Bo‘lim kodi</FieldLabel>
                <Input id="rev-dept" value={editDept} onChange={(e) => setEditDept(e.target.value)} />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditingBook(null)}>
                Bekor qilish
              </Button>
              <Button variant="secondary" disabled={savingReview} onClick={() => void saveBookReview(false)}>
                Faqat saqlash
              </Button>
              <Button variant="primary" disabled={savingReview} onClick={() => void saveBookReview(true)}>
                Tasdiqlab saqlash
              </Button>
            </div>
          </div>
        )}
      </ModalDialog>

      {/* Range / Copy Confirmation Modal */}
      <ModalDialog
        open={Boolean(rangeBook)}
        onOpenChange={(open) => !open && setRangeBook(null)}
        title="Fizik nusxalar sonini tasdiqlash"
        description="Kutubxona javonidagi haqiqiy nusxalar sonini kiriting. Tizim har bir nusxa uchun alohida ichki ID yaratadi."
      >
        {rangeBook && (
          <form onSubmit={submitRangeConfirmation} className="space-y-4">
            <div className="p-3.5 rounded-[10px] bg-[#F8FAFC] border border-[#E2E8F0] text-xs space-y-1">
              <div className="font-medium text-[#0F172A]">{rangeBook.title}</div>
              <div className="text-[#64748B]">
                Asl inventar yozuvi: <span className="font-mono text-[#0F172A]">{rangeBook.inventoryNumberRaw || 'yo‘q'}</span>
              </div>
              {rangeBook.isRangeRecord && rangeBook.rangeStart !== null && rangeBook.rangeEnd !== null && (
                <div className="text-[#D97706]">
                  Diqqat: Oraliq qiymat ({rangeBook.rangeStart}–{rangeBook.rangeEnd}) avtomatik hisoblanmadi.
                  Haqiqiy mavjud nusxalar sonini o‘zingiz tasdiqlang.
                </div>
              )}
            </div>

            <div>
              <FieldLabel htmlFor="range-count" required>
                Tasdiqlanadigan fizik nusxalar soni
              </FieldLabel>
              <Input
                id="range-count"
                type="number"
                min={1}
                max={500}
                value={rangeCopyCount}
                onChange={(e) => setRangeCopyCount(e.target.value)}
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setRangeBook(null)}>
                Bekor qilish
              </Button>
              <Button type="submit" variant="primary" disabled={savingReview}>
                {savingReview ? 'Yaratilmoqda...' : 'Nusxalarni tasdiqlash'}
              </Button>
            </div>
          </form>
        )}
      </ModalDialog>
    </div>
  );
}
