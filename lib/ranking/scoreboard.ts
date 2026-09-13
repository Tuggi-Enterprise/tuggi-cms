/**
 * THE SCOREBOARD, AS DATA — one period, one ruler, no number born on the screen.
 *
 * Card #741 (phase 1 of epic #737). The two views are owned by `data` and described in
 * `docs/contracts/banco-para-cms.md`, **Parte 7**; the shape of the screen is
 * `docs/design/spec-placar-cms-2026-09.md`. This module is the part of the screen that can be
 * proved without a DOM: the row types, the period, the internal-account filter and the six
 * indicators.
 *
 * THE ERROR THIS MODULE EXISTS TO MAKE IMPOSSIBLE is the one the contract predicts by name:
 * aggregating without filtering `period_kind`, which adds a week to a rolling window and counts
 * the same visit several times. Rows reach a component only through `rowsForPeriod`, and every
 * aggregate takes the output of that function.
 *
 * NOTHING HERE RE-DERIVES A SCORE. `points_official` is `(triggers + minutes) × streak` and the
 * migration asserts that row by row; recomputing it here would be a second ruler for the same
 * fact (CLAUDE.md §6). What this module computes is what the SCREEN adds up — sums and counts
 * over rows of one period — never a point.
 */

import { UNKNOWN_VALUE } from '@/lib/format/unknown'

/** `week` is the game's cycle; the two rolling windows are calibration (contract, Parte 7). */
export type PeriodKind = 'week' | 'rolling_30d' | 'rolling_90d'

/** The default is the 30-day window: the screen exists to calibrate, and the current week is always half done (spec §2.1). */
export const DEFAULT_PERIOD_KIND: PeriodKind = 'rolling_30d'

export const PERIOD_KINDS: readonly PeriodKind[] = ['week', 'rolling_30d', 'rolling_90d']

/** One line per (account × period) — `core.ranking_scoreboard`, 26 columns. */
export interface RankingRow {
  period_kind: PeriodKind
  /** Inclusive, UTC. */
  period_start: string
  /** EXCLUSIVE, UTC. */
  period_end: string
  user_id: string
  /** Raw: there is no nickname moderation anywhere in the product (BR-USUARIO-046, #749). */
  nickname: string | null
  /** `null` when the account entered the period only by charge or by trail. */
  platform: string | null
  /** The #740 mark. "Does not count" is not "does not play". */
  excluded_from_metrics: boolean
  /** The scoreboard's ruler: distinct (session, POI) with `trigger_point_id IS NOT NULL`. */
  trigger_points_fired: number
  trigger_points_notable: number
  /** Boundary ∪ lost id. NOT boundary (contract fact 1, #750). */
  visits_indeterminate: number
  /** `poi_detail_screen`. Does not score, and measures the free tier only (contract fact 3). */
  visits_manual: number
  /** The ledger of BR-MONETIZACAO-049 — only exists from 2026-08-18 20:41 UTC. */
  charged_minutes: number
  story_days: number
  has_full_week_streak: boolean
  streak_multiplier: number
  points_from_triggers: number
  points_from_minutes: number
  points_official: number
  /** Position among ALL accounts. `null` at zero points. */
  rank_official: number | null
  /** Position ignoring marked accounts. `null` for a marked account and at zero points. */
  rank_excluding_internal: number | null
  /** Comparison, never the scoreboard: the weight is deferred (#737, decision 2). */
  points_notable_weighted: number
  rank_notable_weighted: number | null
  /** An INTERVAL between the first and last signal — not guide time, not charged time. */
  trail_span_minutes: number
  /** `trail_span_minutes − charged_minutes`. May be NEGATIVE. */
  metering_gap_minutes: number
  sessions_with_trail: number
  sessions_charged: number
}

