'use client';

import React, { useState } from 'react';
import { Download, KeyRound, Save, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useLibrary } from '@/components/library-context';
import { Button, FieldLabel, Input, PanelCard } from '@/components/ui/primitives';
import { authFetch } from '@/lib/api-client';

export function SettingsView() {
  const { data, user, refreshData, downloadFullXlsx } = useLibrary();

  const [schoolNameDraft, setSchoolNameDraft] = useState<string | null>(null);
  const [librarianNameDraft, setLibrarianNameDraft] = useState<string | null>(null);
  const [defaultLoanDaysDraft, setDefaultLoanDaysDraft] = useState<string | null>(null);
  const [maxBooksDraft, setMaxBooksDraft] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const schoolName = schoolNameDraft ?? data?.settings.schoolName ?? '';
  const librarianName = librarianNameDraft ?? data?.settings.librarianName ?? '';
  const defaultLoanDays = defaultLoanDaysDraft ?? String(data?.settings.defaultLoanDays ?? 14);
  const maxBooksPerStudent = maxBooksDraft ?? String(data?.settings.maxBooksPerStudent ?? 5);

  const setSchoolName = (v: string) => setSchoolNameDraft(v);
  const setLibrarianName = (v: string) => setLibrarianNameDraft(v);
  const setDefaultLoanDays = (v: string) => setDefaultLoanDaysDraft(v);
  const setMaxBooksPerStudent = (v: string) => setMaxBooksDraft(v);

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPass, setSavingPass] = useState(false);

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await authFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_settings',
          schoolName,
          librarianName,
          defaultLoanDays: Number(defaultLoanDays),
          maxBooksPerStudent: Number(maxBooksPerStudent),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Sozlamalarni saqlashda xatolik.');
      await refreshData();
      setSchoolNameDraft(null);
      setLibrarianNameDraft(null);
      setDefaultLoanDaysDraft(null);
      setMaxBooksDraft(null);
      toast.success('Kutubxona sozlamalari saqlandi.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error('Yangi parol kamida 8 ta belgidan iborat bo‘lishi kerak.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Yangi parollar bir-biriga mos kelmadi.');
      return;
    }
    setSavingPass(true);
    try {
      const res = await authFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Parolni yangilashda xatolik.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Parolingiz muvaffaqiyatli yangilandi.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
    } finally {
      setSavingPass(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl font-semibold text-[#0F172A]">Sozlamalar</h2>
        <p className="text-xs text-[#64748B] mt-0.5">
          Kutubxona qoidalari, xavfsizlik paroli va to‘liq ma’lumotlar zahira nusxasini (XLSX) boshqarish
        </p>
      </div>

      {/* Prominent Full Data Export Card */}
      <PanelCard className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#EFF6FF]/60 border-[#BFDBFE]">
        <div>
          <h3 className="text-sm font-semibold text-[#0F172A]">
            To‘liq ma’lumotlar zahirasi (10 varaqli XLSX)
          </h3>
          <p className="text-xs text-[#475569] mt-1">
            Statistika, katalog, asl inventar yozuvlari, fizik nusxalar, o‘quvchilar, berilgan va qaytarilgan
            kitoblar, muddati o‘tganlar hamda operatsiyalar tarixi bitta Excel faylida.
          </p>
        </div>
        <Button variant="primary" size="md" onClick={() => void downloadFullXlsx()} className="shrink-0">
          <Download className="w-4 h-4" />
          Barcha ma’lumotlarni XLSX yuklab olish
        </Button>
      </PanelCard>

      {/* General Library Settings */}
      <PanelCard className="p-6">
        <h3 className="text-sm font-semibold text-[#0F172A] mb-4">Kutubxona umumiy sozlamalari</h3>
        <form onSubmit={handleSaveSettings} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="set-school" required>
                Maktab nomi
              </FieldLabel>
              <Input
                id="set-school"
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                required
              />
            </div>
            <div>
              <FieldLabel htmlFor="set-lib" required>
                Asosiy kutubxonachi ismi
              </FieldLabel>
              <Input
                id="set-lib"
                value={librarianName}
                onChange={(e) => setLibrarianName(e.target.value)}
                required
              />
            </div>
            <div>
              <FieldLabel htmlFor="set-tz">Vaqt mintaqasi</FieldLabel>
              <Input id="set-tz" value="Asia/Tashkent (UTC+5)" disabled />
            </div>
            <div>
              <FieldLabel htmlFor="set-days" required>
                Standart kitob berish muddati (kun)
              </FieldLabel>
              <Input
                id="set-days"
                type="number"
                min={1}
                max={365}
                value={defaultLoanDays}
                onChange={(e) => setDefaultLoanDays(e.target.value)}
                required
              />
            </div>
            <div>
              <FieldLabel htmlFor="set-max" required>
                Bir o‘quvchiga maksimal kitoblar soni
              </FieldLabel>
              <Input
                id="set-max"
                type="number"
                min={1}
                max={50}
                value={maxBooksPerStudent}
                onChange={(e) => setMaxBooksPerStudent(e.target.value)}
                required
              />
            </div>
          </div>
          <Button type="submit" variant="primary" size="md" disabled={savingSettings}>
            <Save className="w-4 h-4" />
            {savingSettings ? 'Saqlanmoqda...' : 'Sozlamalarni saqlash'}
          </Button>
        </form>
      </PanelCard>

      {/* Password Update */}
      {user?.authProvider === 'credentials' && (
        <PanelCard className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <KeyRound className="w-4 h-4 text-[#2563EB]" />
            <h3 className="text-sm font-semibold text-[#0F172A]">Hisob parolini yangilash</h3>
          </div>
          <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
            <div>
              <FieldLabel htmlFor="set-cur-pass" required>
                Joriy parol
              </FieldLabel>
              <Input
                id="set-cur-pass"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div>
              <FieldLabel htmlFor="set-new-pass" required>
                Yangi parol (kamida 8 belgi)
              </FieldLabel>
              <Input
                id="set-new-pass"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
            <div>
              <FieldLabel htmlFor="set-conf-pass" required>
                Yangi parolni tasdiqlang
              </FieldLabel>
              <Input
                id="set-conf-pass"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" variant="outline" disabled={savingPass}>
              {savingPass ? 'Yangilanmoqda...' : 'Parolni yangilash'}
            </Button>
          </form>
        </PanelCard>
      )}

      {/* Barcode / QR Architecture Info */}
      <PanelCard className="p-5 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-[#059669] shrink-0 mt-0.5" />
        <div className="text-xs text-[#475569] space-y-1">
          <div className="font-semibold text-[#0F172A]">
            Shtrix-kod va QR-kodga tayyor ichki identifikatorlar
          </div>
          <p>
            Har bir tasdiqlangan fizik nusxa o‘zining noyob ichki kodi (`SL-CP-...`) va shtrix-kod qiymati
            (`BC-...`) bilan yaratiladi. Kitob berish va qaytarish qidiruv maydonlari ushbu kodlarni
            to‘g‘ridan-to‘g‘ri skaner orqali qabul qilishga tayyor.
          </p>
        </div>
      </PanelCard>
    </div>
  );
}
