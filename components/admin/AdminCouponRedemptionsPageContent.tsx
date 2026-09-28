'use client';

/**
 * Client-side content of /admin/coupons/redemptions — card #787, spec
 * `docs/design/spec-cms-resgates-de-cupom-2026-09.md`. Shell and summary cards follow
 * AdminCouponOwnersPageContent; filter bar, table, pagination and states follow CouponsListAdmin.
 *
 * The filter lives in the URL (`?coupon=<CODE>&owner=<client_id>`) so a link is shareable and the
 * browser's back button restores it. BR-MONETIZACAO-047: hours and days never add into one total.
 */

import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Gift,
  ListChecks,
  Search,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Container } from '@/components/ui/Container';
import { formatDuration } from '@/lib/format/duration';
import { useCmsUser } from '@/lib/hooks/useCmsUser';
import {
  redemptionGrant,
  type CouponRedemption,
  type RedemptionTotals,
} from '@/lib/coupons/redemptions';

const PAGE_SIZE = 20;
const EMPTY_TOTALS: RedemptionTotals = { redemptions: 0, minutes_granted: 0, days_granted: 0 };

interface OwnerOption {
  owner_client_id: string;
  owner_name: string | null;
}

export interface CouponRedemptionsViewProps {
  rows: CouponRedemption[];
  totals: RedemptionTotals;
  loading: boolean;
  error: string | null;
  /** The RPC is not deployed yet (route answered 503 `not_available`). */
  unavailable: boolean;
  filtered: boolean;
  onFilterByCode: (code: string) => void;
  onClearFilters: () => void;
}

/**
 * Cards + table, without data fetching or routing — mounted as-is by the component test.
 * The days card only exists when the filter holds at least one redemption in days.
 */