/** One line per trip session — `core.ranking_session_metering`, 20 columns. */
export interface SessionMeteringRow {
  trip_session_id: string
  user_id: string
  nickname: string | null
  excluded_from_metrics: boolean
  platform: string | null
  session_start: string
  /** NOT final: the offline queue can still push it forward (BR-MONETIZACAO-049). */
  session_end: string | null
  was_interrupted: boolean
  /** Two authorships (client and `close_orphaned_sessions`); printed raw, never translated. */
  interruption_reason: string | null
  first_signal_at: string | null
  last_signal_at: string | null
  trail_points: number
  trail_span_minutes: number
  charged_minutes: number
  first_charge_at: string | null
  last_charge_at: string | null
  /** Guide ON, which BR-AUDIO-026 already separates from charged. */
  guide_active_minutes: number
  metering_gap_minutes: number
  trigger_points_fired: number
}

/** A period the view actually produced — the `<select>` is built from these, never from a calendar. */
export interface PeriodOption {
  kind: PeriodKind
  start: string
  end: string
}

/**
 * The period as it travels in the URL and as a `<select>` value.
 *
 * The operator has to be able to paste the address of the week he is checking (spec §2.1), and
 * the round trip has to be lossless — hence one string that carries both halves.
 */
export function periodKey(period: { kind: PeriodKind; start: string | null }): string {
  return period.kind === 'week' ? `week:${period.start ?? ''}` : period.kind
}

/**
 * `?period=rolling_30d` / `?period=week&start=2026-08-31` → the selection, or the default.
 *
 * A `week` with no `start` falls back to the default rather than to "the first week we find":
 * guessing which week the operator meant is the one answer that looks right and is not.
 */
export function parsePeriodParam(
  period: string | null | undefined,
  start: string | null | undefined
): { kind: PeriodKind; start: string | null } {
  if (period === 'week' && start) return { kind: 'week', start }
  if (period === 'rolling_90d') return { kind: 'rolling_90d', start: null }
  if (period === 'rolling_30d') return { kind: 'rolling_30d', start: null }
  return { kind: DEFAULT_PERIOD_KIND, start: null }
}

/**
 * The periods the view returned, in the order the `<select>` shows them (spec §2.1): the two
 * rolling windows first, then the 13 ISO weeks from the most recent backwards.
 *
 * There is NO aggregating option, and that is `DS-COMPONENTE-082` item 1 — summing periods
 * counts the same unit several times.
 */
export function periodOptions(rows: Pick<RankingRow, 'period_kind' | 'period_start' | 'period_end'>[]): PeriodOption[] {
  const seen = new Map<string, PeriodOption>()

  for (const row of rows) {
    const option: PeriodOption = {
      kind: row.period_kind,
      start: row.period_start,
      end: row.period_end,
    }
    const key = periodKey(option)
    if (!seen.has(key)) seen.set(key, option)
  }

  const all = Array.from(seen.values())
  const rolling = PERIOD_KINDS.filter((kind) => kind !== 'week')
    .map((kind) => all.find((option) => option.kind === kind))
    .filter((option): option is PeriodOption => option !== undefined)

  const weeks = all
    .filter((option) => option.kind === 'week')
    .sort((a, b) => b.start.localeCompare(a.start))

  return [...rolling, ...weeks]
}

/**
 * The rows of EXACTLY ONE period. Every aggregate on the screen starts here.
 *
 * The contract names this as the number-one suspect when the screen disagrees with the
 * reference measurement, so the filter is a function rather than an inline `.filter()` that
 * somebody can forget to repeat in the footer.
 */
export function rowsForPeriod(
  rows: RankingRow[],
  period: { kind: PeriodKind; start: string | null }
): RankingRow[] {
  return rows.filter((row) => matchesPeriod(row.period_kind, row.period_start, period))
}

/**
 * Does this (kind, start) pair answer the selection?
 *
 * The start is compared as an INSTANT and not as a string. The URL is meant to be pasted by the
 * operator, and `?start=2026-08-31` is the same Monday as the `2026-08-31T00:00:00+00:00` the
 * view returned — a string comparison would answer "nobody scored" to a question that has an
 * answer, which is the one failure mode this screen must not have.
 */
export function matchesPeriod(
  kind: PeriodKind,
  start: string,
  period: { kind: PeriodKind; start: string | null }
): boolean {
  if (kind !== period.kind) return false
  if (period.kind !== 'week' || period.start === null) return true

  const left = new Date(start).getTime()
  const right = new Date(period.start).getTime()
  return Number.isFinite(left) && left === right
}

