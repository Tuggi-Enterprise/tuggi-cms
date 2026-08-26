'use client'

/**
 * THE ESTEIRA AS BUTTONS — the other way to do what the drag does (WCAG 2.2 SC 2.5.7).
 *
 * ONE COMPONENT FOR TWO SCREENS. The queue card and the partner's record both offer the same
 * moves, and both used to hardcode `entregar` and `cancelar` next to a `status === 'requested'`
 * — two copies of a graph that now has five nodes. Here the buttons are DERIVED from
 * `MATERIAL_TRANSITIONS`, so a status with no exit draws nothing and a new arrow appears on
 * both screens at once.
 *
 * The label and the tint are the only things this file decides; what may follow what is not its
 * business, and it does not ask.
 */

import { useTranslations } from 'next-intl'
import { Check, Package, Truck, X } from 'lucide-react'
import {
  MATERIAL_TRANSITIONS,
  type MaterialColumnId,
  type MaterialMoveStatus,
} from '@/lib/materials/order-queue'

/** The verb behind each column, in `Clients.profile.material.actions`. */
const ACTION_KEY: Record<MaterialMoveStatus, string> = {
  in_preparation: 'prepare',
  dispatched: 'dispatch',
  fulfilled: 'fulfil',
  cancelled: 'cancel',
}

const ACTION_TONE: Record<MaterialMoveStatus, string> = {
  in_preparation: 'text-amber-600',
  dispatched: 'text-primary-800 dark:text-tuggi-blue',
  fulfilled: 'text-green-600',
  cancelled: 'text-gray-500',
}

function ActionIcon({ status }: { status: MaterialMoveStatus }) {
  const className = 'h-3.5 w-3.5'
  if (status === 'in_preparation') return <Package className={className} aria-hidden="true" />
  if (status === 'dispatched') return <Truck className={className} aria-hidden="true" />
  if (status === 'fulfilled') return <Check className={className} aria-hidden="true" />
  return <X className={className} aria-hidden="true" />
}

interface MaterialMoveButtonsProps {
  status: MaterialColumnId
  busy: boolean
  onMove: (status: MaterialMoveStatus) => void
}

export function MaterialMoveButtons({ status, busy, onMove }: MaterialMoveButtonsProps) {
  const t = useTranslations('Clients.profile.material.actions')
  const moves = MATERIAL_TRANSITIONS[status] as readonly MaterialMoveStatus[]
  if (moves.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {moves.map((move) => (
        <button
          key={move}
          type="button"
          disabled={busy}
          onClick={() => onMove(move)}
          className={`inline-flex min-h-[24px] items-center gap-1 text-xs font-semibold hover:underline disabled:opacity-50 ${ACTION_TONE[move]}`}
        >
          <ActionIcon status={move} />
          {t(ACTION_KEY[move])}
        </button>
      ))}
    </div>
  )
}
