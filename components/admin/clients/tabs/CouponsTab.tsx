'use client'

import { useState } from 'react'
import { Gift, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { CouponsListAdmin } from '@/components/admin/CouponsListAdmin'
import { CouponCreateDrawer } from '@/components/admin/CouponCreateDrawer'
import type { ClientEditorTabProps } from './ProfileTab'

/**
 * Cupons tab — list/create coupons whose owner_client_id matches the
 * client being edited. Reuses CouponsListAdmin and CouponCreateDrawer:
 *
 *   - CouponsListAdmin gets ownerClientId={clientId} → filters fetch via
 *     ?owner_client_id, hides the Owner column, drops the global header
 *     subtitle and the /admin/coupons/owners link.
 *
 *   - CouponCreateDrawer gets lockedOwnerClientId={clientId} → owner
 *     selector is hidden and the value is fixed to this client. The
 *     owners /api/admin/clients fetch is skipped.
 *
 * In ?mode=new the clientId is unknown until save — we show a friendly
 * disabled state mirroring how RouteEditorModal handles its translations
 * tab pre-save.
 */
export function CouponsTab({ clientId }: ClientEditorTabProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

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
        onCreateNew={() => setCreateOpen(true)}
      />

      <CouponCreateDrawer
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => setReloadKey((k) => k + 1)}
        lockedOwnerClientId={clientId}
      />
    </div>
  )
}
