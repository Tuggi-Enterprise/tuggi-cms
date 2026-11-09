/**
 * Block 0, "the month in three lines" (#1161, spec Parte E §E5.1; copy §2): which numbers changed most
 * against the month before. Pure, so the choice is tested without mounting.
 *
 * DS-COMPONENTE-100 decides what may enter: only a number whose change the block would colour (`up` or
 * `down`: both months measured, both bases of `SUMMARY_MIN_BASE` or more, not the current month, not a
 * floor). Order by the relative change from the raw values, rates included, so a rate competes with a
 * count; a previous zero has no relative change and stays out; a tie keeps the order of the page.
 */

import { addMonths } from '@/lib/engagement/months'
import type { QuestionBlock } from '@/lib/engagement/blocks'

/** Lines of block 0 (spec §E5.1 item 4). */
export const HEADLINE_LINES = 3

export interface Headline {
  block: QuestionBlock['key']
  direction: 'up' | 'down'
  /** `|current − previous| / previous`, from the values as sent. */
  change: number
}

export type HeadlinesEmpty = 'in_progress' | 'no_previous' | 'sample' | 'steady'

export interface Headlines {
  lines: Headline[]
  /** Why there is no line; `null` when there is at least one. */
  empty: HeadlinesEmpty | null
  /** `in_progress`: the first day the month is closed, `YYYY-MM-DD`. */
  closesOn: string | null
}

export function pickHeadlines(blocks: readonly QuestionBlock[], month: string, today: string): Headlines {
  if (month === today.slice(0, 7)) return { lines: [], empty: 'in_progress', closesOn: `${addMonths(month, 1)}-01` }
  const lines: (Headline & { order: number })[] = []
  blocks.forEach((b, order) => {
    const d = b.headline.delta
    if (!d || (d.state !== 'up' && d.state !== 'down')) return
    const c = d.curr.cell.value
    const p = d.prev.cell.value
    if (c === null || p === null || p === 0) return
    lines.push({ block: b.key, direction: d.state, change: Math.abs(c - p) / p, order })
  })
  lines.sort((a, b) => b.change - a.change || a.order - b.order)
  if (lines.length > 0) return { lines: lines.slice(0, HEADLINE_LINES).map(({ order: _order, ...h }) => h), empty: null, closesOn: null }
  const deltas = blocks.map((b) => b.headline.delta)
  const noPrevious = deltas.every((d) => !d || d.state === 'new' || d.state === 'unknown' || d.state === 'closes')
  const sample = deltas.some((d) => d?.state === 'small_base')
  return { lines: [], empty: noPrevious ? 'no_previous' : sample ? 'sample' : 'steady', closesOn: null }
}
