'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { toast } from 'sonner';
import { authFetch, clearSessionToken } from '@/lib/api-client';
import { patchLoanReturned } from '@/lib/client-state-patch';
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
  ReturnCondition,
  SourceInventoryRecord,
  Student,
  StudentImportBackup,
  Teacher,
} from '@/lib/types';
import { compareClassNames, compareUzText } from '@/lib/utils';

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
  isFullPayload?: boolean;
}

export interface LibraryIndexes {
  studentMap: Map<string, Student>;
  teacherMap: Map<string, Teacher>;
  bookMap: Map<string, BookTitle>;
  copyMap: Map<string, PhysicalCopy>;
  sortedActiveStudents: Student[];
  sortedArchivedStudents: Student[];
  sortedActiveTeachers: Teacher[];
  activeClasses: string[];
  copiesByBook: Map<string, { total: number; available: number; issued: number }>;
  availableCopiesByBook: Map<string, Array<{ id: string; inv: string }>>;
  bookSearchText: Map<string, string>;
  studentSearchText: Map<string, string>;
  teacherSearchText: Map<string, string>;
}

const CORE_CLIENT_ROUTES = new Set([
  '/',
  '/catalog',
  '/students',
  '/teachers',
  '/issue',
  '/returns',
  '/deadlines',
]);

interface LibraryContextValue {
  authLoading: boolean;
  dataLoading: boolean;
  setupRequired: boolean;
  user: LibrarianProfile | null;
  data: LibraryStatePayload | null;
  indexes: LibraryIndexes;
  activePath: string;
  navigate: (href: string) => void;
  mutateData: (updater: (prev: LibraryStatePayload) => LibraryStatePayload) => void;
  returnLoanOptimistic: (
    loanId: string,
    options?: { condition?: ReturnCondition; notes?: string }
  ) => Promise<boolean>;
  refreshSession: () => Promise<void>;
  refreshData: (options?: { full?: boolean; silent?: boolean }) => Promise<void>;
  ensureFullData: () => Promise<void>;
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
  const nextPathname = usePathname() || '/';
  const [pathOverride, setPathOverride] = useState<{ base: string; path: string } | null>(null);
  const activePath = pathOverride && pathOverride.base === nextPathname ? pathOverride.path : nextPathname;

  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [user, setUser] = useState<LibrarianProfile | null>(null);
  const [data, setData] = useState<LibraryStatePayload | null>(null);

