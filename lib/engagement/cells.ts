/**
 * Every cell of the Engagement report grid, resolved in plain TS so it is testable without mounting
 * (#1094, spec-cms-relatorio-engajamento-2026-11 §3.2 and §4). `MonthGrid` prints what this returns
 * and computes nothing.
 *
 * Three promises live here:
 *
 *  - **`null` is never `0`** (BR-COMUNICACAO-022 item 4; DS-COMPONENTE-084 item 1). A `null` cell
 *    gets a state that says why it is empty: the source was not recording yet (`before_source`),
 *    its window has not closed (`not_due`), GA4 has no such filter (`ga4_filter`), the source
 *    failed (`source_failed`), or, when nothing else explains it, fewer than 5 people
 *    (`suppressed`). `0` prints only when the source sent `0`: a measured zero.
 *  - **A window that has not closed prints a floor** (`floor`, "at least this") when the database
 *    sent a number (DS-COMPONENTE-084 item 1, clause of 2026-09-16).
 *  - **No fraction crosses instruments** (DS-COMPONENTE-084 item 2). The only divisions below are
 *    GA4 by GA4 (`screen_minutes`) and bank by bank (`countShare`, a band of `days_used` over
 *    `active` of the same use and month).
 */

import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { formatDurationOrDash } from '@/lib/format/duration'
import { addDays, addMonths } from '@/lib/engagement/months'
import type {
  EngagementBankMonth,
  EngagementBankReport,
  EngagementGa4Month,
  EngagementGa4Report,
  EngagementUse,
} from '@/lib/engagement/report'

export type CellKind = 'count' | 'rate' | 'decimal' | 'minutes' | 'countShare'
export type RowSource = 'bank' | 'ga4'
export type CellState =
  | 'loading'
  | 'measured'
  | 'floor'
  | 'before_source'
  | 'not_due'
  | 'ga4_filter'
  | 'source_failed'
  | 'suppressed'

export interface Cell {
  state: CellState
  /** The value to print in `measured` and `floor`; `null` in every other state. */
  value: number | null
  /** `countShare` only: the fraction of the month's active people, `null` when there is no base. */
  share: number | null
  /** `before_source`: the first day the source recorded, `null` when it has no row at all. */
  since: string | null
  /** `not_due` and `floor`: the day the window closes. */
  due: string | null
}

/** The window of a row, counted from the end of the cell's month (spec §3.2). */
type Window = { days: number } | 'next_month'

/** Which `data_since` governs a bank row. `use` is the selected definition. */
type Since = 'use' | EngagementUse

interface RowDef {
  key: string
  source: RowSource
  kind: CellKind
  window?: Window
  since?: Since
  bank?: (m: EngagementBankMonth, use: EngagementUse) => number | null
  ga4?: (m: EngagementGa4Month) => number | null
}

export interface GridRow {
  key: string
  source: RowSource
  kind: CellKind
  cells: Cell[]
}

export interface GridGroup {
  /** `null` for a card with no group headings. */
  key: string | null
  rows: GridRow[]
}

export type GridCardKey = 'card_people_time' | 'card_frequency' | 'card_after_first'

export interface GridCard {
  key: GridCardKey
  groups: GridGroup[]
}

/** `screen_minutes`: GA4 by GA4, and no active users is no average (DS-COMPONENTE-084 item 2). */
const screenMinutes = (m: EngagementGa4Month) => (m.activeUsers > 0 ? m.engagementSeconds / m.activeUsers / 60 : null)

const RET = [1, 7, 30, 60, 90] as const
const SECOND = [30, 60, 90] as const

