'use client';

import { useEffect } from 'react';
import { useRouter } from '@/navigation';
import { useCmsUser } from '@/lib/hooks/useCmsUser';
import { isMarketingEnabled } from '@/lib/modules/marketing';

// Layout do Módulo Marketing: apenas o gate (stub central) + container.
// A navegação entre Newsletter/Push fica no menu (Header) — cada página
// responde pelo seu próprio propósito e tem seu próprio header.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { role, isLoading } = useCmsUser();

  const enabled = isMarketingEnabled(role);
  useEffect(() => {
    if (!isLoading && !enabled) router.replace('/dashboard');
  }, [isLoading, enabled, router]);

  if (!isLoading && !enabled) return null;

  return (
    <div className="min-h-screen bg-gray-50/50 dark:bg-gray-950">
      <div className="p-6 lg:p-8">{children}</div>
    </div>
  );
}
