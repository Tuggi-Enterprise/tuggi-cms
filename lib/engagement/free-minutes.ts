/**
 * The free minutes histogram of the Engagement report (#1156, #1162; spec Parte E §E5.6):
 * `core.cms_get_free_minutes_histogram(p_month)` (contract banco-para-cms Parte 27 §3), read and turned
 * into rows here, in plain TS, so the screen only translates and lays out.
 *
 * Six buckets closed below and open above, the last without `to_min`, counting only who spent more than
 * 0 free minutes; `not_used` is the cohort with 0, printed apart from the bars. The share of a bucket is
 * over who used (the sum of the buckets), the one base of the bars. Since #1160 a group of 1 to 4 people
 * is a number: `null` only before the minute ledger, and `null` stays "no data", never 0
 * (BR-COMUNICACAO-022 item 4; DS-COMPONENTE-084 item 1).
 *
 * The marks follow `to_min` of the data, not a fixed position: if the buckets change in the database, a
 * mark stays on its border or goes away.
 */

import { LEDGER_FIRST_MONTH } from '@/lib/conversion/funnel'

export interface FreeMinutesBucket {
  fromMin: number
  /** `null` on the last, open bucket. */
  toMin: number | null
  /** `null` = a month before the ledger. `0` is measured. */
  people: number | null
}

export interface FreeMinutesHistogram {
  /** YYYY-MM */
  month: string
  /** The cohort: `not_used` + the buckets + who has no readable ledger. */
  base: number | null
  /** The cohort with 0 free minutes to date; `null` before the ledger or from a function before #1160. */
  notUsed: number | null
  buckets: FreeMinutesBucket[]
}

/** The borders that get a dashed line, in minutes: 15 min, 1 h and 3 h (spec §D4). */
export const FREE_MINUTES_MARKS = [15, 60, 180] as const
export type FreeMinutesMark = (typeof FREE_MINUTES_MARKS)[number]

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

/** The jsonb of the function. A missing key is `null`, never `0`; a bucket without `from_min` is dropped. */
export function parseFreeMinutesHistogram(raw: unknown): FreeMinutesHistogram {
  const r = obj(raw)
  const buckets: FreeMinutesBucket[] = []
  for (const b of Array.isArray(r.buckets) ? r.buckets : []) {
    const o = obj(b)
    const fromMin = n(o.from_min)
    if (fromMin === null) continue
    buckets.push({ fromMin, toMin: n(o.to_min), people: n(o.people) })
  }
  return {
    month: typeof r.month === 'string' ? r.month.slice(0, 7) : '',
    base: n(r.base),
    notUsed: n(r.not_used),
    buckets: buckets.sort((a, b) => a.fromMin - b.fromMin),
  }
}

/**
 * What the chart is:
 * - `no_source`: the function is not deployed yet (PGRST202) or sent no bucket;
 * - `before_ledger`: the month ends before the minute ledger, nothing was measured;
 * - `empty`: nobody used free minutes, six bars of 0;
 * - `measured`: the six rows with their shares of who used.
 */
export type FreeMinutesState = 'no_source' | 'before_ledger' | 'empty' | 'measured'

export interface FreeMinutesRow {
  /** The copy key of the range: `b0_15` ... `b180_plus`. */
  key: string
  fromMin: number
  toMin: number | null
  people: number | null
  /** `people / used`; `null` with no positive base. */
  share: number | null
  /** The mark drawn after this row, when its `to_min` is one of `FREE_MINUTES_MARKS`. */
  markAfter: FreeMinutesMark | null
}

export interface FreeMinutesView {
  state: FreeMinutesState
  /** The cohort of the month. */
  base: number | null
  /** Who spent free minutes: the sum of the buckets, the base of every share. */
  used: number | null
  notUsed: number | null
  /** `notUsed / base`, both of the same cohort; `null` with no positive base. */
  notUsedShare: number | null
  /** The widest measured bucket: the ruler of the bars. */
  max: number
  rows: FreeMinutesRow[]
}

export const bucketKey = (fromMin: number, toMin: number | null) => `b${fromMin}_${toMin === null ? 'plus' : toMin}`

/** `h` is `null` while the function is not deployed. */
export function readFreeMinutes(h: FreeMinutesHistogram | null, month: string): FreeMinutesView {
  const none = { base: null, used: null, notUsed: null, notUsedShare: null, max: 0, rows: [] }
  if (!h || h.buckets.length === 0) return { state: 'no_source', ...none }
  const known = h.buckets.every((b) => b.people !== null)
  const used = known ? h.buckets.reduce((s, b) => s + (b.people as number), 0) : null
  const rows = h.buckets.map((b) => ({
    key: bucketKey(b.fromMin, b.toMin),
    fromMin: b.fromMin,
    toMin: b.toMin,
    people: b.people,
    share: b.people !== null && used !== null && used > 0 ? b.people / used : null,
    markAfter: (FREE_MINUTES_MARKS as readonly number[]).includes(b.toMin ?? -1) ? (b.toMin as FreeMinutesMark) : null,
  }))
  const max = Math.max(0, ...rows.map((r) => r.people ?? 0))
  const notUsedShare = h.notUsed !== null && h.base !== null && h.base > 0 ? h.notUsed / h.base : null
  const state: FreeMinutesState = month < LEDGER_FIRST_MONTH || used === null ? 'before_ledger' : used === 0 ? 'empty' : 'measured'
  return { state, base: h.base, used, notUsed: h.notUsed, notUsedShare, max, rows }
}