/** The rows of the three cards, in the order of spec §4. */
export const GRID_CARDS: ReadonlyArray<{ key: GridCardKey; groups: ReadonlyArray<{ key: string | null; rows: RowDef[] }> }> = [
  {
    key: 'card_people_time',
    groups: [
      {
        key: 'g_people',
        rows: [
          { key: 'active_ga4', source: 'ga4', kind: 'count', ga4: (m) => m.activeUsers },
          { key: 'active_by', source: 'bank', kind: 'count', since: 'use', bank: (m, u) => m.active[u] },
          { key: 'new_by', source: 'bank', kind: 'count', since: 'use', bank: (m, u) => m.new[u] },
        ],
      },
      {
        key: 'g_time',
        rows: [
          { key: 'screen_minutes', source: 'ga4', kind: 'minutes', ga4: screenMinutes },
          { key: 'guide_median', source: 'bank', kind: 'minutes', since: 'trip', bank: (m) => m.guide_minutes_median },
          { key: 'guide_p75', source: 'bank', kind: 'minutes', since: 'trip', bank: (m) => m.guide_minutes_p75 },
        ],
      },
    ],
  },
  {
    key: 'card_frequency',
    groups: [
      {
        key: null,
        rows: [
          { key: 'sessions_ga4', source: 'ga4', kind: 'decimal', ga4: (m) => m.sessionsPerUser },
          { key: 'days_1', source: 'bank', kind: 'countShare', since: 'use', bank: (m, u) => m.days_used[u].d1 },
          { key: 'days_2', source: 'bank', kind: 'countShare', since: 'use', bank: (m, u) => m.days_used[u].d2 },
          { key: 'days_3_5', source: 'bank', kind: 'countShare', since: 'use', bank: (m, u) => m.days_used[u].d3_5 },
          { key: 'days_6_plus', source: 'bank', kind: 'countShare', since: 'use', bank: (m, u) => m.days_used[u].d6_plus },
          { key: 'returned_next', source: 'bank', kind: 'rate', since: 'use', window: 'next_month', bank: (m, u) => m.returned_next_month[u] },
        ],
      },
    ],
  },
  {
    key: 'card_after_first',
    groups: [
      {
        key: 'g_activation',
        // The base of `activation` is `new.open` of the month (contract Parte 25).
        rows: [
          { key: 'audio_24h', source: 'bank', kind: 'rate', since: 'open', window: { days: 1 }, bank: (m) => m.activation.audio_24h },
          { key: 'audio_7d', source: 'bank', kind: 'rate', since: 'open', window: { days: 7 }, bank: (m) => m.activation.audio_7d },
        ],
      },
      {
        // `cohort` is the cohort of the first trip (contract Parte 25): it ignores the selector.
        key: 'g_cohort',
        rows: [
          { key: 'cohort_size', source: 'bank', kind: 'count', since: 'trip', bank: (m) => m.cohort.size },
          ...RET.map((d): RowDef => ({
            key: `ret_d${d}`,
            source: 'bank',
            kind: 'rate',
            since: 'trip',
            window: { days: d },
            bank: (m) => m.cohort.retention[`d${d}`],
          })),
          ...SECOND.map((d): RowDef => ({
            key: `second_${d}`,
            source: 'bank',
            kind: 'rate',
            since: 'trip',
            window: { days: d },
            bank: (m) => m.cohort.second_trip[`d${d}`],
          })),
        ],
      },
    ],
  },
]

/** The day a row's window closes for a month: the first day it is complete. */
export function windowCloses(month: string, window: Window): string {
  if (window === 'next_month') return `${addMonths(month, 2)}-01`
  return addDays(`${addMonths(month, 1)}-01`, window.days)
}

/**
 * Is the month before the source recorded? `open` counts only the months that START after its
 * `data_since` (the first whole month, contract Parte 25); `trip` and `audio` count from the
 * month of their first row.
 */
export function beforeSource(month: string, since: string | null, use: EngagementUse): boolean {
  if (since === null) return true
  return use === 'open' ? `${month}-01` < since : month < since.slice(0, 7)
}

export interface GridInput {
  months: readonly string[]
  /** Today in Sao Paulo, `YYYY-MM-DD`. */
  today: string
  use: EngagementUse
  bank?: EngagementBankReport
  bankFailed: boolean
  ga4?: EngagementGa4Report
  ga4Failed: boolean
  /** A filter is on that GA4 does not have (source, account). */
  ga4Filtered: boolean
}

const empty = (state: CellState, extra: Partial<Cell> = {}): Cell => ({ state, value: null, share: null, since: null, due: null, ...extra })

