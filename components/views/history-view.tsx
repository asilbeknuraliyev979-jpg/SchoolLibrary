'use client';

import React, { useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { useLibrary } from '@/components/library-context';
import { Button, Input, PanelCard, SelectField } from '@/components/ui/primitives';
import { formatDateTimeTashkent } from '@/lib/date-utils';

export function HistoryView() {
  const { data, downloadTableXlsx } = useLibrary();
  const [query, setQuery] = useState('');
  const [entityFilter, setEntityFilter] = useState('all');

  const logs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.activityLogs ?? []).filter((a) => {
      if (entityFilter !== 'all' && a.entityType !== entityFilter) return false;
      if (q) {
        const hay = `${a.action} ${a.summary} ${a.actorName} ${a.entityType}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data?.activityLogs, query, entityFilter]);

  async function exportHistory() {
    await downloadTableXlsx({
      fileName: 'Operatsiyalar_Tarixi.xlsx',
      sheetName: 'Operatsiyalar tarixi',
      headers: ['Sana va vaqt', 'Amal', 'Bo‘lim', 'Tavsif', 'Ijrochi'],
      rows: logs.map((a) => [
        formatDateTimeTashkent(a.createdAt),
        a.action,
        a.entityType,
        a.summary,
        a.actorName,
      ]),
      columnWidths: [22, 24, 16, 52, 20],
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[#0F172A]">Operatsiyalar tarixi</h2>
          <p className="text-xs text-[#64748B] mt-0.5">
            Barcha import, katalog, o‘quvchi, kitob berish, qaytarish va muddat uzaytirish amallari jurnali
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void exportHistory()}>
          <Download className="w-3.5 h-3.5" />
          Excel eksport
        </Button>
      </div>

      <PanelCard className="p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tavsif, amal turi yoki ijrochi bo‘yicha qidirish..."
            className="pl-9 h-9 text-xs"
          />
        </div>
        <SelectField
          aria-label="Bo‘lim filtri"
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          className="h-9 text-xs sm:w-48"
        >
          <option value="all">Barcha bo‘limlar</option>
          <option value="loan">Kitob berish / qaytarish</option>
          <option value="book_title">Katalog</option>
          <option value="student">O‘quvchilar</option>
          <option value="import_batch">Inventar importi</option>
          <option value="settings">Sozlamalar</option>
        </SelectField>
      </PanelCard>

      <PanelCard className="overflow-hidden">
        {logs.length === 0 ? (
          <div className="py-16 text-center text-xs text-[#64748B]">
            Hozircha qayd etilgan operatsiyalar yo‘q.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[11px] font-medium text-[#64748B]">
                  <th className="py-2.5 px-4">Sana va vaqt</th>
                  <th className="py-2.5 px-4">Amal</th>
                  <th className="py-2.5 px-4">Tavsif</th>
                  <th className="py-2.5 px-4">Ijrochi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9] text-xs">
                {logs.slice(0, 200).map((a) => (
                  <tr key={a.id} className="hover:bg-[#F8FAFC]">
                    <td className="py-3 px-4 font-mono text-[#64748B] whitespace-nowrap tabular-nums">
                      {formatDateTimeTashkent(a.createdAt)}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-[#1D4ED8] whitespace-nowrap">
                      {a.action}
                    </td>
                    <td className="py-3 px-4 text-[#0F172A]">{a.summary}</td>
                    <td className="py-3 px-4 text-[#475569] whitespace-nowrap">{a.actorName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelCard>
    </div>
  );
}
