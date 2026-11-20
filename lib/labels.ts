import type { CopyStatus, DeadlineBucket, ReturnCondition, ReviewIssueCode } from './types';

export const ISSUE_LABELS: Record<ReviewIssueCode, string> = {
  range_ambiguous: 'Inventar oralig‘i (nusxa soni tasdiqlanmagan)',
  duplicate_inventory: 'Takroriy inventar raqami',
  invalid_year: 'Shubhali nashr yili',
  missing_inventory_number: 'Inventar raqami yo‘q',
  uncertain_author_split: 'Muallif / sarlavha ajratilishi noaniq',
  missing_year: 'Nashr yili ko‘rsatilmagan',
};

export const COPY_STATUS_LABELS: Record<CopyStatus, { label: string; tone: 'blue' | 'green' | 'amber' | 'red' | 'slate' }> = {
  available: { label: 'Mavjud', tone: 'green' },
  issued: { label: 'Berilgan', tone: 'blue' },
  damaged: { label: 'Shikastlangan', tone: 'amber' },
  lost: { label: 'Yo‘qolgan', tone: 'red' },
  archived: { label: 'Arxivda', tone: 'slate' },
};

export const RETURN_CONDITION_LABELS: Record<ReturnCondition, string> = {
  good: 'Yaxshi holatda',
  damaged: 'Shikastlangan',
  lost: 'Yo‘qolgan',
};

export function getDeadlineBadge(
  bucket: DeadlineBucket,
  deltaDays: number
): { label: string; tone: 'blue' | 'green' | 'amber' | 'red' } {
  if (bucket === 'returned') {
    return { label: 'Qaytarilgan', tone: 'green' };
  }
  if (bucket === 'overdue') {
    return { label: `Muddati o‘tgan (${Math.abs(deltaDays)} kun)`, tone: 'red' };
  }
  if (bucket === 'due_today') {
    return { label: 'Bugun qaytariladi', tone: 'amber' };
  }
  if (bucket === 'due_tomorrow') {
    return { label: 'Ertaga qaytariladi', tone: 'amber' };
  }
  if (bucket === 'due_soon_3d') {
    return { label: `Yaqinlashmoqda (${deltaDays} kun)`, tone: 'amber' };
  }
  return { label: `Jarayonda (${deltaDays} kun)`, tone: 'blue' };
}
