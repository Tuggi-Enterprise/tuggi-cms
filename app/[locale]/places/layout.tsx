'use client';

import { useEffect } from 'react';
import { useRouter } from '@/navigation';
import { Header } from '@/components/ui/Header';
import { useCmsUser } from '@/lib/hooks/useCmsUser';

// Layout do Módulo Locais/Comércios: gate por entitlement (espelha Eventos) +
// Header. Defesa em profundidade junto do middleware.ts.
export default function LocaisLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { hasPlaces, isLoading } = useCmsUser();

  useEffect(() => {
    if (!isLoading && !hasPlaces) router.replace('/dashboard');
  }, [isLoading, hasPlaces, router]);

  if (!isLoading && !hasPlaces) return null;

  return (
    <>
      <Header />
      <main className="min-h-screen bg-gray-50/50 dark:bg-gray-950">{children}</main>
    </>
  );
}
