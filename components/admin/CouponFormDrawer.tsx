'use client';

/**
 * CouponFormDrawer — single drawer for both creating and editing coupons.
 *
 * Edit mode is enabled by passing `coupon` (and an `id` is then known to
 * route the request to PATCH /api/admin/coupons/[id]). Create mode is the
 * default — POSTs to /api/admin/coupons.
 *
 * What's locked in edit mode (matches the backend allow-list):
 *   - code             already printed/distributed; renaming orphans campaigns
 *   - owner_client_id  re-attribution would misroute past + future redemptions
 *
 * A banner appears when editing a coupon that already has redemptions, so
 * the admin knows the changes affect users with active Premium gifts.
 */

import { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, Loader2, Lock, X } from 'lucide-react';
import type {
  Coupon,
  CouponCreateInput,
  CouponEligibility,
  CouponOwnerSummary,
} from '@/types/coupons';

interface CouponFormDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /**
   * When provided, the drawer opens in edit mode pre-filled with the
   * coupon's current values. Code and owner_client_id become readonly.
   */
  coupon?: Coupon | null;
  /**
   * When set, the owner is fixed to this client id and the selector is
   * hidden. Used by the per-client Coupons tab in the Clients editor in
   * create mode.
   */
  lockedOwnerClientId?: string;
}

const EMPTY_FORM: CouponCreateInput = {
  code: '',
  owner_client_id: null,
  duration_days: 7,
  eligibility: 'any',
  stack_with_active: true,
  max_redemptions: null,
  max_redemptions_per_user: 1,
  valid_from: null,
  valid_until: null,
  notes: null,
};

/**
 * `valid_from` / `valid_until` come back from the API as ISO strings; the
 * <input type="datetime-local"> expects "YYYY-MM-DDTHH:mm". Strip the
 * trailing seconds + timezone so the value round-trips cleanly.
 */
function toDateTimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  // Slice "2026-05-28T12:30:45.123Z" → "2026-05-28T12:30"
  return iso.slice(0, 16);
}

function buildFormFromCoupon(coupon: Coupon): CouponCreateInput {
  return {
    code: coupon.code,
    owner_client_id: coupon.owner_client_id,
    duration_days: coupon.duration_days,
    eligibility: coupon.eligibility,
    stack_with_active: coupon.stack_with_active,
    max_redemptions: coupon.max_redemptions,
    max_redemptions_per_user: coupon.max_redemptions_per_user,
    valid_from: coupon.valid_from ? toDateTimeLocalValue(coupon.valid_from) : null,
    valid_until: coupon.valid_until ? toDateTimeLocalValue(coupon.valid_until) : null,
    notes: coupon.notes,
  };
}

