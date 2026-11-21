import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Module-level cached collators avoid instantiating Intl collation rules on every .sort() comparison
const uzCollator = new Intl.Collator("uz", { sensitivity: "base" });
const uzNumericCollator = new Intl.Collator("uz", { numeric: true, sensitivity: "base" });

export function compareUzText(a: string, b: string): number {
  return uzCollator.compare(a, b);
}

const classKeyCache = new Map<string, { hasNum: boolean; grade: number; suffix: string; raw: string }>();

function getClassSortKey(raw: string) {
  const cached = classKeyCache.get(raw);
  if (cached) return cached;
  const trimmed = raw.trim();
  const m = /^(\d+)\s*[-–]?\s*(.*)$/.exec(trimmed);
  const key = m
    ? { hasNum: true, grade: Number(m[1]), suffix: m[2], raw: trimmed }
    : { hasNum: false, grade: 0, suffix: "", raw: trimmed };
  if (classKeyCache.size < 500) {
    classKeyCache.set(raw, key);
  }
  return key;
}

export function compareClassNames(a: string, b: string): number {
  if (a === b) return 0;
  const ka = getClassSortKey(a);
  const kb = getClassSortKey(b);
  if (ka.hasNum && kb.hasNum) {
    const gradeDiff = ka.grade - kb.grade;
    if (gradeDiff !== 0) return gradeDiff;
    return uzCollator.compare(ka.suffix, kb.suffix);
  }
  return uzNumericCollator.compare(ka.raw, kb.raw);
}