/**
 * What the table renders — and the default is FILTERED.
 *
 * With the switch off, an account carrying the #740 mark does not render at all. The reason is
 * in the contract and it is not cosmetic: without it, the first thing the operator sees is
 * himself in first place with 22,1% of the points.
 *
 * The mark means "does not enter the aggregates", never "does not play" — the marked account
 * keeps `points_official` and `rank_official`, and the switch brings its row back.
 */
export function visibleRows<T extends { excluded_from_metrics: boolean }>(
  rows: T[],
  includeInternal: boolean
): T[] {
  return includeInternal ? rows : rows.filter((row) => !row.excluded_from_metrics)
}

/**
 * The population every average, ratio and concentration diagnosis is computed over — contract,
 * Parte 7, third comparison column.
 *
 * It does NOT follow the switch. The switch decides which rows the operator can look at; the
 * indicators answer "how is the design of the scoring behaving", and one internal account
 * holding a fifth of the points would be the loudest voice in every one of them. It also never
 * filters by e-mail, domain or a list of `user_id` (#740: *"filtrar IDs é um erro"*).
 */
export function aggregateRows<T extends { excluded_from_metrics: boolean }>(rows: T[]): T[] {
  return rows.filter((row) => !row.excluded_from_metrics)
}

export interface RankingSummary {
  /** Accounts with `points_official > 0`, over the aggregate population. */
  accountsScored: number
  /** Platform split of the accounts that scored, for the subtitle `9 iOS · 4 Android`. */
  byPlatform: { platform: string; accounts: number }[]
  pointsFromTriggers: number
  pointsFromMinutes: number
  /** Triggers ÷ minutes, both in POINTS — same ruler. `null` when the denominator is zero. */
  triggerToMinuteRatio: number | null
  streakAccounts: number
  maxStoryDays: number
  /** `charged_minutes > 0 AND trigger_points_fired = 0` — the #743 population, seen from revenue. */
  chargedWithoutTrigger: number
  manualListens: number
  visitsIndeterminate: number
  chargedMinutes: number
  trailSpanMinutes: number
  meteringGapMinutes: number
  triggerPointsFired: number
  rowCount: number
}

/**
 * The six indicators of spec §3, plus the sums the sticky footer prints.
 *
 * NO PERCENTAGE OF VISITS COMES OUT OF HERE, and that is `DS-COMPONENTE-084` item 2, not an
 * omission: `trigger_points_fired` is deduplicated by (session, POI) and the other two visit
 * counts declare no such dedup, so dividing them would be an assertion nobody made. The ratio
 * that IS printed — triggers ÷ minutes — has points on both sides, which is one ruler.
 */
export function summarize(rows: RankingRow[]): RankingSummary {
  const scored = rows.filter((row) => row.points_official > 0)

  const platforms = new Map<string, number>()
  for (const row of scored) {
    if (!row.platform) continue
    platforms.set(row.platform, (platforms.get(row.platform) ?? 0) + 1)
  }

  const pointsFromTriggers = sum(rows, (row) => row.points_from_triggers)
  const pointsFromMinutes = sum(rows, (row) => row.points_from_minutes)

  return {
    accountsScored: scored.length,
    byPlatform: Array.from(platforms.entries())
      .map(([platform, accounts]) => ({ platform, accounts }))
      .sort((a, b) => b.accounts - a.accounts || a.platform.localeCompare(b.platform)),
    pointsFromTriggers,
    pointsFromMinutes,
    triggerToMinuteRatio: pointsFromMinutes > 0 ? pointsFromTriggers / pointsFromMinutes : null,
    streakAccounts: rows.filter((row) => row.has_full_week_streak).length,
    maxStoryDays: rows.reduce((max, row) => Math.max(max, row.story_days), 0),
    chargedWithoutTrigger: rows.filter(
      (row) => row.charged_minutes > 0 && row.trigger_points_fired === 0
    ).length,
    manualListens: sum(rows, (row) => row.visits_manual),
    visitsIndeterminate: sum(rows, (row) => row.visits_indeterminate),
    chargedMinutes: sum(rows, (row) => row.charged_minutes),
    trailSpanMinutes: sum(rows, (row) => row.trail_span_minutes),
    meteringGapMinutes: sum(rows, (row) => row.metering_gap_minutes),
    triggerPointsFired: sum(rows, (row) => row.trigger_points_fired),
    rowCount: rows.length,
  }
}