export function CouponFormDrawer({
  isOpen,
  onClose,
  onSuccess,
  coupon,
  lockedOwnerClientId,
}: CouponFormDrawerProps) {
  const isEditing = Boolean(coupon);
  const isOwnerLocked = Boolean(lockedOwnerClientId);
  const [form, setForm] = useState<CouponCreateInput>(EMPTY_FORM);
  const [owners, setOwners] = useState<CouponOwnerSummary[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Reset/populate when re-opened
  useEffect(() => {
    if (!isOpen) return;
    if (coupon) {
      setForm(buildFormFromCoupon(coupon));
    } else {
      setForm({ ...EMPTY_FORM, owner_client_id: lockedOwnerClientId ?? null });
    }
    setError(null);
    setSuccess(null);
  }, [isOpen, coupon, lockedOwnerClientId]);

  // Owner list — refetched every time the drawer opens (in create mode
  // with the selector visible). We used to early-return when the cache
  // had any entries, but that made newly-created clients invisible until
  // a full page reload. The endpoint is cheap and capped at 200 rows.
  useEffect(() => {
    if (!isOpen || isOwnerLocked || isEditing) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/admin/clients?limit=200', { signal: controller.signal });
        if (controller.signal.aborted) return;
        const data = await res.json();
        if (controller.signal.aborted) return;
        if (res.ok && Array.isArray(data.clients)) {
          setOwners(
            data.clients.map((c: any) => ({
              id: c.id,
              name: c.name,
              client_type: c.client_type,
              avatar_url: c.avatar_url,
            }))
          );
        }
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') {
          console.warn('Could not load owners list', err);
        }
      }
    })();
    return () => controller.abort();
  }, [isOpen, isOwnerLocked, isEditing]);

  const set = <K extends keyof CouponCreateInput>(
    key: K,
    value: CouponCreateInput[K]
  ) => setForm(prev => ({ ...prev, [key]: value }));

  const submit = async () => {
    setError(null);
    setSuccess(null);

    if (!isEditing && form.code.trim().length < 3) {
      setError('Code must be at least 3 characters.');
      return;
    }
    if (form.duration_days < 1) {
      setError('Duration must be at least 1 day.');
      return;
    }

    try {
      setSubmitting(true);
      if (isEditing && coupon) {
        // PATCH: only send the fields the backend allow-list accepts.
        const patch = {
          duration_days: form.duration_days,
          eligibility: form.eligibility,
          stack_with_active: form.stack_with_active,
          max_redemptions: form.max_redemptions ?? null,
          max_redemptions_per_user: form.max_redemptions_per_user,
          valid_from: form.valid_from || null,
          valid_until: form.valid_until || null,
          notes: form.notes,
        };
        const res = await fetch(`/api/admin/coupons/${coupon.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Failed to update coupon');
          return;
        }
        setSuccess(`Coupon ${data.coupon.code} updated.`);
        onSuccess();
        setTimeout(onClose, 900);
      } else {
        const res = await fetch('/api/admin/coupons', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Failed to create coupon');
          return;
        }
        setSuccess(`Coupon ${data.coupon.code} created.`);
        onSuccess();
        setTimeout(onClose, 900);
      }
    } catch (err) {
      console.error(err);
      setError(isEditing ? 'Network error updating coupon' : 'Network error creating coupon');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const redeemed = coupon?.redeemed_count ?? 0;
  const showRedemptionWarning = isEditing && redeemed > 0;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => !submitting && onClose()}
      />
      <div className="relative ml-auto h-full w-full max-w-xl bg-white shadow-2xl overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
          <h2 className="text-base font-bold text-gray-900 leading-tight">
            {isEditing ? `Edit coupon · ${coupon?.code}` : 'Create coupon'}
          </h2>
          <button
            onClick={() => !submitting && onClose()}
            className="rounded-xl p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle size={16} /> {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              <CheckCircle size={16} /> {success}
            </div>
          )}
          {showRedemptionWarning && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <p>
                Este cupom já tem <strong>{redeemed}</strong> resgate{redeemed === 1 ? '' : 's'}.
                Alterações em duração, elegibilidade ou limites afetam apenas resgates futuros — os já consumidos não mudam.
              </p>
            </div>
          )}

          {/* Code — readonly in edit mode */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Code {!isEditing && <span className="text-red-500">*</span>}
              {isEditing && <Lock size={12} className="inline ml-1 text-gray-400" />}
            </label>
            <input
              type="text"
              value={form.code}
              onChange={e => set('code', e.target.value.toUpperCase())}
              placeholder="WEBSUMMIT26"
              maxLength={32}
              readOnly={isEditing}
              disabled={isEditing}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 font-mono uppercase tracking-wider text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-tuggi-blue/30 disabled:opacity-60"
            />
            <p className="mt-1 text-xs text-gray-500">
              {isEditing
                ? 'Imutável após criação — material impresso/distribuído depende dele.'
                : 'Always stored UPPERCASE. Convention: keep slugs lowercase, codes uppercase.'}
            </p>
          </div>

          {/* Owner — readonly in edit mode; hidden when locked in create mode */}
          {isEditing ? (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Owner <Lock size={12} className="inline ml-1 text-gray-400" />
              </label>
              <input
                type="text"
                value={coupon?.owner?.name ?? (coupon?.owner_client_id ? 'Atribuído' : 'Sem owner (genérico)')}
                readOnly
                disabled
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-600"
              />
              <p className="mt-1 text-xs text-gray-500">
                Imutável após criação — alterar atribuição misrouteria resgates passados e futuros.
              </p>
            </div>
          ) : !isOwnerLocked && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Owner (attribution shown in the app)
              </label>
              <select
                value={form.owner_client_id ?? ''}
                onChange={e =>
                  set('owner_client_id', e.target.value === '' ? null : e.target.value)
                }
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-tuggi-blue/30">
                <option value="">No owner (generic)</option>
                {owners.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                    {o.client_type ? ` · ${o.client_type}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Duration */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Duration (days) <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min={1}
              value={form.duration_days}
              onChange={e => set('duration_days', parseInt(e.target.value) || 1)}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-tuggi-blue/30"
            />
          </div>

          {/* Eligibility + Stack */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Eligibility
              </label>
              <select
                value={form.eligibility}
                onChange={e =>
                  set('eligibility', e.target.value as CouponEligibility)
                }
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-tuggi-blue/30">
                <option value="any">Any user</option>
                <option value="new_subscribers_only">New subscribers only</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Stack with active Premium?
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.stack_with_active}
                  onChange={e => set('stack_with_active', e.target.checked)}
                  className="rounded border-gray-300 text-tuggi-blue focus:ring-tuggi-blue"
                />
                Sums days on top of existing end-date (recommended).
              </label>
            </div>
          </div>

          {/* Limits */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Max total redemptions
              </label>
              <input
                type="number"
                min={1}
                placeholder="Leave blank for unlimited"
                value={form.max_redemptions ?? ''}
                onChange={e =>
                  set(
                    'max_redemptions',
                    e.target.value === '' ? null : parseInt(e.target.value) || null
                  )
                }
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-tuggi-blue/30"
              />
              {isEditing && (
                <p className="mt-1 text-xs text-gray-500">
                  Já resgatados: <strong>{redeemed}</strong>. Defina um valor maior que isso para manter o cupom ativo.
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Max per user
              </label>
              <input
                type="number"
                min={1}
                value={form.max_redemptions_per_user}
                onChange={e =>
                  set('max_redemptions_per_user', parseInt(e.target.value) || 1)
                }
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-tuggi-blue/30"
              />
            </div>
          </div>

          {/* Validity window */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Valid from
              </label>
              <input
                type="datetime-local"
                value={form.valid_from ?? ''}
                onChange={e => set('valid_from', e.target.value || null)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-tuggi-blue/30"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Valid until
              </label>
              <input
                type="datetime-local"
                value={form.valid_until ?? ''}
                onChange={e => set('valid_until', e.target.value || null)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-tuggi-blue/30"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Notes (internal)
            </label>
            <textarea
              rows={2}
              value={form.notes ?? ''}
              onChange={e => set('notes', e.target.value || null)}
              placeholder="WebSummit 2026 booth campaign"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-tuggi-blue/30"
            />
          </div>
        </div>

        <div className="sticky bottom-0 border-t border-gray-200 bg-white px-6 py-4 flex justify-end gap-2">
          <button
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-xl bg-tuggi-blue px-4 py-2 text-sm font-semibold text-white hover:bg-tuggi-blue/90 disabled:opacity-60 shadow-md shadow-tuggi-blue/10">
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {isEditing ? 'Save changes' : 'Create coupon'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Backwards-compat alias — older imports keep working without churn while
 * we migrate the two callers (the standalone /admin/coupons page and the
 * Clients editor's CouponsTab) to the new name.
 */
export { CouponFormDrawer as CouponCreateDrawer };
