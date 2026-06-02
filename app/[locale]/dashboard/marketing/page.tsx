'use client';

import { useEffect } from 'react';
import { useRouter } from '@/navigation';

// Overview do módulo → por ora redireciona para a Newsletter.
export default function MarketingIndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/marketing/newsletter');
  }, [router]);
  return null;
}
