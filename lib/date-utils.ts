import type { DeadlineBucket, Loan } from './types';

export const TASHKENT_TIMEZONE = 'Asia/Tashkent';

/**
 * Returns today's date string (YYYY-MM-DD) strictly in Asia/Tashkent timezone.
 */
export function getTodayTashkent(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TASHKENT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now);
}

/**
 * Formats an ISO timestamp into readable Uzbek date/time in Asia/Tashkent.
 */
export function formatDateTimeTashkent(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('uz-Latn-UZ', {
    timeZone: TASHKENT_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * Formats YYYY-MM-DD into DD.MM.YYYY.
 */
export function formatYmdDisplay(ymd: string | null | undefined): string {
  if (!ymd) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!match) return ymd;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

/**
 * Parses a strict YYYY-MM-DD string into UTC midnight epoch ms for pure date-only arithmetic.
 */
export function parseYmdToUtcMs(ymd: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!match) {
    throw new Error(`Noto‘g‘ri sana formati: ${ymd}`);
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  return Date.UTC(y, m - 1, d);
}

/**
 * Adds integer days to a YYYY-MM-DD date string using UTC date arithmetic (DST-safe).
 */
export function addDaysYmd(ymd: string, days: number): string {
  const ms = parseYmdToUtcMs(ymd) + days * 86_400_000;
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns (targetYmd - baseYmd) in whole days.
 * Positive => target is in the future; 0 => same day; Negative => overdue.
 */
export function diffDaysYmd(targetYmd: string, baseYmd: string): number {
  const targetMs = parseYmdToUtcMs(targetYmd);
  const baseMs = parseYmdToUtcMs(baseYmd);
  return Math.round((targetMs - baseMs) / 86_400_000);
}

/**
 * Classifies a loan against today's date in Asia/Tashkent using date-only comparison.
 */
export function classifyLoanDeadline(
  loan: Pick<Loan, 'status' | 'dueDate'>,
  todayYmd: string = getTodayTashkent()
): { bucket: DeadlineBucket; deltaDays: number } {
  if (loan.status === 'returned') {
    return { bucket: 'returned', deltaDays: 0 };
  }
  const delta = diffDaysYmd(loan.dueDate, todayYmd);
  if (delta < 0) return { bucket: 'overdue', deltaDays: delta };
  if (delta === 0) return { bucket: 'due_today', deltaDays: 0 };
  if (delta === 1) return { bucket: 'due_tomorrow', deltaDays: 1 };
  if (delta <= 3) return { bucket: 'due_soon_3d', deltaDays: delta };
  return { bucket: 'in_progress', deltaDays: delta };
}

export function isValidYmd(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}
