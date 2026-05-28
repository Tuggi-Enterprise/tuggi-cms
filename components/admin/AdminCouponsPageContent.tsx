'use client';

/**
 * Client-side content of the /admin/coupons page. See the analogous
 * AdminClientsPageContent doc for the reason it lives here instead of
 * directly under app/.
 */

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  useSessionContext,
  useSupabaseClient,
} from '@supabase/auth-helpers-react';
import { Container } from '@/components/ui/Container';
import { CouponsListAdmin } from '@/components/admin/CouponsListAdmin';
import { CouponFormDrawer } from '@/components/admin/CouponFormDrawer';
import type { Coupon } from '@/types/coupons';

function AdminCouponsContent() {
  const router = useRouter();
  const { session, isLoading: sessionLoading } = useSessionContext();
  const supabase = useSupabaseClient();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const checkAuth = async () => {
      if (sessionLoading) return;
      if (!session) {
        router.push('/login');
        return;
      }
      try {
        const { data: cmsUser } = await supabase
          .schema('core')
          .from('cms_users')
          .select('role')
          .eq('email', session.user.email)
          .single();

        if (cmsUser?.role !== 'admin') {
          router.push('/unauthorized');
          return;
        }
        setIsAuthorized(true);
      } catch (err) {
        console.error('Auth error:', err);
        router.push('/unauthorized');
      } finally {
        setIsLoading(false);
      }
    };
    checkAuth();
  }, [session, sessionLoading, router, supabase]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue mx-auto" />
      </div>
    );
  }
  if (!isAuthorized) return null;

  const openCreate = () => {
    setEditingCoupon(null);
    setDrawerOpen(true);
  };

  const openEdit = (coupon: Coupon) => {
    setEditingCoupon(coupon);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    // Hold the coupon reference long enough for the slide-out animation
    // not to flicker — clearing it immediately would jump to create copy.
    setTimeout(() => setEditingCoupon(null), 200);
  };

  return (
    <div className="min-h-screen bg-gray-50/50">
      <Container className="py-8">
        <CouponsListAdmin
          onCreateNew={openCreate}
          onEditCoupon={openEdit}
          reloadKey={reloadKey}
        />
      </Container>

      <CouponFormDrawer
        isOpen={drawerOpen}
        coupon={editingCoupon}
        onClose={closeDrawer}
        onSuccess={() => setReloadKey(k => k + 1)}
      />
    </div>
  );
}

export function AdminCouponsPageContent() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue mx-auto" />
        </div>
      }>
      <AdminCouponsContent />
    </Suspense>
  );
}
