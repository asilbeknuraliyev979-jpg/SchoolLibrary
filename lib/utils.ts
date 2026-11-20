import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function compareClassNames(a: string, b: string): number {
  const ma = /^(\d+)\s*[-–]?\s*(.*)$/.exec(a.trim());
  const mb = /^(\d+)\s*[-–]?\s*(.*)$/.exec(b.trim());
  if (ma && mb) {
    const gradeDiff = Number(ma[1]) - Number(mb[1]);
    if (gradeDiff !== 0) return gradeDiff;
    return ma[2].localeCompare(mb[2], 'uz');
  }
  return a.localeCompare(b, 'uz', { numeric: true });
}
