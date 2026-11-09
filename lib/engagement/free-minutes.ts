/**
 * The free minutes histogram of the Engagement report (#1156, spec-cms-relatorio-engajamento-2026-11
 * §D4): `core.cms_get_free_minutes_histogram(p_month)` (contract banco-para-cms Parte 26 §3), read and
 * turned into rows here, in plain TS, so the screen only translates and lays out.
 *
 * Six buckets closed below and open above, the last without `to_min`; `base` is `entered` of the
 * funnel for the same month. DS-COMPONENTE-084 item 1: a bucket of 1 to 4 people, a base of 1 to 4 and
 * a month before the minute ledger come as `null`, and `null` stays "no data", never 0
 * (BR-COMUNICACAO-022 item 4). The share of a bucket is over `base`, the one base of the card; the
 * buckets may sum below it (deleted accounts have no readable ledger), so the share is conservative.
 *
 * The marks follow `to_min` of the data, not a fixed position: if the buckets change in the
 * database, a mark stays on its border or goes away.
 */

import { LEDGER_FIRST_MONTH } from '@/lib/conversion/funnel'

export interface FreeMinutesBucket {
  fromMin: number
  /** `null` on the last, open bucket. */
  toMin: number | null
  /** `null` = 1 to 4 people, or a month before the ledger. `0` is measured. */
  people: number | null
}

export interface FreeMinutesHistogram {
  /** YYYY-MM */
  month: string
  /** `null` = 1 to 4 people entered, or a month before the ledger. */
  base: number | null
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
    buckets: buckets.sort((a, b) => a.fromMin - b.fromMin),
  }
}

/**
 * What the card body is:
 * - `no_source`: the function is not deployed yet (PGRST202) or sent no bucket;
 * - `before_ledger`: the month ends before the minute ledger, nothing was measured;
 * - `small_base`: 1 to 4 people entered, the database does not open the distribution;
 * - `empty`: nobody entered, six buckets of 0;
 * - `measured`: the six rows with their shares.
 */
export type FreeMinutesState = 'no_source' | 'before_ledger' | 'small_base' | 'empty' | 'measured'

export interface FreeMinutesRow {
  /** The copy key of the range: `b0_15` ... `b180_plus`. */
  key: string
  fromMin: number
  toMin: number | null
  people: number | null
  /** `people / base`; `null` with a hidden bucket or no positive base. */
  share: number | null
  /** The mark drawn after this row, when its `to_min` is one of `FREE_MINUTES_MARKS`. */
  markAfter: FreeMinutesMark | null
}

export interface FreeMinutesView {
  state: FreeMinutesState
  base: number | null
  /** The widest measured bucket: the ruler of the bars. */
  max: number
  rows: FreeMinutesRow[]
}

export const bucketKey = (fromMin: number, toMin: number | null) => `b${fromMin}_${toMin === null ? 'plus' : toMin}`

/** `h` is `null` while the function is not deployed. */
export function readFreeMinutes(h: FreeMinutesHistogram | null, month: string): FreeMinutesView {
  if (!h || h.buckets.length === 0) return { state: 'no_source', base: null, max: 0, rows: [] }
  const base = h.base
  const rows = h.buckets.map((b) => ({
    key: bucketKey(b.fromMin, b.toMin),
    fromMin: b.fromMin,
    toMin: b.toMin,
    people: b.people,
    share: b.people !== null && base !== null && base > 0 ? b.people / base : null,
    markAfter: (FREE_MINUTES_MARKS as readonly number[]).includes(b.toMin ?? -1) ? (b.toMin as FreeMinutesMark) : null,
  }))
  const max = Math.max(0, ...rows.map((r) => r.people ?? 0))
  const state: FreeMinutesState = month < LEDGER_FIRST_MONTH ? 'before_ledger' : base === null ? 'small_base' : base === 0 ? 'empty' : 'measured'
  return { state, base, max, rows }
}
