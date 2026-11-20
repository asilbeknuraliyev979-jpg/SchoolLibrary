import { Suspense } from 'react';
import { StudentsView } from '@/components/views/students-view';

export default function StudentsPage() {
  return (
    <Suspense fallback={<div className="text-xs text-[#64748B] py-8">O‘quvchilar yuklanmoqda...</div>}>
      <StudentsView />
    </Suspense>
  );
}