/** One cell. Exported for the tests; the screen reads `buildGrid`. */
export function resolveCell(row: RowDef, month: string, input: GridInput): Cell {
  const current = input.today.slice(0, 7)

  if (row.source === 'ga4') {
    if (input.ga4Filtered) return empty('ga4_filter')
    if (input.ga4Failed) return empty('source_failed')
    if (!input.ga4) return empty('loading')
    const m = input.ga4.months.find((x) => x.month === month)
    // GA4 leaves out a month whose metrics are all zero: it answered, and nobody was active.
    const value = m ? row.ga4!(m) : row.key === 'active_ga4' ? 0 : null
    return value === null ? empty('suppressed') : { ...empty('measured'), value }
  }

  if (input.bankFailed) return empty('source_failed')
  if (!input.bank) return empty('loading')

  const sinceUse: EngagementUse = row.since === undefined || row.since === 'use' ? input.use : row.since
  const since = input.bank.data_since[sinceUse]
  const m = input.bank.months.find((x) => x.month === month)
  // A month the database did not return can only be a month its sources did not cover (spec §3).
  if (!m) return empty('before_source', { since })
  const value = row.bank!(m, input.use)

  const due = row.window ? windowCloses(month, row.window) : null
  const open = due !== null && input.today < due

  if (value !== null) {
    let share: number | null = null
    if (row.kind === 'countShare') {
      const base = m.active[input.use]
      share = base !== null && base > 0 ? value / base : null
    }
    // The current month says "until today" in its header and marks no floor cell by cell (spec §3.2).
    const floor = open && month !== current
    return { ...empty(floor ? 'floor' : 'measured'), value, share, due: floor ? due : null }
  }
  if (beforeSource(month, since, sinceUse)) return empty('before_source', { since })
  if (open) return empty('not_due', { due })
  return empty('suppressed')
}

/** The three cards, every row with one cell per month. */
export function buildGrid(input: GridInput): GridCard[] {
  return GRID_CARDS.map((card) => ({
    key: card.key,
    groups: card.groups.map((g) => ({
      key: g.key,
      rows: g.rows.map((row) => ({
        key: row.key,
        source: row.source,
        kind: row.kind,
        cells: input.months.map((month) => resolveCell(row, month, input)),
      })),
    })),
  }))
}

/** Every bank cell of every month is empty: the slice has nothing to show (spec §6, "recorte vazio"). */
export function bankSliceEmpty(cards: readonly GridCard[]): boolean {
  const bank = cards.flatMap((c) => c.groups.flatMap((g) => g.rows.filter((r) => r.source === 'bank').flatMap((r) => r.cells)))
  return bank.length > 0 && bank.every((c) => c.state === 'suppressed' || c.state === 'before_source' || c.state === 'not_due')
    && bank.some((c) => c.state === 'suppressed')
}

export interface CellFormatters {
  integer: Intl.NumberFormat
  percent: Intl.NumberFormat
  decimal: Intl.NumberFormat
}

export function cellFormatters(locale: string): CellFormatters {
  return {
    integer: new Intl.NumberFormat(locale),
    // A small base: 7 of 23 is 30 %, not 30,4 % (spec §3.2).
    percent: new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }),
    decimal: new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  }
}

/** The printed value of a cell; `UNKNOWN_VALUE` for every state without one, never `0`. */
export function formatCell(kind: CellKind, cell: Cell, f: CellFormatters): { main: string; share: string | null } {
  if (cell.value === null || (cell.state !== 'measured' && cell.state !== 'floor')) return { main: UNKNOWN_VALUE, share: null }
  const v = cell.value
  switch (kind) {
    case 'count':
      return { main: f.integer.format(v), share: null }
    case 'rate':
      return { main: f.percent.format(v), share: null }
    case 'decimal':
      return { main: f.decimal.format(v), share: null }
    case 'minutes':
      return { main: formatDurationOrDash(Math.round(v)), share: null }
    case 'countShare':
      return { main: f.integer.format(v), share: cell.share === null ? null : f.percent.format(cell.share) }
  }
}
