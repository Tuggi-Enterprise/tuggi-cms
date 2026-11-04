'use client'

import { cn } from '@/lib/utils'
import { DIM } from '@/components/ui/dense-table'
import { CHART_NEUTRAL } from '@/lib/constants/chart-colors'

/**
 * Linha de ranking com barra de proporção. Extraída porque cidades, parceiros e
 * clusters usam exatamente a mesma anatomia — e o padrão já existia copiado em
 * reports/engagement e reports/catalog.
 *
 * `partOf` desenha a fatia atribuída a parceiro dentro da barra, com 2px de
 * respiro para as duas partes se lerem como blocos distintos.
 */
interface RankRowProps {
  label: string
  sub?: string
  value: number
  /** Text printed in place of `value` (a rate, a dash); the bar keeps reading `value`. */
  display?: string
  /** parcela do valor que tem parceiro atribuído; desenhada em outra cor */
  partOf?: number
  max: number
  color: string
  partColor?: string
  /** recua a linha quando ela não é um lugar de verdade (lacuna, teste); the label recedes to `DIM`, which still passes 4.5:1 */
  muted?: boolean
  right?: React.ReactNode
  /** Overrides the label type, as `font-mono text-xs` for a raw event name (#1094). */
  labelClassName?: string
  /** Hover text of the label, as the raw event name behind a friendly label (#1096). */
  title?: string
}

export function RankRow({ label, sub, value, display, partOf = 0, max, color, partColor, muted, right, labelClassName, title }: RankRowProps) {
  const pct = max > 0 ? (value / max) * 100 : 0
  const partPct = value > 0 ? (partOf / value) * 100 : 0

  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <div className="min-w-0 flex items-baseline gap-2">
          <span title={title} className={cn('text-sm font-semibold truncate', muted ? DIM : 'text-gray-900 dark:text-white', labelClassName)}>
            {label}
          </span>
          {sub && <span className={cn('text-[11px] shrink-0', DIM)}>{sub}</span>}
        </div>
        <div className="flex items-baseline gap-2 shrink-0">
          {right}
          <span className="text-sm font-mono font-bold tabular-nums text-gray-900 dark:text-white">{display ?? value}</span>
        </div>
      </div>

      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden flex gap-[2px]">
        <div className="h-full rounded-full flex gap-[2px]" style={{ width: `${pct}%` }}>
          {partOf > 0 && partColor && (
            <div className="h-full rounded-full" style={{ width: `${partPct}%`, backgroundColor: partColor }} />
          )}
          <div className="h-full rounded-full flex-1" style={{ backgroundColor: muted ? CHART_NEUTRAL : color }} />
        </div>
      </div>
    </div>
  )
}

export default RankRow
