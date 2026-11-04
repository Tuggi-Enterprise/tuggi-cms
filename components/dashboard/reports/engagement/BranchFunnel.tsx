'use client'

import type { ReactNode } from 'react'

import { FunnelBadge } from '@/components/dashboard/reports/engagement/FunnelBands'
import { DIM } from '@/components/ui/dense-table'
import { cn } from '@/lib/utils'

/**
 * The purchase funnel (#1101, spec-cms-relatorio-engajamento-2026-11 §C6, DS-COMPONENTE-101): a
 * trunk (Entered) split in two parts, and one box per branch with its purchase rate. Each branch bar
 * is 100 % of the branch and the fill is the rate, so the two rates compare on bars of the same
 * length, in the same element and class. The trunk part wears the colour of its branch: the link is
 * colour and position, no arrow. Colour is reinforcement: name, number, `title` and the sr-only line
 * carry the reading (DS-A11Y-003, DS-A11Y-007).
 *
 * Presentational: strings arrive formatted, fractions arrive computed by `readPurchaseFunnel`.
 */

export interface BranchFunnelPart {
  key: string
  /** Width as a fraction of the trunk, 0 to 1. */
  fraction: number
  color: string
  title: string
}

export interface BranchFunnelBranch {
  key: string
  color: string
  label: string
  hint: string
  /** The size line: bold number, then the rest. */
  sizeNumber: string
  sizeRest?: string
  sizeTitle?: string
  /** The fill of the branch bar, 0 to 1; `null` draws no fill. */
  fill: number | null
  rate: string
  /** The rate prints dim: no rate (empty branch, no data). */
  rateMuted: boolean
  rateTitle?: string
  rateCaption: string
  badge?: string
  counts: string
  countsMuted: boolean
  countsTitle?: string
  sr: string
}

export type BranchFunnelProps = { label: string } & (
  | { loading: true }
  | {
      loading?: false
      trunk: { label: string; display: string; parts: BranchFunnelPart[]; purchased: ReactNode }
      branches: BranchFunnelBranch[]
    }
)

const NUMBER = 'font-mono font-bold tabular-nums text-gray-900 dark:text-white'
const PULSE = 'rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse'

function Skeleton({ label }: { label: string }) {
  return (
    <div role="group" aria-label={label} aria-busy="true" data-testid="purchase-loading">
      <div className={cn(PULSE, 'h-5 w-full')} />
      <div className={cn(PULSE, 'mt-1 h-7 w-full')} />
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-800 border-t-4 p-3 space-y-2">
            <div className={cn(PULSE, 'h-3.5 w-32')} />
            <div className={cn(PULSE, 'h-5 w-40')} />
            <div className={cn(PULSE, 'h-7 w-full')} />
            <div className={cn(PULSE, 'h-7 w-24')} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function BranchFunnel(props: BranchFunnelProps) {
  if (props.loading) return <Skeleton label={props.label} />
  const { trunk, branches } = props
  return (
    <div aria-label={props.label} role="group" data-testid="purchase-funnel-body">
      <div data-testid="purchase-trunk">
        <div className="flex h-5 items-baseline justify-between gap-3">
          <span className="text-sm font-semibold text-gray-900 dark:text-white">{trunk.label}</span>
          <span className={cn('text-sm', NUMBER)}>{trunk.display}</span>
        </div>
        <div aria-hidden="true" className="mt-1 h-7 w-full flex gap-[2px] rounded-md overflow-hidden">
          {trunk.parts
            .filter((p) => p.fraction > 0)
            .map((p) => (
              <div
                key={p.key}
                data-testid={`purchase-trunk-part-${p.key}`}
                title={p.title}
                className="h-full min-w-0"
                style={{ flex: `${p.fraction} 1 0%`, backgroundColor: p.color }}
              />
            ))}
        </div>
        <p className={cn('mt-1.5 text-[11px] leading-4', DIM)}>{trunk.purchased}</p>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        {branches.map((b) => (
          <section
            key={b.key}
            data-testid={`purchase-branch-${b.key}`}
            className="rounded-lg border border-gray-200 dark:border-gray-800 border-t-4 p-3"
            style={{ borderTopColor: b.color }}
          >
            <span className="sr-only">{b.sr}</span>
            <h3 className={cn('text-[10px] font-bold uppercase tracking-widest', DIM)} title={b.hint}>
              {b.label}
            </h3>
            <p className="mt-1 text-sm" aria-hidden="true" title={b.sizeTitle}>
              <span className={cn(NUMBER, b.sizeTitle && DIM)}>{b.sizeNumber}</span>
              {b.sizeRest && <span className={DIM}> · {b.sizeRest}</span>}
            </p>
            <div aria-hidden="true" className="mt-2 h-7 w-full rounded-md bg-gray-100 dark:bg-gray-800 overflow-hidden">
              {b.fill !== null && b.fill > 0 && (
                <div
                  data-testid={`purchase-branch-fill-${b.key}`}
                  className="h-full rounded-md min-w-[4px]"
                  style={{ width: `${b.fill * 100}%`, backgroundColor: b.color }}
                />
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1" aria-hidden="true">
              <span
                data-testid={`purchase-rate-${b.key}`}
                title={b.rateTitle}
                className={cn('text-lg font-black tabular-nums', b.rateMuted ? DIM : 'text-gray-900 dark:text-white')}
              >
                {b.rate}
              </span>
              <span className={cn('text-[11px]', DIM)}>{b.rateCaption}</span>
              {b.badge && <FunnelBadge text={b.badge} />}
            </div>
            <p className={cn('mt-0.5 text-[11px] leading-4', DIM)} aria-hidden="true" title={b.countsTitle}>
              {b.counts}
            </p>
          </section>
        ))}
      </div>
    </div>
  )
}

export default BranchFunnel
