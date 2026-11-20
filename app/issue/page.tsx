import { Suspense } from 'react';
import { IssueView } from '@/components/views/issue-view';

export default function IssuePage() {
  return (
    <Suspense fallback={<div className="text-xs text-[#64748B] py-8">Yuklanmoqda...</div>}>
      <IssueView />
    </Suspense>
  );
}