function sum<T>(rows: T[], pick: (row: T) => number | null | undefined): number {
  return rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0)
}

/**
 * What the `Δ posição` cell says — `DS-COMPONENTE-083` items 1 and 2.
 *
 * The BASELINE IS `rank_official`, never the `#` column. `rank_notable_weighted` is computed
 * over all accounts, so subtracting it from a position that excludes internal accounts would
 * compare two populations — a subtraction with no meaning.
 *
 * A smaller rank number is a better position, so `rank_official − rank_notable_weighted` is
 * positive when the notable weight moved the account UP.
 */
export function rankDelta(row: Pick<RankingRow, 'rank_official' | 'rank_notable_weighted'>): number | null {
  if (row.rank_official == null || row.rank_notable_weighted == null) return null
  return row.rank_official - row.rank_notable_weighted
}

/**
 * Sorting that puts absence last IN BOTH DIRECTIONS.
 *
 * `null` is "I do not know", not "less than everything": letting it sort as zero would fill the
 * top with `—` when the operator asked for the largest difference, which is the wrong answer to
 * the question he asked.
 */
export function compareNullable(left: number | null, right: number | null, dir: 1 | -1): number {
  if (left == null && right == null) return 0
  if (left == null) return 1
  if (right == null) return -1
  return (left - right) * dir
}

/**
 * A number as the operator reads it: `45`, `7`, `0,69` — never the view's 4 decimals.
 *
 * Precision nobody uses reads as precision somebody needs. `formatCount` of
 * `lib/finance/money.ts` is deliberately NOT reused: it pins `pt-BR` and abbreviates thousands,
 * and here there is neither a thousand nor a fixed locale (spec §6.3).
 */
export function formatPoints(value: number | null | undefined, locale: string): string {
  if (value == null || !Number.isFinite(value)) return UNKNOWN_VALUE
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
}

/** The ratio of indicator 2, `11,6 : 1`. A zero denominator is UNKNOWN — never `∞`, `0` or `100 %`. */
export function formatRatio(ratio: number | null, locale: string): string {
  if (ratio == null || !Number.isFinite(ratio)) return UNKNOWN_VALUE
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(ratio)} : 1`
}

/**
 * The two dates a week label prints, and the second one is NOT `period_end`.
 *
 * `period_end` is exclusive (contract, Parte 7): the week of 31/08 ends at 07/09 00:00 UTC, and
 * a label reading `31/08 – 07/09` would claim a day the period does not contain.
 */
export function periodBounds(period: Pick<PeriodOption, 'start' | 'end'>): {
  start: Date
  endInclusive: Date
} {
  const end = new Date(period.end)
  return { start: new Date(period.start), endInclusive: new Date(end.getTime() - 86_400_000) }
}

/** The period that contains `now` — the current week is the only one that is still half done. */
export function isCurrentPeriod(period: Pick<PeriodOption, 'start' | 'end'>, now = Date.now()): boolean {
  return new Date(period.start).getTime() <= now && now < new Date(period.end).getTime()
}

/**
 * How many accounts carry the #740 mark in everything the view returned.
 *
 * It is counted over the WHOLE view and not over the selected period on purpose: the question
 * the number answers is "is the filter removing anybody at all", and a marked account that was
 * quiet last week would make the answer flicker with the period.
 */
export function countInternalAccounts(rows: Pick<RankingRow, 'user_id' | 'excluded_from_metrics'>[]): number {
  const marked = new Set<string>()
  for (const row of rows) if (row.excluded_from_metrics) marked.add(row.user_id)
  return marked.size
}
