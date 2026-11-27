'use client'

/**
 * The pieces every card of the Acquisition page draws the same way (#1171, #1309): the formatters, a
 * count that knows unknown from floor, and the coverage lines under a card header. One copy, so the
 * funnel and the ASO section (`AcquisitionAso.tsx`) cannot drift apart (DS-COMPONENTE-084 item 1:
 * coverage in three states, said once per card, never in the cell, #1051).
 */

import { useMemo, type ReactNode } from 'react'
import { useLocale } from 'next-intl'

import { STAT_BADGE } from '@/components/dashboard/reports/engagement/StatLine'
import { DIM } from '@/components/ui/dense-table'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { cn } from '@/lib/utils'
import type { FunnelSource, SourceCoverage } from '@/lib/acquisition/funnel'

export type AcqT = (key: string, values?: Record<string, string | number>) => string

/** A source with a name in `coverage.source.*`: the funnel's five and the search tracker of #1307. */
export type CoverageSource = FunnelSource | 'store_rank'

export const PULSE = 'animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800'
export const ROW_LINE = 'border-t border-gray-100 dark:border-gray-800'
export const EMPTY = cn('py-8 text-center text-xs', DIM)

export interface Fmt {
  int: (v: number) => string
  pct: (v: number) => string
  dec: (v: number) => string
  day: (iso: string) => string
}

export function useAcquisitionFmt(): Fmt {
  const locale = useLocale()
  return useMemo<Fmt>(() => {
    const int = new Intl.NumberFormat(locale)
    const pct = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
    const dec = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    const day = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
    return {
      int: (v) => int.format(v),
      pct: (v) => pct.format(v),
      dec: (v) => dec.format(v),
      day: (iso) => day.format(new Date(`${iso}T12:00:00Z`)),
    }
  }, [locale])
}

/** A count of a source: `UNKNOWN_VALUE` when unknown, `≥ n` when the source covers part of the month. */
export function Count({ v, floor, fmt, title }: { v: number | null; floor: boolean; fmt: Fmt; title?: string }) {
  if (v === null) return <span className={DIM} title={title}>{UNKNOWN_VALUE}</span>
  return <>{`${floor ? '≥ ' : ''}${fmt.int(v)}`}</>
}

export function SkeletonRows({ n }: { n: number }) {
  return (
    <div className="space-y-1" aria-busy="true">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className={cn(PULSE, 'h-10')} />
      ))}
    </div>
  )
}

export interface CoverageItem {
  source: CoverageSource
  c: SourceCoverage
  /** One more sentence of this source, after its coverage: the days the search tracker could not read. */
  note?: { text: string; title?: string; testId?: string }
}

/** The coverage of the card's sources, one line per source, under the header (#1051: never in the cell). */
export function CoverageLines({ items, t, fmt, extra }: { items: CoverageItem[]; t: AcqT; fmt: Fmt; extra?: ReactNode }) {
  const lines: ReactNode[] = []
  for (const { source, c, note } of items) {
    const name = t(`coverage.source.${source}`)
    const badge = (text: string) => <span className={cn(STAT_BADGE, 'mr-1.5')}>{text}</span>
    const noteLine = note ? (
      <p key={`${source}-note`} data-testid={note.testId} title={note.title}>
        {note.text}
      </p>
    ) : null
    if (c.state === 'none') {
      lines.push(
        <p key={source} data-testid={`coverage-${source}`} data-state="none">
          {badge(t('coverage.no_data_badge'))}
          {c.none === 'before_start' ? t('coverage.none_before_start', { source: name, date: fmt.day(c.from as string) }) : t('coverage.none_not_configured', { source: name })}
        </p>
      )
      continue
    }
    if (c.state === 'full') {
      if (noteLine) lines.push(noteLine)
      continue
    }
    const sentences = [
      c.from ? t('coverage.partial', { source: name, date: fmt.day(c.from) }) : null,
      c.through ? t('coverage.through', { source: name, date: fmt.day(c.through) }) : null,
      c.noRows ? t('coverage.no_rows', { source: name }) : null,
    ].filter(Boolean)
    // partial only by its note (the days the search tracker could not read): the note says it, a bare "floor" badge would not
    if (sentences.length === 0) {
      if (noteLine) lines.push(noteLine)
      continue
    }
    lines.push(
      <p key={source} data-testid={`coverage-${source}`} data-state="partial">
        {c.from && badge(t('coverage.since_badge', { date: fmt.day(c.from) }))}
        {badge(t('coverage.floor_badge'))}
        {sentences.join(' ')}
      </p>
    )
    if (noteLine) lines.push(noteLine)
  }
  if (lines.length === 0 && !extra) return null
  return (
    <div className={cn('-mt-2 mb-3 space-y-1 text-[11px] leading-4', DIM)}>
      {extra}
      {lines}
    </div>
  )
}
