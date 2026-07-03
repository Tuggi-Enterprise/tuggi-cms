'use client';

import { useEffect } from 'react';
import { useRouter } from '@/navigation';
import { Header } from '@/components/ui/Header';
import { useCmsUser } from '@/lib/hooks/useCmsUser';

// Layout do Módulo Eventos: gate por entitlement (espelha o layout do Marketing)
// + Header. Defesa em profundidade — o middleware.ts também bloqueia /eventos para
// quem não tem o módulo; aqui escondemos a UI de imediato no cliente.
export default function EventosLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { hasEvents, isLoading } = useCmsUser();

  useEffect(() => {
    if (!isLoading && !hasEvents) router.replace('/dashboard');
  }, [isLoading, hasEvents, router]);

  if (!isLoading && !hasEvents) return null;

  return (
    <>
      <Header />
      <main className="min-h-screen bg-gray-50/50 dark:bg-gray-950">{children}</main>
    </>
  );
}