  const dataRef = useRef<LibraryStatePayload | null>(null);
  const inflightFullRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // Keep instant client-side navigation synced with browser Back/Forward buttons
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      setPathOverride({ base: nextPathname, path: window.location.pathname || '/' });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [nextPathname]);

  const navigate = useCallback(
    (href: string) => {
      if (typeof window === 'undefined') return;
      if (CORE_CLIENT_ROUTES.has(href)) {
        if (window.location.pathname !== href) {
          window.history.pushState(null, '', href);
        }
        setPathOverride({ base: nextPathname, path: href });
        window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
      } else {
        window.location.assign(href);
      }
    },
    [nextPathname]
  );

  // Defer Firebase connectivity check slightly so it never contends with first paint or clicks
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void testFirestoreConnection();
    }, 1200);
    const unsub = onAuthStateChanged(auth, () => {});
    return () => {
      window.clearTimeout(timer);
      unsub();
    };
  }, []);

  const refreshData = useCallback(async (options?: { full?: boolean; silent?: boolean }) => {
    const full = Boolean(options?.full);
    const silent = Boolean(options?.silent);
    if (!silent) setDataLoading(true);
    try {
      const url = full ? '/api/library/state?full=1' : '/api/library/state';
      const res = await authFetch(url, { cache: 'no-store' });
      if (res.status === 401) {
        const json = await res.json().catch(() => ({}));
        setSetupRequired(Boolean(json.setupRequired));
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
      if (!silent) setDataLoading(false);
    }
  }, []);

  const ensureFullData = useCallback(async () => {
    if (dataRef.current?.isFullPayload) return;
    if (!inflightFullRef.current) {
      inflightFullRef.current = refreshData({ full: true, silent: true }).finally(() => {
        inflightFullRef.current = null;
      });
    }
    await inflightFullRef.current;
  }, [refreshData]);

  // Single-request session + state bootstrap (cuts startup latency in half)
  const refreshSession = useCallback(async () => {
    setAuthLoading(true);
    try {
      const res = await authFetch('/api/library/state', { cache: 'no-store' });
      if (res.status === 401) {
        const json = await res.json().catch(() => ({}));
        setSetupRequired(Boolean(json.setupRequired));
        setUser(null);
        setData(null);
        return;
      }
      if (!res.ok) {
        setUser(null);
        setData(null);
        return;
      }
      const payload = (await res.json()) as LibraryStatePayload;
      setSetupRequired(false);
      setData(payload);
      setUser(payload.user);
    } catch {
      setUser(null);
      setData(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await authFetch('/api/library/state', { cache: 'no-store' });
        if (!active) return;
        if (res.status === 401) {
          const json = await res.json().catch(() => ({}));
          if (!active) return;
          setSetupRequired(Boolean(json.setupRequired));
          setUser(null);
          setData(null);
          return;
        }
        if (!res.ok) {
          setUser(null);
          setData(null);
          return;
        }
        const payload = (await res.json()) as LibraryStatePayload;
        if (!active) return;
        setSetupRequired(false);
        setData(payload);
        setUser(payload.user);
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
  }, []);

  const mutateData = useCallback(
    (updater: (prev: LibraryStatePayload) => LibraryStatePayload) => {
      setData((prev) => (prev ? updater(prev) : prev));
    },
    []
  );

  // Optimistic one-click return: updates UI immediately (<16ms), rolls back if server rejects
  const returnLoanOptimistic = useCallback(
    async (
      loanId: string,
      options?: { condition?: ReturnCondition; notes?: string }
    ): Promise<boolean> => {
      const snapshot = dataRef.current;
      const condition: ReturnCondition = options?.condition ?? 'good';

      if (snapshot) {
        setData((prev) => (prev ? patchLoanReturned(prev, { loanId }) : prev));
      }

      try {
        const res = await authFetch('/api/loans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'return',
            loanId,
            condition,
            notes: options?.notes ?? '',
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Qaytarishda xatolik.');
        setData((prev) =>
          prev
            ? patchLoanReturned(prev, {
                loanId,
                loan: json.loan,
                copy: json.copy,
                incident: json.incident ?? null,
              })
            : prev
        );
        toast.success('Kitob qaytarildi.');
        return true;
      } catch (err) {
        if (snapshot) setData(snapshot);
        toast.error(err instanceof Error ? err.message : 'Xatolik yuz berdi.');
        return false;
      }
    },
    []
  );

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

  // Pre-build shared lookup Maps & pre-sorted arrays ONCE when each collection changes
  const studentIndexes = useMemo(() => {
    const students = data?.students ?? [];
    const studentMap = new Map<string, Student>();
    const studentSearchText = new Map<string, string>();
    const active: Student[] = [];
    const archived: Student[] = [];
    const classSet = new Set<string>();

    for (const s of students) {
      studentMap.set(s.id, s);
      studentSearchText.set(s.id, `${s.fullName} ${s.className}`.toLowerCase());
      if (s.status === 'active') {
        active.push(s);
        if (s.className) classSet.add(s.className);
      } else {
        archived.push(s);
      }
    }

    const sortStudents = (a: Student, b: Student) => {
      const c = compareClassNames(a.className, b.className);
      return c !== 0 ? c : compareUzText(a.fullName, b.fullName);
    };
    active.sort(sortStudents);
    archived.sort(sortStudents);

    return {
      studentMap,
      studentSearchText,
      sortedActiveStudents: active,
      sortedArchivedStudents: archived,
      activeClasses: Array.from(classSet).sort(compareClassNames),
    };
  }, [data?.students]);

  const teacherIndexes = useMemo(() => {
    const teachers = data?.teachers ?? [];
    const teacherMap = new Map<string, Teacher>();
    const teacherSearchText = new Map<string, string>();
    const active: Teacher[] = [];

    for (const t of teachers) {
      teacherMap.set(t.id, t);
      teacherSearchText.set(t.id, `${t.fullName} ${t.position}`.toLowerCase());
      if (t.status === 'active') active.push(t);
    }
    active.sort((a, b) => compareUzText(a.fullName, b.fullName));

    return {
      teacherMap,
      teacherSearchText,
      sortedActiveTeachers: active,
    };
  }, [data?.teachers]);

  const bookIndexes = useMemo(() => {
    const books = data?.bookTitles ?? [];
    const bookMap = new Map<string, BookTitle>();
    const bookSearchText = new Map<string, string>();
    for (const b of books) {
      bookMap.set(b.id, b);
      bookSearchText.set(
        b.id,
        `${b.title} ${b.author} ${b.inventoryNumberRaw} ${b.originalAuthorTitle}`.toLowerCase()
      );
    }
    return { bookMap, bookSearchText };
  }, [data?.bookTitles]);

  const copyIndexes = useMemo(() => {
    const copies = data?.physicalCopies ?? [];
    const copyMap = new Map<string, PhysicalCopy>();
    const copiesByBook = new Map<string, { total: number; available: number; issued: number }>();
    const availableCopiesByBook = new Map<string, Array<{ id: string; inv: string }>>();

    for (const c of copies) {
      copyMap.set(c.id, c);
      if (c.confirmed && c.status !== 'archived') {
        let entry = copiesByBook.get(c.bookTitleId);
        if (!entry) {
          entry = { total: 0, available: 0, issued: 0 };
          copiesByBook.set(c.bookTitleId, entry);
        }
        entry.total += 1;
        if (c.status === 'available') {
          entry.available += 1;
          let list = availableCopiesByBook.get(c.bookTitleId);
          if (!list) {
            list = [];
            availableCopiesByBook.set(c.bookTitleId, list);
          }
          list.push({ id: c.id, inv: c.originalInventoryNumber || c.internalCopyCode });
        } else if (c.status === 'issued') {
          entry.issued += 1;
        }
      }
    }

    return { copyMap, copiesByBook, availableCopiesByBook };
  }, [data?.physicalCopies]);

  const indexes = useMemo<LibraryIndexes>(
    () => ({
      ...studentIndexes,
      ...teacherIndexes,
      ...bookIndexes,
      ...copyIndexes,
    }),
    [bookIndexes, copyIndexes, studentIndexes, teacherIndexes]
  );

  const contextValue = useMemo<LibraryContextValue>(
    () => ({
      authLoading,
      dataLoading,
      setupRequired,
      user,
      data,
      indexes,
      activePath,
      navigate,
      mutateData,
      returnLoanOptimistic,
      refreshSession,
      refreshData,
      ensureFullData,
      logout,
      downloadFullXlsx,
      downloadTableXlsx,
    }),
    [
      authLoading,
      dataLoading,
      setupRequired,
      user,
      data,
      indexes,
      activePath,
      navigate,
      mutateData,
      returnLoanOptimistic,
      refreshSession,
      refreshData,
      ensureFullData,
      logout,
      downloadFullXlsx,
      downloadTableXlsx,
    ]
  );

  return <LibraryContext.Provider value={contextValue}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used inside LibraryProvider');
  return ctx;
}
