'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Loader2, X } from 'lucide-react';
import type {
  CouponCreateInput,
  CouponEligibility,
  CouponOwnerSummary,
} from '@/types/coupons';

interface CouponCreateDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
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

export function CouponCreateDrawer({
  isOpen,
  onClose,
  onSuccess,
}: CouponCreateDrawerProps) {
  const [form, setForm] = useState<CouponCreateInput>(EMPTY_FORM);
  const [owners, setOwners] = useState<CouponOwnerSummary[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Reset when re-opened
  useEffect(() => {
    if (isOpen) {
      setForm(EMPTY_FORM);
      setError(null);
      setSuccess(null);
    }
  }, [isOpen]);

  // Owner list — fetched lazily on first open
  useEffect(() => {
    if (!isOpen || owners.length > 0) return;
    (async () => {
      try {
        const res = await fetch('/api/admin/clients?limit=200');
        const data = await res.json();
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
        console.warn('Could not load owners list', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const set = <K extends keyof CouponCreateInput>(
    key: K,
    value: CouponCreateInput[K]
  ) => setForm(prev => ({ ...prev, [key]: value }));

  const submit = async () => {
    setError(null);
    setSuccess(null);

    if (form.code.trim().length < 3) {
      setError('Code must be at least 3 characters.');
      return;
    }
    if (form.duration_days < 1) {
      setError('Duration must be at least 1 day.');
      return;
    }

    try {
      setSubmitting(true);
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
      // Hold the success view briefly so the user sees the confirmation,
      // then close the drawer.
      setTimeout(onClose, 900);
    } catch (err) {
      console.error(err);
      setError('Network error creating coupon');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => !submitting && onClose()}
      />
      <div className="relative ml-auto h-full w-full max-w-xl bg-white shadow-2xl overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
          <h2 className="text-lg font-bold text-gray-900">Create coupon</h2>
          <button
            onClick={() => !submitting && onClose()}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {error && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle size={16} /> {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              <CheckCircle size={16} /> {success}
            </div>
          )}

          {/* Code */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Code <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.code}
              onChange={e => set('code', e.target.value.toUpperCase())}
              placeholder="WEBSUMMIT26"
              maxLength={32}
              className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40"
            />
            <p className="mt-1 text-xs text-gray-500">
              Always stored UPPERCASE. Convention: keep slugs lowercase, codes uppercase.
            </p>
          </div>

          {/* Owner */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Owner (attribution shown in the app)
            </label>
            <select
              value={form.owner_client_id ?? ''}
              onChange={e =>
                set('owner_client_id', e.target.value === '' ? null : e.target.value)
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40">
              <option value="">No owner (generic)</option>
              {owners.map(o => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.client_type ? ` · ${o.client_type}` : ''}
                </option>
              ))}
            </select>
          </div>

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
              className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40"
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
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40">
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
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40"
              />
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
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40"
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
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40"
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
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40"
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
              className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40"
            />
          </div>
        </div>

        <div className="sticky bottom-0 border-t border-gray-200 bg-white px-6 py-4 flex justify-end gap-2">
          <button
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-tuggi-blue px-4 py-2 text-sm font-semibold text-white hover:bg-tuggi-blue/90 disabled:opacity-60">
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Create coupon
          </button>
        </div>
      </div>
    </div>
  );
}
