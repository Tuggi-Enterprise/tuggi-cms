'use client'

import { cn } from '@/lib/utils'

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
  /** parcela do valor que tem parceiro atribuído; desenhada em outra cor */
  partOf?: number
  max: number
  color: string
  partColor?: string
  /** recua a linha quando ela não é um lugar de verdade (lacuna, teste) */
  muted?: boolean
  right?: React.ReactNode
}

export function RankRow({ label, sub, value, partOf = 0, max, color, partColor, muted, right }: RankRowProps) {
  const pct = max > 0 ? (value / max) * 100 : 0
  const partPct = value > 0 ? (partOf / value) * 100 : 0

  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <div className="min-w-0 flex items-baseline gap-2">
          <span className={cn('text-sm font-semibold truncate', muted ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-white')}>
            {label}
          </span>
          {sub && <span className="text-[11px] text-gray-400 shrink-0">{sub}</span>}
        </div>
        <div className="flex items-baseline gap-2 shrink-0">
          {right}
          <span className="text-sm font-mono font-bold tabular-nums text-gray-900 dark:text-white">{value}</span>
        </div>
      </div>

      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden flex gap-[2px]">
        <div className="h-full rounded-full flex gap-[2px]" style={{ width: `${pct}%` }}>
          {partOf > 0 && partColor && (
            <div className="h-full rounded-full" style={{ width: `${partPct}%`, backgroundColor: partColor }} />
          )}
          <div className="h-full rounded-full flex-1" style={{ backgroundColor: muted ? '#a5a39c' : color }} />
        </div>
      </div>
    </div>
  )
}

export default RankRow