export function CouponRedemptionsView({
  rows,
  totals,
  loading,
  error,
  unavailable,
  filtered,
  onFilterByCode,
  onClearFilters,
}: CouponRedemptionsViewProps) {
  const t = useTranslations('Coupons.redemptions');
  const showDays = totals.days_granted > 0;

  const grantText = (row: CouponRedemption) => {
    const grant = redemptionGrant(row);
    if (!grant) return '—';
    return grant.unit === 'minutes'
      ? formatDuration(grant.amount)
      : t('days', { count: grant.amount });
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <div className="rounded-lg border border-gray-200 bg-white p-4" data-testid="card-redemptions">
          <p className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1">
            <Gift size={12} /> {t('cards.redemptions')}
          </p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{totals.redemptions}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4" data-testid="card-hours">
          <p className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1">
            <Clock size={12} /> {t('cards.hoursGranted')}
          </p>
          <p className="mt-1 text-2xl font-bold text-gray-900">
            {formatDuration(totals.minutes_granted)}
          </p>
        </div>
        {showDays && (
          <div className="rounded-lg border border-gray-200 bg-white p-4" data-testid="card-days">
            <p className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1">
              <Calendar size={12} /> {t('cards.daysGranted')}
            </p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {t('days', { count: totals.days_granted })}
            </p>
          </div>
        )}
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
              <th className="px-4 py-3 text-left">{t('headers.code')}</th>
              <th className="px-4 py-3 text-left">{t('headers.owner')}</th>
              <th className="px-4 py-3 text-left">{t('headers.nickname')}</th>
              <th className="px-4 py-3 text-left">{t('headers.redeemedAt')}</th>
              <th className="px-4 py-3 text-left">{t('headers.granted')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-gray-400">
                  {t('loading')}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-gray-400">
                  {unavailable ? t('unavailable') : filtered ? t('emptyFiltered') : t('empty')}
                  {filtered && !unavailable && (
                    <button
                      type="button"
                      onClick={onClearFilters}
                      className="ml-2 font-semibold text-tuggi-blue hover:underline">
                      {t('clearFilters')}
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              rows.map(r => (
                <tr key={r.redemption_id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onFilterByCode(r.coupon_code)}
                      title={t('filterByCode')}
                      className="font-mono font-bold tracking-wider text-gray-900 hover:text-tuggi-blue hover:underline">
                      {r.coupon_code}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {r.owner_name ?? <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-700 max-w-[260px]">
                    <p className="truncate" title={r.nickname ?? undefined}>
                      {r.nickname ?? '—'}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {new Date(r.redeemed_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-900" data-testid="granted">
                    {grantText(r)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AdminCouponRedemptionsContent() {
  const t = useTranslations('Coupons.redemptions');
  const tOwners = useTranslations('Coupons.owners');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Same gate as the route: admin only. `/api/auth/check` already proved the session server-side.
  const { isAdmin, isLoading: authChecking } = useCmsUser();
  const isAuthorized = !authChecking && isAdmin;

  const coupon = (searchParams.get('coupon') ?? '').toUpperCase();
  const owner = searchParams.get('owner') ?? '';
  const filtered = Boolean(coupon || owner);

  const [codeInput, setCodeInput] = useState(coupon);
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [rows, setRows] = useState<CouponRedemption[]>([]);
  const [totals, setTotals] = useState<RedemptionTotals>(EMPTY_TOTALS);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!authChecking && !isAdmin) router.push('/unauthorized');
  }, [authChecking, isAdmin, router]);

  /** `push` keeps the previous filter in history; `replace` for typing, one entry per word. */
  const setFilter = (next: { coupon?: string; owner?: string }, mode: 'push' | 'replace' = 'push') => {
    const params = new URLSearchParams();
    const c = next.coupon ?? coupon;
    const o = next.owner ?? owner;
    if (c) params.set('coupon', c);
    if (o) params.set('owner', o);
    const qs = params.toString();
    router[mode](qs ? `${pathname}?${qs}` : pathname);
  };

  // Back/forward changes the URL: the input follows it.
  useEffect(() => setCodeInput(coupon), [coupon]);

  // Debounce the typed code into the URL (300 ms, as CouponsListAdmin does).
  useEffect(() => {
    if (codeInput === coupon) return;
    const timer = setTimeout(() => setFilter({ coupon: codeInput.trim() }, 'replace'), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeInput]);

  useEffect(() => {
    if (!isAuthorized) return;
    fetch('/api/admin/coupons/owners')
      .then(res => (res.ok ? res.json() : { owners: [] }))
      .then(data => setOwners(data.owners || []))
      .catch(() => setOwners([]));
  }, [isAuthorized]);

  const fetchPage = async (target: number) => {
    try {
      setLoading(true);
      setError(null);
      setUnavailable(false);
      const params = new URLSearchParams({ page: String(target), limit: String(PAGE_SIZE) });
      if (coupon) params.set('coupon', coupon);
      if (owner) params.set('owner', owner);
      const res = await fetch(`/api/admin/coupons/redemptions?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setRows([]);
        setTotals(EMPTY_TOTALS);
        if (data.code === 'not_available') setUnavailable(true);
        else setError(data.error || t('errors.loadFailed'));
        return;
      }
      setRows(data.redemptions || []);
      setTotals(data.totals || EMPTY_TOTALS);
      setPagination(data.pagination);
      setPage(target);
    } catch (err) {
      console.error(err);
      setError(t('errors.loadNetwork'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthorized) return;
    fetchPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, coupon, owner]);

  if (authChecking) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue mx-auto" />
      </div>
    );
  }
  if (!isAuthorized) return null;

  const clearFilters = () => {
    setCodeInput('');
    router.push(pathname);
  };

  return (
    <div className="cms-width min-h-screen bg-gray-50/50">
      <Container className="py-8">
        <div className="mb-6">
          <Link
            href="/admin/coupons"
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
            <ArrowLeft size={14} /> {tOwners('backToCoupons')}
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ListChecks size={22} className="text-tuggi-orange" />
            {t('title')}
          </h1>
          <p className="text-sm text-gray-500">{t('subtitle')}</p>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              placeholder={t('searchPlaceholder')}
              value={codeInput}
              onChange={e => setCodeInput(e.target.value.toUpperCase())}
              className="w-full rounded-md border border-gray-200 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40 uppercase tracking-wider"
            />
          </div>
          <select
            value={owner}
            onChange={e => setFilter({ owner: e.target.value })}
            className="rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40">
            <option value="">{t('ownerAll')}</option>
            {owners.map(o => (
              <option key={o.owner_client_id} value={o.owner_client_id}>
                {o.owner_name ?? o.owner_client_id}
              </option>
            ))}
          </select>
          {filtered && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-sm font-semibold text-tuggi-blue hover:underline">
              {t('clearFilters')}
            </button>
          )}
        </div>

        <CouponRedemptionsView
          rows={rows}
          totals={totals}
          loading={loading}
          error={error}
          unavailable={unavailable}
          filtered={filtered}
          onFilterByCode={code => setFilter({ coupon: code })}
          onClearFilters={clearFilters}
        />

        {pagination.pages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
            <span>
              {t('pagination', { current: pagination.page, total: pagination.pages, count: pagination.total })}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1 || loading}
                onClick={() => fetchPage(page - 1)}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 disabled:opacity-40">
                <ChevronLeft size={14} /> {t('prev')}
              </button>
              <button
                disabled={page >= pagination.pages || loading}
                onClick={() => fetchPage(page + 1)}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 disabled:opacity-40">
                {t('next')} <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </Container>
    </div>
  );
}

export function AdminCouponRedemptionsPageContent() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue mx-auto" />
        </div>
      }>
      <AdminCouponRedemptionsContent />
    </Suspense>
  );
}
