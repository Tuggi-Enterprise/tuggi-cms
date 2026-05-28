'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  Gift,
  Plus,
  Search,
  Power,
  PowerOff,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import type { Coupon } from '@/types/coupons';

interface CouponsListAdminProps {
  onCreateNew: () => void;
  reloadKey?: number;
  /**
   * When set, scopes the list to a single owner — used by the per-client
   * Coupons tab in the Clients editor. The Owner column collapses (every
   * row would repeat the same name), the page heading shifts to "Coupons"
   * without the global subtitle, and the API call passes ?owner_client_id.
   */
  ownerClientId?: string;
  /**
   * Called when the admin clicks a row to edit it. The caller is
   * responsible for opening the edit drawer with the selected coupon.
   * When omitted, the row is not clickable (legacy mode).
   */
  onEditCoupon?: (coupon: Coupon) => void;
}

const PAGE_SIZE = 20;

export function CouponsListAdmin({
  onCreateNew,
  reloadKey,
  ownerClientId,
  onEditCoupon,
}: CouponsListAdminProps) {
  const isScopedToOwner = Boolean(ownerClientId);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  // searchInput tracks what the user has typed; `search` is the
  // debounced value actually sent to the API.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    pages: 1,
  });
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchCoupons = async (searchPage = 1) => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        page: String(searchPage),
        limit: String(PAGE_SIZE),
      });
      if (search) params.append('search', search);
      if (status !== 'all') params.append('status', status);
      if (ownerClientId) params.append('owner_client_id', ownerClientId);

      const res = await fetch(`/api/admin/coupons?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to fetch coupons');
        return;
      }
      setCoupons(data.coupons || []);
      setPagination(data.pagination);
      setPage(searchPage);
    } catch (err) {
      console.error(err);
      setError('Could not load coupons');
    } finally {
      setLoading(false);
    }
  };

  // Debounce searchInput → search (300ms). Keeps the API call cadence
  // reasonable when the admin types fast and avoids out-of-order
  // responses from in-flight requests racing the latest keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    fetchCoupons(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, reloadKey, ownerClientId]);

  const toggleActive = async (coupon: Coupon) => {
    try {
      setTogglingId(coupon.id);
      const res = await fetch(`/api/admin/coupons/${coupon.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !coupon.is_active }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to update coupon');
        return;
      }
      setCoupons(prev =>
        prev.map(c => (c.id === coupon.id ? { ...c, is_active: data.coupon.is_active } : c))
      );
    } catch (err) {
      console.error(err);
      setError('Could not update coupon');
    } finally {
      setTogglingId(null);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString();
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Gift size={22} className="text-tuggi-orange" />
            Coupons
          </h1>
          {!isScopedToOwner && (
            <p className="text-sm text-gray-500">
              Free Premium days redeemable via the in-app modal or marketing landing pages.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isScopedToOwner && (
            <Link
              href="/admin/coupons/owners"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition">
              <TrendingUp size={14} />
              Owner performance
            </Link>
          )}
          <button
            onClick={onCreateNew}
            className="inline-flex items-center gap-1.5 rounded-lg bg-tuggi-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-tuggi-blue/90 transition">
            <Plus size={16} />
            New coupon
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search by code"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value.toUpperCase())}
            className="w-full rounded-md border border-gray-200 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40 uppercase tracking-wider"
          />
        </div>
        <select
          value={status}
          onChange={e => setStatus(e.target.value as any)}
          className="rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Code</th>
              {!isScopedToOwner && <th className="px-4 py-3 text-left">Owner</th>}
              <th className="px-4 py-3 text-left">Duration</th>
              <th className="px-4 py-3 text-left">Eligibility</th>
              <th className="px-4 py-3 text-left">Redemptions</th>
              <th className="px-4 py-3 text-left">Validity</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Created</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={isScopedToOwner ? 8 : 9} className="px-4 py-10 text-center text-gray-400">
                  Loading…
                </td>
              </tr>
            ) : coupons.length === 0 ? (
              <tr>
                <td colSpan={isScopedToOwner ? 8 : 9} className="px-4 py-10 text-center text-gray-400">
                  No coupons yet — create your first one.
                </td>
              </tr>
            ) : (
              coupons.map(c => (
                <tr
                  key={c.id}
                  className={`hover:bg-gray-50/50 ${onEditCoupon ? 'cursor-pointer' : ''}`}
                  onClick={() => onEditCoupon?.(c)}
                  title={onEditCoupon ? 'Clique para editar' : undefined}
                >
                  <td className="px-4 py-3 font-mono font-bold tracking-wider text-gray-900">
                    {c.code}
                  </td>
                  {!isScopedToOwner && (
                    <td className="px-4 py-3 text-gray-700" onClick={(e) => e.stopPropagation()}>
                      {c.owner ? (
                        <Link
                          href={`/admin/clients?clientId=${c.owner_client_id}&tab=coupons`}
                          className="flex items-center gap-2 group"
                          title="Abrir cliente no editor"
                        >
                          {c.owner.avatar_url ? (
                            <img
                              src={c.owner.avatar_url}
                              alt=""
                              className="h-6 w-6 rounded-full object-cover"
                            />
                          ) : (
                            <span className="h-6 w-6 rounded-full bg-tuggi-orange/10 text-tuggi-orange text-[10px] font-bold flex items-center justify-center">
                              {c.owner.name?.charAt(0) ?? '?'}
                            </span>
                          )}
                          <span className="group-hover:text-tuggi-blue group-hover:underline transition-colors">{c.owner.name}</span>
                          {c.owner.client_type && (
                            <span className="text-xs text-gray-400">
                              · {c.owner.client_type}
                            </span>
                          )}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3">{c.duration_days} days</td>
                  <td className="px-4 py-3 text-xs">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">
                      {c.eligibility === 'new_subscribers_only'
                        ? 'New subscribers'
                        : 'Any user'}
                    </span>
                    {c.stack_with_active && (
                      <span className="ml-1 rounded-full bg-tuggi-blue/10 px-2 py-0.5 text-tuggi-blue">
                        Stack
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {c.redeemed_count}
                    <span className="text-gray-400">
                      {' '}
                      / {c.max_redemptions ?? '∞'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {formatDate(c.valid_from)} → {formatDate(c.valid_until)}
                  </td>
                  <td className="px-4 py-3">
                    {c.is_active ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                        <CheckCircle size={12} /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {formatDate(c.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {/* stopPropagation: prevents the row's edit-on-click from
                        firing when the admin just wants to toggle status. */}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleActive(c); }}
                      disabled={togglingId === c.id}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-40"
                      title={c.is_active ? 'Deactivate' : 'Activate'}>
                      {c.is_active ? (
                        <>
                          <PowerOff size={14} /> Deactivate
                        </>
                      ) : (
                        <>
                          <Power size={14} /> Activate
                        </>
                      )}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            Page {pagination.page} of {pagination.pages} · {pagination.total}{' '}
            coupons
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1 || loading}
              onClick={() => fetchCoupons(page - 1)}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 disabled:opacity-40">
              <ChevronLeft size={14} /> Prev
            </button>
            <button
              disabled={page >= pagination.pages || loading}
              onClick={() => fetchCoupons(page + 1)}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 disabled:opacity-40">
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
