'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  useSessionContext,
  useSupabaseClient,
} from '@supabase/auth-helpers-react';
import {
  AlertCircle,
  ArrowLeft,
  Award,
  Calendar,
  Gift,
  TrendingUp,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';

interface OwnerPerformance {
  owner_client_id: string;
  owner_name: string | null;
  owner_avatar_url: string | null;
  owner_client_type: string | null;
  coupon_count: number;
  active_coupon_count: number;
  redeemed_total: number;
  days_granted_total: number;
  unique_users: number;
  converted_to_paid: number;
  last_redeemed_at: string | null;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

function pct(numerator: number, denominator: number) {
  if (denominator === 0) return '—';
  return `${((numerator / denominator) * 100).toFixed(0)}%`;
}

function AdminCouponOwnersContent() {
  const router = useRouter();
  const { session, isLoading: sessionLoading } = useSessionContext();
  const supabase = useSupabaseClient();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [owners, setOwners] = useState<OwnerPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        setAuthChecking(false);
      }
    };
    checkAuth();
  }, [session, sessionLoading, router, supabase]);

  useEffect(() => {
    if (!isAuthorized) return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch('/api/admin/coupons/owners');
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Failed to load performance');
          return;
        }
        setOwners(data.owners || []);
      } catch (err) {
        console.error(err);
        setError('Could not load owner performance');
      } finally {
        setLoading(false);
      }
    })();
  }, [isAuthorized]);

  if (authChecking) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue mx-auto" />
      </div>
    );
  }
  if (!isAuthorized) return null;

  const totalRedemptions = owners.reduce((s, o) => s + o.redeemed_total, 0);
  const totalConverted = owners.reduce((s, o) => s + o.converted_to_paid, 0);
  const totalDays = owners.reduce((s, o) => s + Number(o.days_granted_total), 0);

  return (
    <div className="min-h-screen bg-gray-50/50">
      <Container className="py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              href="/admin/coupons"
              className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
              <ArrowLeft size={14} /> Back to coupons
            </Link>
            <h1 className="mt-1 text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Award size={22} className="text-tuggi-orange" />
              Owner performance
            </h1>
            <p className="text-sm text-gray-500">
              Per-owner aggregates across all of their coupons.
            </p>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1">
              <Gift size={12} /> Total redemptions
            </p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {totalRedemptions}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1">
              <TrendingUp size={12} /> Converted to paid
            </p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {totalConverted}{' '}
              <span className="text-sm font-medium text-gray-400">
                ({pct(totalConverted, totalRedemptions)})
              </span>
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1">
              <Calendar size={12} /> Premium days granted
            </p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{totalDays}</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Owner</th>
                <th className="px-4 py-3 text-left">Coupons</th>
                <th className="px-4 py-3 text-left">Redemptions</th>
                <th className="px-4 py-3 text-left">Unique users</th>
                <th className="px-4 py-3 text-left">Converted</th>
                <th className="px-4 py-3 text-left">Days granted</th>
                <th className="px-4 py-3 text-left">Last redeemed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                    Loading…
                  </td>
                </tr>
              ) : owners.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                    No owner activity yet.
                  </td>
                </tr>
              ) : (
                owners.map(o => (
                  <tr key={o.owner_client_id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {o.owner_avatar_url ? (
                          <img
                            src={o.owner_avatar_url}
                            alt=""
                            className="h-7 w-7 rounded-full object-cover"
                          />
                        ) : (
                          <span className="h-7 w-7 rounded-full bg-tuggi-orange/10 text-tuggi-orange text-xs font-bold flex items-center justify-center">
                            {(o.owner_name ?? '?').charAt(0)}
                          </span>
                        )}
                        <div>
                          <p className="font-semibold text-gray-900">
                            {o.owner_name ?? 'Unknown'}
                          </p>
                          {o.owner_client_type && (
                            <p className="text-xs text-gray-400">
                              {o.owner_client_type}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {o.coupon_count}
                      <span className="text-gray-400">
                        {' '}
                        ({o.active_coupon_count} active)
                      </span>
                    </td>
                    <td className="px-4 py-3 font-bold text-gray-900">
                      {o.redeemed_total}
                    </td>
                    <td className="px-4 py-3 text-gray-700 inline-flex items-center gap-1">
                      <Users size={12} className="text-gray-400" />
                      {o.unique_users}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {o.converted_to_paid}{' '}
                      <span className="text-xs text-gray-400">
                        ({pct(o.converted_to_paid, o.unique_users)})
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {o.days_granted_total}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {formatDate(o.last_redeemed_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Container>
    </div>
  );
}

export default function AdminCouponOwnersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue mx-auto" />
        </div>
      }>
      <AdminCouponOwnersContent />
    </Suspense>
  );
}
