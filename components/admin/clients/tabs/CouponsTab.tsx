'use client'

import { useState } from 'react'
import { Gift, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { CouponsListAdmin } from '@/components/admin/CouponsListAdmin'
import { CouponFormDrawer } from '@/components/admin/CouponFormDrawer'
import type { Coupon } from '@/types/coupons'
import type { ClientEditorTabProps } from './ProfileTab'

/**
 * Cupons tab — list / create / edit coupons whose owner_client_id matches
 * the client being edited. Reuses CouponsListAdmin and CouponFormDrawer:
 *
 *   - CouponsListAdmin gets ownerClientId={clientId} → filters fetch via
 *     ?owner_client_id, hides the Owner column, drops the global header
 *     subtitle and the /admin/coupons/owners link.
 *
 *   - CouponFormDrawer gets lockedOwnerClientId={clientId} in create mode
 *     (owner selector hidden, value fixed) and a coupon object in edit
 *     mode (code + owner readonly).
 *
 * In ?mode=new the clientId is unknown until save — we show a friendly
 * disabled state mirroring how RouteEditorModal handles its translations
 * tab pre-save.
 */
export function CouponsTab({ clientId }: ClientEditorTabProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const openCreate = () => {
    setEditingCoupon(null)
    setDrawerOpen(true)
  }

  const openEdit = (coupon: Coupon) => {
    setEditingCoupon(coupon)
    setDrawerOpen(true)
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    setTimeout(() => setEditingCoupon(null), 200)
  }

  if (!clientId) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center">
        <Gift className="w-10 h-10 text-gray-300 mx-auto mb-4" />
        <p className="text-sm text-gray-400 font-semibold uppercase tracking-widest mb-2">
          Cliente ainda não salvo
        </p>
        <h3 className="text-2xl font-bold text-gray-700 mb-3">Cupons</h3>
        <p className="text-sm text-gray-500">Salve o cliente para começar a vincular cupons.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 rounded-xl border border-tuggi-blue/20 bg-tuggi-blue/5 px-4 py-3 text-xs text-tuggi-blue">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <p>
          Apenas cupons atribuídos a este cliente. Cupons genéricos (sem owner) aparecem só na
          {' '}<Link href="/admin/coupons" className="font-bold underline">busca global</Link>.
        </p>
      </div>

      <CouponsListAdmin
        key={reloadKey}
        ownerClientId={clientId}
        onCreateNew={openCreate}
        onEditCoupon={openEdit}
      />

      <CouponFormDrawer
        isOpen={drawerOpen}
        coupon={editingCoupon}
        onClose={closeDrawer}
        onSuccess={() => setReloadKey((k) => k + 1)}
        lockedOwnerClientId={editingCoupon ? undefined : clientId}
      />
    </div>
  )
}
