'use client'

import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, Minus, type LucideIcon } from 'lucide-react'

import { DIM } from '@/components/ui/dense-table'
import { cn } from '@/lib/utils'
import type { DeltaState } from '@/lib/engagement/summary'

/**
 * One number of a question block (#1161, spec Parte E §E3.1): label, value with the share beside it,
 * whose share it is, the change against the month before and, where the spec has one, the market line.
 * It was the `SummaryTile` of Parte B: same value, change and n, without the six-month line (the block's
 * chart shows the months) and without the card chrome (it lives inside `QuestionCard`).
 *
 * The arrow is icon, sign and text; colour only reinforces it, and only `up` and `down` carry colour
 * (DS-COMPONENTE-100 items 1 and 2, DS-A11Y-003). The skeleton keeps the final heights.
 */

export interface StatLineProps {
  testId: string
  label: string
  /** The hint of the label, on hover. */
  hint?: string
  /** A badge after the label: GA4. */
  labelBadge?: ReactNode
  loading: boolean
  value: string
  /** The value is `UNKNOWN_VALUE`: it recedes, and `valueTitle` says why. */
  valueMuted: boolean
  valueTitle?: string
  /** The share, already formatted, printed after a middle dot; only over a denominator of the same instrument. */
  pct?: string | null
  /** Whose share or base it is ("of those who entered"). */
  denominator?: string | null
  /** Badges after the value: small sample, floor. */
  badges?: ReactNode
  delta?: { state: DeltaState; text: string; title?: string } | null
  /** The market line, where the spec has one. */
  reference?: string | null
}

const DELTA_ICON: Partial<Record<DeltaState, LucideIcon>> = { up: ArrowUp, down: ArrowDown, flat: Minus }
const DELTA_TONE: Record<DeltaState, string> = {
  up: 'text-green-700 dark:text-green-400',
  down: 'text-red-700 dark:text-red-400',
  flat: DIM,
  small_base: DIM,
  partial: DIM,
  new: DIM,
  closes: DIM,
  unknown: DIM,
}

const PULSE = 'animate-pulse rounded bg-gray-100 dark:bg-gray-800'

/** The classes of a small badge beside a number, the same as `Ga4Badge`. */
export const STAT_BADGE = 'inline-block align-middle rounded border border-gray-400 px-1.5 text-[10px] font-mono uppercase tracking-wider'

export function StatLine({ testId, label, hint, labelBadge, loading, value, valueMuted, valueTitle, pct, denominator, badges, delta, reference }: StatLineProps) {
  const DeltaIcon = delta ? DELTA_ICON[delta.state] : undefined
  return (
    <div data-testid={testId} className="min-w-0">
      <p className={cn('text-[11px] font-bold uppercase tracking-widest leading-[1.15]', DIM)} title={hint}>
        {label}
        {labelBadge}
      </p>
      {loading ? (
        <div aria-busy="true" data-testid="stat-line-loading">
          <div className={cn(PULSE, 'mt-1 h-8 w-20')} />
          <div className={cn(PULSE, 'mt-1 h-4 w-24')} />
          <div className={cn(PULSE, 'mt-1 h-4 w-16')} />
        </div>
      ) : (
        <>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5" data-testid="stat-line-value">
            <span className={cn('text-2xl font-black tabular-nums', valueMuted ? DIM : 'text-gray-900 dark:text-white')} title={valueTitle}>
              {value}
            </span>
            {pct && <span className="text-sm font-semibold tabular-nums text-gray-700 dark:text-gray-300">· {pct}</span>}
            {badges}
          </p>
          {denominator && <p className={cn('text-[11px] leading-4', DIM)}>{denominator}</p>}
          {delta && (
            <p
              className={cn('mt-1 flex items-center gap-1 text-xs font-semibold tabular-nums', DELTA_TONE[delta.state])}
              title={delta.title}
              data-testid="stat-line-delta"
              data-state={delta.state}
            >
              {DeltaIcon && <DeltaIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" data-testid={`stat-delta-icon-${delta.state}`} />}
              <span className="truncate">{delta.text}</span>
            </p>
          )}
          {reference && <p className={cn('mt-0.5 text-[11px] leading-4', DIM)}>{reference}</p>}
        </>
      )}
    </div>
  )
}

export default StatLine
