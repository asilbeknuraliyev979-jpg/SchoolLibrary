import { Suspense } from 'react';
import { CatalogView } from '@/components/views/catalog-view';

export default function CatalogPage() {
  return (
    <Suspense fallback={<div className="text-xs text-[#64748B] py-8">Katalog yuklanmoqda...</div>}>
      <CatalogView />
    </Suspense>
  );
}
