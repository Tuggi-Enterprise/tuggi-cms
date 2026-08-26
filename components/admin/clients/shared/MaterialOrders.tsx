'use client'

import { useCallback, useEffect, useState } from 'react'
import { Package, Plus, Loader2, AlertTriangle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { MATERIAL_KINDS, type MaterialKind } from '@/lib/partner-form/fields'
import type { MaterialOrder } from '@/lib/services/material-order-service'
import { MaterialMoveButtons } from '@/components/admin/materials/MaterialMoveButtons'
import type { MaterialMoveStatus } from '@/lib/materials/order-queue'
import { SectionHeader } from '@/components/admin/clients/shared/SectionHeader'

/**
 * The promotional material this partner asked for, and what the team still owes them.
 *
 * IT SITS NEXT TO THE QR CODE, and that is the whole argument for its position: the material is
 * the physical thing that carries that QR into the establishment. Reading "this partner's QR
 * URL" and "30 stickers, 12 table displays, not yet shipped" in two different screens is how
 * somebody prints the QR and forgets the piece it goes on.
 *
 * ONE ORDER IS NOT THE STATE OF THE PARTNER — it is one act. The first one comes from the
 * proposal, at promotion; the rest are repositions the team registers. That is why this is a
 * list and not three counters, and why an order has no way back to `requested`: a partner who
 * needs more gets another order.
 *
 * THE ESTEIRA IS THE SAME ONE `/admin/materials` DRAWS. The moves offered here come from
 * `MaterialMoveButtons`, which reads `MATERIAL_TRANSITIONS` — this panel deciding for itself
 * what may follow what is how the record and the board would come to disagree about the same
 * row.
 *
 * QUANTITY IS TYPED, NOT PICKED. A stepper for a number that runs to four digits is thirty
 * clicks for "120 mesas"; the input is `inputMode="numeric"` and strips non-digits, the same
 * control the public form uses for the same question.
 */

interface MaterialOrdersProps {
  clientId: string
}

type Draft = Partial<Record<MaterialKind, string>>

export function MaterialOrders({ clientId }: MaterialOrdersProps) {
  const t = useTranslations('Clients.profile.material')
  const [orders, setOrders] = useState<MaterialOrder[] | null>(null)
  const [draft, setDraft] = useState<Draft>({})
  const [notes, setNotes] = useState('')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/clients/${clientId}/material-orders`)
    if (!response.ok) {
      setOrders([])
      return
    }
    const payload = (await response.json()) as { orders: MaterialOrder[] }
    setOrders(payload.orders ?? [])
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  const draftTotal = MATERIAL_KINDS.reduce(
    (sum, kind) => sum + (Number.parseInt(draft[kind] ?? '', 10) || 0),
    0
  )

  async function submit() {
    setBusy(true)
    setError(null)
    const response = await fetch(`/api/admin/clients/${clientId}/material-orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: draft, notes }),
    })
    setBusy(false)
    if (!response.ok) {
      setError(t('errors.saveFailed'))
      return
    }
    setDraft({})
    setNotes('')
    setAdding(false)
    await load()
  }

  async function move(orderId: string, status: MaterialMoveStatus) {
    setBusy(true)
    setError(null)
    const response = await fetch(`/api/admin/clients/${clientId}/material-orders`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId, status }),
    })
    setBusy(false)
    // 409 means somebody else advanced it while this screen was open — reloading shows what
    // they did, which is more useful than an error about a race the operator cannot act on.
    if (!response.ok && response.status !== 409) {
      setError(t('errors.saveFailed'))
    }
    await load()
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-5 lg:p-8 shadow-sm">
      <SectionHeader
        icon={<Package className="w-4 h-4 text-amber-500" />}
        title={t('title')}
        color="amber-500"
      />
      <p className="text-xs text-gray-500 mb-6 leading-relaxed">{t('help')}</p>

      {orders === null ? (
        <p className="text-sm text-gray-500 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          {t('loading')}
        </p>
      ) : orders.length === 0 ? (
        <p className="text-sm text-gray-500">{t('empty')}</p>
      ) : (
        <ul className="space-y-3 mb-6">
          {orders.map((order) => (
            <li
              key={order.id}
              className="rounded-2xl border border-gray-200 dark:border-gray-800 px-5 py-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  {order.items.map((item) => (
                    <span key={item.kind} className="text-sm font-semibold text-gray-900 dark:text-white">
                      {item.quantity}× {t(`kinds.${item.kind}`)}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    {t(`statuses.${order.status}`)}
                  </span>
                  <MaterialMoveButtons
                    status={order.status}
                    busy={busy}
                    onMove={(status) => void move(order.id, status)}
                  />
                </div>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                {t(`sources.${order.source}`)} · {new Date(order.createdAt).toLocaleDateString('pt-BR')}
                {order.notes ? ` · ${order.notes}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {MATERIAL_KINDS.map((kind) => (
              <div key={kind} className="space-y-1">
                <label
                  htmlFor={`material-${kind}`}
                  className="text-[10px] font-bold text-gray-400 uppercase tracking-widest"
                >
                  {t(`kinds.${kind}`)}
                </label>
                <input
                  id={`material-${kind}`}
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={draft[kind] ?? ''}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      [kind]: event.target.value.replace(/\D/g, ''),
                    }))
                  }
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-semibold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-tuggi-blue/30"
                />
              </div>
            ))}
          </div>
          <input
            type="text"
            value={notes}
            maxLength={500}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t('notesPlaceholder')}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-tuggi-blue/30"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              // An order with no line does not exist — the database refuses it, and the button
              // says so before the person spends a round trip finding out.
              disabled={busy || draftTotal === 0}
              onClick={submit}
              className="px-4 py-2 rounded-xl bg-tuggi-blue text-white text-sm font-semibold disabled:opacity-40"
            >
              {busy ? t('actions.saving') : t('actions.save')}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false)
                setDraft({})
                setNotes('')
                setError(null)
              }}
              className="text-sm font-semibold text-gray-500 hover:underline"
            >
              {t('actions.discard')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-2 text-sm font-semibold text-tuggi-blue hover:underline"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          {t('actions.add')}
        </button>
      )}

      {error && (
        <p role="alert" className="mt-4 flex items-center gap-2 text-sm text-red-600">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  )
}
