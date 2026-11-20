'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { toast } from 'sonner';
import { authFetch, clearSessionToken } from '@/lib/api-client';
import { auth, signOutFirebase, testFirestoreConnection } from '@/lib/firebase';
import type {
  ActivityLog,
  BookTitle,
  ImportBatch,
  InventoryIncident,
  LibrarianProfile,
  LibrarySettings,
  Loan,
  LoanExtension,
  NotificationItem,
  PhysicalCopy,
  SourceInventoryRecord,
  Student,
  StudentImportBackup,
  Teacher,
} from '@/lib/types';

export interface DashboardPayload {
  today: string;
  stats: {
    totalConfirmedCopies: number;
    availableCopies: number;
    issuedCopies: number;
    dueTodayCount: number;
    overdueCount: number;
    activeBorrowersCount: number;
    totalCatalogRecords: number;
    needsReviewCount: number;
    totalStudents: number;
    totalTeachers?: number;
  };
  dueTodayLoans: Loan[];
  overdueLoans: Loan[];
  recentActivities: ActivityLog[];
  activitySeries: Array<{ date: string; label: string; berilgan: number; qaytarilgan: number }>;
  topBooks: Array<{ bookTitleId: string; title: string; author: string; count: number }>;
  reviewSample: BookTitle[];
}

export type StudentImportBackupMeta = Omit<StudentImportBackup, 'previousStudents'>;

export interface LibraryStatePayload {
  user: LibrarianProfile;
  settings: LibrarySettings;
  dashboard: DashboardPayload;
  notifications: NotificationItem[];
  students: Student[];
  teachers: Teacher[];
  studentImportBackups: StudentImportBackupMeta[];
  bookTitles: BookTitle[];
  physicalCopies: PhysicalCopy[];
  importBatches: ImportBatch[];
  sourceInventoryRecords: SourceInventoryRecord[];
  loans: Loan[];
  loanExtensions: LoanExtension[];
  inventoryIncidents: InventoryIncident[];
  activityLogs: ActivityLog[];
}

interface LibraryContextValue {
  authLoading: boolean;
  dataLoading: boolean;
  setupRequired: boolean;
  user: LibrarianProfile | null;
  data: LibraryStatePayload | null;
  refreshSession: () => Promise<void>;
  refreshData: () => Promise<void>;
  logout: () => Promise<void>;
  downloadFullXlsx: () => Promise<void>;
  downloadTableXlsx: (params: {
    fileName: string;
    sheetName: string;
    headers: string[];
    rows: Array<Array<string | number | null | undefined>>;
    columnWidths?: number[];
  }) => Promise<void>;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [user, setUser] = useState<LibrarianProfile | null>(null);
  const [data, setData] = useState<LibraryStatePayload | null>(null);

  useEffect(() => {
    // Validate Firestore connection on initial app boot
    void testFirestoreConnection();
    const unsub = onAuthStateChanged(auth, () => {});
    return () => unsub();
  }, []);

  const refreshData = useCallback(async () => {
    setDataLoading(true);
    try {
      const res = await authFetch('/api/library/state', { cache: 'no-store' });
      if (res.status === 401) {
        clearSessionToken();
        setUser(null);
        setData(null);
        return;
      }
      if (!res.ok) {
        throw new Error('Ma’lumotlarni yuklashda xatolik yuz berdi.');
      }
      const payload = (await res.json()) as LibraryStatePayload;
      setData(payload);
      setUser(payload.user);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Server bilan bog‘lanishda xatolik.');
    } finally {
      setDataLoading(false);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    setAuthLoading(true);
    try {
      const res = await authFetch('/api/auth/session', { cache: 'no-store' });
      const json = await res.json();
      setSetupRequired(Boolean(json.setupRequired));
      if (json.authenticated && json.user) {
        setUser(json.user);
        await refreshData();
      } else {
        setUser(null);
        setData(null);
      }
    } catch {
      setUser(null);
      setData(null);
    } finally {
      setAuthLoading(false);
    }
  }, [refreshData]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await authFetch('/api/auth/session', { cache: 'no-store' });
        const json = await res.json();
        if (!active) return;
        setSetupRequired(Boolean(json.setupRequired));
        if (json.authenticated && json.user) {
          setUser(json.user);
          await refreshData();
        } else {
          setUser(null);
          setData(null);
        }
      } catch {
        if (!active) return;
        setUser(null);
        setData(null);
      } finally {
        if (active) setAuthLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshData]);

  const logout = useCallback(async () => {
    try {
      await authFetch('/api/auth/logout', { method: 'POST' });
      clearSessionToken();
      await signOutFirebase().catch(() => {});
      setUser(null);
      setData(null);
      toast.success('Tizimdan muvaffaqiyatli chiqdingiz.');
    } catch {
      toast.error('Chiqishda xatolik yuz berdi.');
    }
  }, []);

  const downloadFullXlsx = useCallback(async () => {
    const id = toast.loading('10 varaqli Excel hisoboti tayyorlanmoqda...');
    try {
      const res = await authFetch('/api/export/xlsx');
      if (!res.ok) throw new Error('Excel hisobotini yuklab olishda xatolik.');
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const match = /filename="([^"]+)"/.exec(cd);
      const filename = match?.[1] ?? 'School_Library_Hisobot.xlsx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('To‘liq XLSX hisoboti yuklab olindi.', { id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Yuklab olishda xatolik.', { id });
    }
  }, []);

  const downloadTableXlsx = useCallback(
    async (params: {
      fileName: string;
      sheetName: string;
      headers: string[];
      rows: Array<Array<string | number | null | undefined>>;
      columnWidths?: number[];
    }) => {
      const id = toast.loading('Jadval Excel formatiga tayyorlanmoqda...');
      try {
        const res = await authFetch('/api/export/xlsx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });
        if (!res.ok) throw new Error('Jadvalni yuklab olishda xatolik.');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = params.fileName.endsWith('.xlsx') ? params.fileName : `${params.fileName}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast.success('Jadval XLSX formatida yuklab olindi.', { id });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Yuklab olishda xatolik.', { id });
      }
    },
    []
  );

  return (
    <LibraryContext.Provider
      value={{
        authLoading,
        dataLoading,
        setupRequired,
        user,
        data,
        refreshSession,
        refreshData,
        logout,
        downloadFullXlsx,
        downloadTableXlsx,
      }}
    >
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used inside LibraryProvider');
  return ctx;
}
