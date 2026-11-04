'use client'

import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, Minus, type LucideIcon } from 'lucide-react'

import { WidgetCard } from '@/components/dashboard/WidgetCard'
import { DIM } from '@/components/ui/dense-table'
import { Sparkline } from '@/components/ui/Sparkline'
import { CHART_COLORS } from '@/lib/constants/chart-colors'
import { cn } from '@/lib/utils'
import type { DeltaState } from '@/lib/engagement/summary'

/**
 * A number of the month with its change and a six month line (#1099, spec §B4). On `WidgetCard`, not
 * `StatCard`: that one has no place for a change or a line and lifts on hover as if it were a link.
 * The skeleton draws the same five blocks at the same heights, so the row does not jump when the
 * data arrives. The arrow is icon, sign and text; colour only reinforces it (DS-COMPONENTE-100 item
 * 2, DS-A11Y-003), and only `up` and `down` carry colour (DS-COMPONENTE-100 item 1).
 */

export interface SummaryTileProps {
  testId: string
  icon: LucideIcon
  label: string
  /** The month the value is of, when it is not the summary's (DS-COMPONENTE-100 item 4). */
  monthTag?: string | null
  /** Keeps the line of `monthTag` even before the data, so the tile does not grow when it arrives. */
  reserveMonthTag?: boolean
  loading: boolean
  value: string
  /** The value is `UNKNOWN_VALUE`: it recedes, and `valueTitle` says why. */
  valueMuted: boolean
  valueTitle?: string
  delta: { state: DeltaState; text: string; title?: string }
  spark: { points: (number | null)[]; title: string }
  n: ReactNode
}

const DELTA_ICON: Partial<Record<DeltaState, LucideIcon>> = { up: ArrowUp, down: ArrowDown, flat: Minus }
const DELTA_TONE: Record<DeltaState, string> = {
  up: 'text-green-700 dark:text-green-400',
  down: 'text-red-700 dark:text-red-400',
  flat: DIM,
  small_base: DIM,
  partial: DIM,
  unknown: DIM,
}

const PULSE = 'animate-pulse rounded bg-gray-100 dark:bg-gray-800'

export function SummaryTile({ testId, icon: Icon, label, monthTag, reserveMonthTag, loading, value, valueMuted, valueTitle, delta, spark, n }: SummaryTileProps) {
  const DeltaIcon = DELTA_ICON[delta.state]
  return (
    <div data-testid={testId}>
      <WidgetCard className="h-full">
        <div className="flex items-center gap-2 mb-1.5 min-h-[32px]">
          <span className="p-2 rounded-lg shrink-0" style={{ backgroundColor: `${CHART_COLORS.blue}20`, color: CHART_COLORS.blue }} data-testid="summary-tile-icon">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="text-[11px] font-bold uppercase tracking-widest leading-[1.15] text-gray-500 dark:text-gray-400">
            {label}
            {monthTag ? (
              <span className="block text-gray-900 dark:text-white" data-testid="summary-tile-month">{monthTag}</span>
            ) : (
              reserveMonthTag && <span className="block" aria-hidden="true">{'\u00a0'}</span>
            )}
          </span>
        </div>
        {loading ? (
          <div aria-busy="true" data-testid="summary-tile-loading">
            <div className={cn(PULSE, 'h-[30px] w-24')} />
            <div className={cn(PULSE, 'mt-1 h-5 w-20')} />
            <div className={cn(PULSE, 'mt-2 h-8 w-full')} />
            <div className="mt-1 h-8">
              <div className={cn(PULSE, 'h-4 w-28')} />
            </div>
          </div>
        ) : (
          <>
            <p className={cn('text-3xl font-black leading-none tabular-nums h-[30px]', valueMuted ? DIM : 'text-gray-900 dark:text-white')} title={valueTitle}>
              {value}
            </p>
            <p
              className={cn('mt-1 flex h-5 items-center gap-1 text-sm font-semibold tabular-nums', DELTA_TONE[delta.state])}
              title={delta.title}
              data-testid="summary-tile-delta"
              data-state={delta.state}
            >
              {DeltaIcon && <DeltaIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" data-testid={`summary-delta-icon-${delta.state}`} />}
              <span className="truncate">{delta.text}</span>
            </p>
            <div className="mt-2 h-8 w-full">
              <Sparkline points={spark.points} accentIndex={spark.points.length - 1} title={spark.title} />
            </div>
            {/* two lines reserved: at 390 the n wraps, and the tile keeps its height before and after the data */}
            <p className={cn('mt-1 h-8 overflow-hidden text-[11px] leading-4', DIM)}>{n}</p>
          </>
        )}
      </WidgetCard>
    </div>
  )
}

export default SummaryTile
