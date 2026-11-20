'use client';

import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useLibrary } from '@/components/library-context';
import { DatePicker } from '@/components/ui/date-picker';
import { Button, FieldLabel, PanelCard, SelectField } from '@/components/ui/primitives';
import { addDaysYmd, classifyLoanDeadline, getTodayTashkent } from '@/lib/date-utils';

export function ReportsView() {
  const { data, downloadFullXlsx, downloadTableXlsx } = useLibrary();
  const today = data?.dashboard.today || getTodayTashkent();

  const [fromDate, setFromDate] = useState(addDaysYmd(today, -30));
  const [toDate, setToDate] = useState(today);
  const [classFilter, setClassFilter] = useState('all');

  const studentMap = useMemo(
    () => new Map((data?.students ?? []).map((s) => [s.id, s])),
    [data?.students]
  );
  const bookMap = useMemo(
    () => new Map((data?.bookTitles ?? []).map((b) => [b.id, b])),
    [data?.bookTitles]
  );

  const classes = useMemo(() => {
    const set = new Set<string>();
    for (const s of data?.students ?? []) {
      if (s.className) set.add(s.className);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [data?.students]);

  const filteredLoans = useMemo(() => {
    return (data?.loans ?? []).filter((l) => {
      if (fromDate && l.issuedDate < fromDate) return false;
      if (toDate && l.issuedDate > toDate) return false;
      if (classFilter !== 'all') {
        const st = studentMap.get(l.studentId);
        if (st?.className !== classFilter) return false;
      }
      return true;
    });
  }, [data?.loans, fromDate, toDate, classFilter, studentMap]);

  const metrics = useMemo(() => {
    const activeLoans = filteredLoans.filter((l) => l.status === 'active');
    const overdueLoans = activeLoans.filter((l) => classifyLoanDeadline(l, today).bucket === 'overdue');
    const returnedLoans = filteredLoans.filter((l) => l.status === 'returned');
    const onTimeReturned = returnedLoans.filter((l) => l.returnedDate && l.returnedDate <= l.dueDate);
    const onTimeRate =
      returnedLoans.length > 0 ? Math.round((onTimeReturned.length / returnedLoans.length) * 100) : null;

    const confirmedCopies = (data?.physicalCopies ?? []).filter((c) => c.confirmed && c.status !== 'archived');
    const availableCopies = confirmedCopies.filter((c) => c.status === 'available').length;
    const needsReview = (data?.bookTitles ?? []).filter((b) => b.reviewStatus === 'needs_review').length;

    return {
      totalIssued: filteredLoans.length,
      activeCount: activeLoans.length,
      overdueCount: overdueLoans.length,
      onTimeRate,
      confirmedCopiesCount: confirmedCopies.length,
      availableCopies,
      needsReview,
    };
  }, [filteredLoans, today, data?.physicalCopies, data?.bookTitles]);

  // Daily series (last 14 days up to toDate)
  const dailySeries = useMemo(() => {
    const days: Array<{ date: string; label: string; berilgan: number; qaytarilgan: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = addDaysYmd(toDate || today, -i);
      days.push({ date: d, label: d.slice(5), berilgan: 0, qaytarilgan: 0 });
    }
    const map = new Map(days.map((d) => [d.date, d]));
    for (const l of filteredLoans) {
      const a = map.get(l.issuedDate);
      if (a) a.berilgan++;
      if (l.returnedDate) {
        const b = map.get(l.returnedDate);
        if (b) b.qaytarilgan++;
      }
    }
    return days;
  }, [filteredLoans, toDate, today]);

  // Monthly circulation
  const monthlySeries = useMemo(() => {
    const map = new Map<string, { month: string; berilgan: number; qaytarilgan: number }>();
    for (const l of filteredLoans) {
      const m = l.issuedDate.slice(0, 7);
      const entry = map.get(m) ?? { month: m, berilgan: 0, qaytarilgan: 0 };
      entry.berilgan++;
      if (l.status === 'returned') entry.qaytarilgan++;
      map.set(m, entry);
    }
    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [filteredLoans]);

  // Most active classes
  const classActivity = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of filteredLoans) {
      const cls = studentMap.get(l.studentId)?.className || 'Noma’lum';
      counts.set(cls, (counts.get(cls) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([sinf, soni]) => ({ sinf, soni }))
      .sort((a, b) => b.soni - a.soni)
      .slice(0, 10);
  }, [filteredLoans, studentMap]);

  // Top borrowed books
  const topBooks = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of filteredLoans) {
      counts.set(l.bookTitleId, (counts.get(l.bookTitleId) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([id, soni]) => {
        const bk = bookMap.get(id);
        return { id, title: bk?.title ?? '—', author: bk?.author ?? '—', soni };
      })
      .sort((a, b) => b.soni - a.soni)
      .slice(0, 10);
  }, [filteredLoans, bookMap]);

  async function exportTopBooks() {
    await downloadTableXlsx({
      fileName: 'Eng_Kop_Oqilgan_Kitoblar.xlsx',
      sheetName: 'Top kitoblar',
      headers: ['Kitob nomi', 'Muallif', 'Berilgan soni'],
      rows: topBooks.map((b) => [b.title, b.author, b.soni]),
      columnWidths: [40, 26, 16],
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[#0F172A]">Hisobotlar va tahlil</h2>
          <p className="text-xs text-[#64748B] mt-0.5">
            Faqat real ma’lumotlar bazasidan hisoblangan ko‘rsatkichlar va to‘liq Excel eksport
          </p>
        </div>
        <Button variant="primary" size="md" onClick={() => void downloadFullXlsx()}>
          <Download className="w-4 h-4" />
          Barcha ma’lumotlarni XLSX yuklab olish
        </Button>
      </div>

      {/* Filters */}
      <PanelCard className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <FieldLabel htmlFor="rep-from">Boshlanish sanasi</FieldLabel>
          <DatePicker id="rep-from" value={fromDate} onChange={setFromDate} />
        </div>
        <div>
          <FieldLabel htmlFor="rep-to">Tugash sanasi</FieldLabel>
          <DatePicker id="rep-to" value={toDate} onChange={setToDate} />
        </div>
        <div>
          <FieldLabel htmlFor="rep-class">Sinf bo‘yicha filtr</FieldLabel>
          <SelectField id="rep-class" value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
            <option value="all">Barcha sinflar</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                {c} sinfi
              </option>
            ))}
          </SelectField>
        </div>
      </PanelCard>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: 'Faol berishlar', val: metrics.activeCount },
          { label: 'Muddati o‘tganlar', val: metrics.overdueCount },
          {
            label: 'Vaqtida qaytarish ulushi',
            val: metrics.onTimeRate !== null ? `${metrics.onTimeRate}%` : '—',
          },
          {
            label: 'Tasdiqlangan zaxira (mavjud/jami)',
            val: `${metrics.availableCopies} / ${metrics.confirmedCopiesCount}`,
          },
          { label: 'Tekshiruv kutayotgan yozuvlar', val: metrics.needsReview },
        ].map((k) => (
          <PanelCard key={k.label} className="p-4">
            <div className="text-[11px] text-[#64748B]">{k.label}</div>
            <div className="text-xl font-semibold text-[#0F172A] tabular-nums mt-2">{k.val}</div>
          </PanelCard>
        ))}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PanelCard className="p-5">
          <h3 className="text-sm font-semibold text-[#0F172A]">Kunlik kitob berish va qaytarish</h3>
          <p className="text-xs text-[#64748B] mt-0.5 mb-4">So‘nggi 14 kunlik aylanma</p>
          {dailySeries.every((d) => d.berilgan === 0 && d.qaytarilgan === 0) ? (
            <div className="h-[220px] flex items-center justify-center text-xs text-[#64748B] border border-dashed border-[#E2E8F0] rounded-[10px]">
              Tanlangan davrda kunlik aylanma qayd etilmagan.
            </div>
          ) : (
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailySeries} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Bar dataKey="berilgan" name="Berilgan" fill="#2563EB" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="qaytarilgan" name="Qaytarilgan" fill="#059669" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </PanelCard>

        <PanelCard className="p-5">
          <h3 className="text-sm font-semibold text-[#0F172A]">Oylik kitob aylanmasi</h3>
          <p className="text-xs text-[#64748B] mt-0.5 mb-4">Oylar kesimida berilgan va qaytarilgan kitoblar</p>
          {monthlySeries.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-xs text-[#64748B] border border-dashed border-[#E2E8F0] rounded-[10px]">
              Oylik ma’lumotlar hali shakllanmagan.
            </div>
          ) : (
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlySeries} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="berilgan" name="Berilgan" stroke="#2563EB" strokeWidth={2} />
                  <Line type="monotone" dataKey="qaytarilgan" name="Qaytarilgan" stroke="#059669" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </PanelCard>

        <PanelCard className="p-5">
          <h3 className="text-sm font-semibold text-[#0F172A]">Eng faol sinflar</h3>
          <p className="text-xs text-[#64748B] mt-0.5 mb-4">Kitob olish soni bo‘yicha sinflar reytingi</p>
          {classActivity.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-xs text-[#64748B] border border-dashed border-[#E2E8F0] rounded-[10px]">
              Hozircha sinflar bo‘yicha faollik ma’lumoti yo‘q.
            </div>
          ) : (
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={classActivity} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="sinf" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Bar dataKey="soni" name="Berilgan kitoblar" fill="#1D4ED8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </PanelCard>

        <PanelCard className="p-5">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-[#0F172A]">Eng ko‘p berilgan kitoblar</h3>
              <p className="text-xs text-[#64748B] mt-0.5">Tanlangan davr bo‘yicha</p>
            </div>
            {topBooks.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => void exportTopBooks()}>
                <Download className="w-3.5 h-3.5" />
                XLSX
              </Button>
            )}
          </div>
          {topBooks.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-xs text-[#64748B] border border-dashed border-[#E2E8F0] rounded-[10px]">
              Tanlangan davrda kitob berish qayd etilmagan.
            </div>
          ) : (
            <div className="divide-y divide-[#F1F5F9]">
              {topBooks.map((b, i) => (
                <div key={b.id} className="py-2 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <div className="font-medium text-[#0F172A] truncate">
                      {i + 1}. {b.title}
                    </div>
                    <div className="text-[11px] text-[#64748B] truncate">{b.author}</div>
                  </div>
                  <span className="font-mono font-semibold text-[#0F172A] tabular-nums shrink-0">
                    {b.soni} marta
                  </span>
                </div>
              ))}
            </div>
          )}
        </PanelCard>
      </div>
    </div>
  );
}
