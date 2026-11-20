import { Suspense } from 'react';
import { ReturnsView } from '@/components/views/returns-view';

export default function ReturnsPage() {
  return (
    <Suspense fallback={<div className="text-xs text-[#64748B] py-8">Yuklanmoqda...</div>}>
      <ReturnsView />
    </Suspense>
  );
}
