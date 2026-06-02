'use client';

// Push notifications migrou para o Módulo Marketing.
// Mantemos esta rota como redirect para não quebrar links/bookmarks.
import { useEffect } from 'react';
import { useRouter } from '@/navigation';

export default function NotificationsRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/marketing/notifications');
  }, [router]);
  return null;
}
