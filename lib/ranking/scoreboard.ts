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
 * NOTHING HERE RE-DERIVES A SCORE. `points_official` is `(triggers + km × 0,11) × streak` since
 * `20260916130000` (**BR-RANKING-004**), and the migration asserts that row by row; recomputing
 * it here would be a second ruler for the same fact (CLAUDE.md §6). What this module computes is
 * what the SCREEN adds up — sums and counts over rows of one period — never a point.
 *
 * THE MINUTE AXIS LEFT THE SCORE AND THE MEASURE STAYED, and they are two different things:
 * `points_from_minutes` is `0` constant, while `charged_minutes` did not move a digit. The axis
 * left because a charged minute measures the MODE OF BILLING and not behaviour — the balance is
 * inert during `unlimited` (BR-MONETIZACAO-051), so five of the six subscribers of the base have
 * no consumption row at all and the old formula punished whoever subscribes (BR-RANKING-004
 * item 2). The measure stayed because it is still the calibration instrument of
 * BR-MONETIZACAO-049. Summing `points_from_triggers + points_from_minutes` to check a total is
 * the error this file is now shaped to make impossible: the parcel is `points_from_km`.
 */

import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { kmCoverage } from '@/lib/ranking/metering'
/**
 * TYPE-ONLY, and it is the seal's own vocabulary — the drawing owns what `1 | 2 | 3` and
 * `week | month | year` mean (spec §7, "API do componente"). Redeclaring the two unions here
 * would be a second owner of the seal's API, and the import is erased at build (CLAUDE.md §6).
 */
import type { SealCycle, SealPosition } from '@/components/ui/RankSeal'

/**
 * FIVE WINDOWS, TWO NATURES — and the nature is the half a flat control erases.
 *
 * `week`, `month` and `year` are CYCLES of the product: they have a roster, a floor and a podium
 * (**BR-RANKING-001**, **BR-RANKING-003**, **BR-RANKING-005**). `rolling_30d` and `rolling_90d`
 * never were competition — they exist to check a number (**BR-RANKING-001** item 5) — and putting
 * the five side by side in one flat `<select>` says by omission that they are the same species of
 * thing, which is the one thing the operator must not get wrong (`DS-COMPONENTE-089` item 1).
 */
export type PeriodKind = 'week' | 'month' | 'year' | 'rolling_30d' | 'rolling_90d'

/**
 * The default is the 30-day window, and it did NOT move when the two cycles arrived (spec §2.3):
 * the screen exists to calibrate, the current week is always half done, and changing the default
 * now is churn with no gain.
 */
export const DEFAULT_PERIOD_KIND: PeriodKind = 'rolling_30d'

/** In the order the `<select>` shows them: the clock's order inside competition, then calibration. */
export const PERIOD_KINDS: readonly PeriodKind[] = [
  'week',
  'month',
  'year',
  'rolling_30d',
  'rolling_90d',
]

/** Which of the two groups of the `<select>` a window belongs to. */
export type PeriodNature = 'competition' | 'calibration'

/**
 * THE NATURE OF A WINDOW, WITH ONE OWNER — `DS-COMPONENTE-089` items 1 and 2.
 *
 * The `<select>`'s `<optgroup>`, the stamp printed next to the numbers and the `<caption>` all
 * read from here. An `if (kind === 'rolling_30d' || kind === 'rolling_90d')` written a second
 * time inside a component is divergence entering by duplication (CLAUDE.md §6) — and it is the
 * shape of condition that silently keeps answering `competition` when a sixth window is added.
 */
export function periodNature(kind: PeriodKind): PeriodNature {
  return kind === 'rolling_30d' || kind === 'rolling_90d' ? 'calibration' : 'competition'
}

/**
 * Windows whose boundary is a DATE the operator can paste, as opposed to "now minus N days".
 *
 * It is what decides whether the URL and the `<select>` value carry a `start`, and it exists as a
 * predicate rather than as `kind !== 'rolling_30d' && kind !== 'rolling_90d'` typed at the four
 * call sites that need it — the same reason `periodNature` does.
 */
export function hasAnchoredStart(kind: PeriodKind): boolean {
  return kind === 'week' || kind === 'month' || kind === 'year'
}

/**
 * CYCLES THAT COMPOSE THE CYCLE BELOW THEM — **BR-RANKING-005**.
 *
 * In `month` and `year`, `points_official` is not the formula of **BR-RANKING-004** applied to
 * the period: it is the SUM of the points of the weeks (or months) the account finished on the
 * podium of. Every consequence the screen carries hangs on this predicate — the four columns it
 * renders (spec §4.8), the `<caption>` that declares the new quantity, and the cards that stop
 * rendering because they would divide two populations.
 */
export function isComposedCycle(kind: PeriodKind): boolean {
  return kind === 'month' || kind === 'year'
}

/**
 * One line per (account × period) — `core.ranking_scoreboard`, **31 columns** since
 * `20260916140000` (`docs/contracts/banco-para-cms.md`, Parte 7).
 *
 * This type carries the 30 the screen reads. The one left out is `in_roster` (column 28,
 * `20260916120000`): what the roster changed for this screen is that a closed week now ranks
 * every row it serves, zeros tied at the end, and the answer to THAT is the podium floor below
 * (`PODIUM_POINTS_FLOOR`, BR-RANKING-003) — not a column. Naming it here would add a field
 * nobody reads.
 */
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
  /**
   * **`0` CONSTANT since `20260916130000`** — the minute axis is out of the score
   * (BR-RANKING-004 item 2). The column survives only so the CMS published before that deploy
   * keeps reading (contract, Parte 7), and its removal is a card of its own.
   *
   * **Do not add it to anything.** `points_from_triggers + points_from_minutes` stopped being a
   * total the day the formula changed; the parcel that closes it is `points_from_km`.
   */
  points_from_minutes: number
  /** `(points_from_triggers + points_from_km) × streak_multiplier`, 4 decimals, asserted row by row by the migration. */
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
  /**
   * Column 27 — ISO 3166-1 alpha-2, UPPERCASE, or `null`. NEVER a country name: the migration
   * `20260913150000` asserts `^[A-Z]{2}$` on its own output and refuses to apply otherwise
   * (contract `banco-para-cms.md`, Parte 7).
   *
   * **`null` means "does not resolve", not "explored nothing".** Same ruler as `platform`
   * (`mode() WITHIN GROUP` over the period's visits), so the rows that carry one carry the
   * other — 317 of 582 measured; the other 265 entered the period only by charge or by trail
   * and have no visit to take a country from. `mode()` ignores nulls, so an account with one
   * resolvable visit among nine unresolvable ones still gets a code.
   */
  top_country_code: string | null
  /**
   * COLUMN 29 — **NOT "KILOMETRES DRIVEN", and no label on this screen may say it is.**
   *
   * It is the kilometre driven **with the guide on AND with entitlement to turn it on**, with
   * GPS noise filtered out (BR-RANKING-004 items 4, 6 and 7). The distance between that and a
   * trip's distance is not marginal and was measured: **17,2% of the kilometres driven with the
   * guide on in the four weeks before 2026-09-16 were driven with no entitlement** and are not
   * here, and 34,6% of the raw kilometre is GPS artefact that the view discards. Calling the
   * column `Km rodados` would promise the operator a quantity it does not measure, on the screen
   * where he decides a prize.
   *
   * **`sessions_with_trail = 0` does not mean "did not move".** `route_trail.server_received_at`
   * is 100% null in 37,5% of the sessions, and 23 (account, period) pairs carry
   * `km_with_entitlement > 0` with `sessions_with_trail = 0` (contract, Parte 7).
   */
  km_with_entitlement: number
  /**
   * COLUMN 30 — `km_with_entitlement × 0,11`, 4 decimals. The coefficient lives in
   * BR-RANKING-004 item 3 and is worth 24,6% of the scoreboard; the screen SUMS this column and
   * never multiplies anything by 0,11.
   */
  points_from_km: number
  /**
   * COLUMN 31 — **HOW MANY PODIUM COMPONENTS THE ROW'S `points_official` CAME FROM**, and the
   * screen NEVER derives it (`20260916140000`, **BR-RANKING-005**).
   *
   * In `month` it is how many WEEKS of podium the sum consumed; in `year`, how many MONTHS — a
   * different unit under the same column, which is why the header is a different key in each
   * cycle (`table.podium_weeks` / `table.podium_months`).
   *
   * **`null` in `week`, `rolling_30d` and `rolling_90d`, never `0`.** In those three there is no
   * composition at all: `points_official` is **BR-RANKING-004** applied to the period itself. A
   * `0` would be a MEASURED number and would read as "no podium", which is false — an account
   * with no podium week in the month does not come out with `month` zeroed, it has no `month` row
   * (contract, Parte 7). `null` is the "does not apply" the view already spells in `platform` and
   * in `rank_official`, and the screen prints it as `UNKNOWN_VALUE`.
   *
   * Deriving it in the browser would cost a SECOND read of a ~2,8 s view and a second podium
   * ruler on the client, which is the SSOT defect this screen exists not to have (spec §10 item
   * 2, CLAUDE.md §6).
   */
  podium_components: number | null
}

/**
 * THE VIEW'S ROW AS IT COMES OFF THE WIRE — where `user_id` can be NULL.
 *
 * `core.ranking_scoreboard` emits ONE ROW PER PERIOD with `user_id` null, `nickname` null and
 * every quantity at zero: `drive.poi_visits` and `drive.time_credit_consumption` carry rows whose
 * `user_id` is nullable and null, they enter the view's key, and the `LEFT JOIN … USING (user_id)`
 * never match — `NULL = NULL` is unknown, not true. The row ALWAYS existed; what changed with
 * `20260916120000` (BR-RANKING-001) is that in `period_kind = 'week'` it now receives
 * `rank_official`, tied at the end, so it reaches the screen with a position and no nickname.
 *
 * Fixing it belongs to the WRITER of those two tables and is a card of its own: removing the row
 * in the database would change the count of the rolling windows, which #741 requires not to move.
 *
 * `RankingRow` is therefore what the SCREEN sees — an account — and this type is what the read
 * brings. `accountRows` is the only crossing between the two.
 */
export type ScoreboardReadRow = Omit<RankingRow, 'user_id'> & { user_id: string | null }

/**
 * The rows that belong to an ACCOUNT — `docs/contracts/banco-para-cms.md`, Parte 7, "A linha
 * fantasma de `user_id` nulo": *"A tela filtra `user_id IS NOT NULL`; não é opcional, porque a
 * linha não tem apelido para mostrar."*
 *
 * It is a function and not three inline `.filter()` calls because the ghost row has to disappear
 * from EVERY output of the read at once — the table, the count of marked accounts and the list of
 * periods (CLAUDE.md §6). A period whose only row is the ghost is a period with nobody in it, and
 * an option in the `<select>` leading to an empty table would be the screen inventing a period.
 *
 * The ruler is `user_id` alone. The ghost also carries `in_roster = false`, but the migration
 * asserts that a roster row ALWAYS has an account, so the second half would narrow nothing and
 * would be a second ruler for the same fact.
 */
export function accountRows(rows: ScoreboardReadRow[]): RankingRow[] {
  return rows.filter((row): row is RankingRow => row.user_id != null)
}

/** One line per trip session — `core.ranking_session_metering`, 19 columns (contract, Parte 7). */
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
 * THE SELECTION — what the operator asked for, which is not the same thing as what the reading
 * brought back.
 *
 * A `week` carries its `start`; the two rolling windows carry `null`, because their boundary is
 * "now minus N days" and nobody pastes it. Everything the screen prints about the SELECTED period
 * comes out of this shape, and never out of `periods`: the reading takes a round trip to arrive
 * and the label has to exist before it does (#741).
 */
export interface PeriodSelection {
  kind: PeriodKind
  start: string | null
}

/**
 * The period as it travels in the URL and as a `<select>` value.
 *
 * The operator has to be able to paste the address of the week he is checking (spec §2.1), and
 * the round trip has to be lossless — hence one string that carries both halves.
 */
export function periodKey(period: PeriodSelection): string {
  return hasAnchoredStart(period.kind) ? `${period.kind}:${period.start ?? ''}` : period.kind
}

/**
 * `?period=rolling_30d` / `?period=week&start=2026-08-31` / `?period=month&start=2026-09-01` /
 * `?period=year&start=2026-01-01` → the selection, or the default.
 *
 * An anchored window with no `start` falls back to the default rather than to "the first one we
 * find": guessing which week the operator meant is the one answer that looks right and is not. A
 * `start` that is not a readable instant is the same case — `?start=terça` names no week, and
 * letting it through produced a selection that matched nothing and printed a label with no dates
 * in it.
 *
 * The three anchored kinds share one branch on purpose (spec §2.3): the parameter used to be
 * three literals, and adding `month` and `year` as two more copies of the same three lines is how
 * the fourth one ends up missing the date check.
 */
export function parsePeriodParam(
  period: string | null | undefined,
  start: string | null | undefined
): PeriodSelection {
  const kind = PERIOD_KINDS.find((candidate) => candidate === period)
  if (kind === undefined) return { kind: DEFAULT_PERIOD_KIND, start: null }

  if (hasAnchoredStart(kind)) {
    return start && Number.isFinite(new Date(start).getTime())
      ? { kind, start }
      : { kind: DEFAULT_PERIOD_KIND, start: null }
  }

  return { kind, start: null }
}

/**
 * The INVERSE of `periodKey` — the only way back from a key to a selection.
 *
 * The key carries an ISO instant, and an ISO instant has colons of its own:
 * `week:2026-08-17T00:00:00+00:00` splits into FIVE pieces, not two. The `<select>` used to take
 * the first two, kept `2026-08-17T00` as the start — which is not a readable instant — and every
 * week the operator picked silently became the default window (#741). So cutting the key is not
 * something a call site gets to improvise: it is cut here, at the first colon only, and the
 * format has one owner (CLAUDE.md §6).
 *
 * What is a valid selection is NOT decided a second time here: the halves go to
 * `parsePeriodParam`, so a key with an unknown kind, a `week` with no start and a `week` whose
 * start is illegible all fall back to the default by the same ruler the URL already uses.
 *
 * `parsePeriodKey(periodKey(period))` returns `period` for every selection `periodKey` can
 * produce.
 */
export function parsePeriodKey(key: string): PeriodSelection {
  const cut = key.indexOf(':')
  const kind = cut === -1 ? key : key.slice(0, cut)
  const start = cut === -1 ? null : key.slice(cut + 1)
  return parsePeriodParam(kind, start)
}

/**
 * The periods the view returned, in the order the `<select>` shows them (spec §2.3): COMPETITION
 * FIRST — the weeks newest first, then the months, then the years — and calibration last.
 *
 * **The order changed on 2026-09-16 and it is a decision, not a tidy-up** (`DS-COMPONENTE-089`
 * item 1). Until then the two rolling windows led the list, which was harmless while they were
 * the only alternative to a week; with `Setembro de 2026` in the same list, a flat control whose
 * first entry is `Últimos 30 dias` teaches the operator to read a rolling window as "the month".
 * The grouping is `<optgroup>`, which is the HTML mechanism for exactly this and the one a screen
 * reader announces together with the option — no component is born for it.
 *
 * There is still NO aggregating option, and that is `DS-COMPONENTE-082` item 1 — summing periods
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

  // `PERIOD_KINDS` is the order, so the list cannot disagree with the type: a sixth kind lands
  // where its owner put it and nowhere else.
  return PERIOD_KINDS.flatMap((kind) =>
    all
      .filter((option) => option.kind === kind)
      .sort((a, b) => b.start.localeCompare(a.start))
  )
}

/** The options of one nature, in order — the two `<optgroup>`s of spec §2.3, built from one list. */
export function periodGroups(
  options: PeriodOption[]
): { nature: PeriodNature; options: PeriodOption[] }[] {
  const natures: PeriodNature[] = ['competition', 'calibration']
  return natures
    .map((nature) => ({
      nature,
      options: options.filter((option) => periodNature(option.kind) === nature),
    }))
    .filter((group) => group.options.length > 0)
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
  period: PeriodSelection
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
  period: PeriodSelection
): boolean {
  if (kind !== period.kind) return false
  if (!hasAnchoredStart(period.kind) || period.start === null) return true

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
  /**
   * Accounts that scored carrying NO platform — the third term of that subtitle.
   *
   * `platform` is `null` when the account entered the period only by charge (contract, Parte 7),
   * so `byPlatform` counts fewer accounts than `accountsScored` and the split read as a sum that
   * does not close: `33 android · 31 ios` under a card saying `82`. The three numbers were always
   * right; what was missing was the term that makes them add up (#741).
   */
  platformUnknown: number
  pointsFromTriggers: number
  /**
   * THE OTHER AXIS OF THE SCORE, IN POINTS — the sum of `points_from_km`, which is what replaced
   * `pointsFromMinutes` here (BR-RANKING-004). It is a sum of a column the view computed: the
   * screen never multiplies kilometres by the coefficient.
   */
  pointsFromKm: number
  /**
   * THE SCOREBOARD, SUMMED — the column the footer exists to total.
   *
   * It is a sum of a number the view computed, never a re-derivation of it: `points_official` is
   * `(triggers + minutes) × streak` and the migration asserts that row by row (CLAUDE.md §6).
   * Without this the footer left the two point columns EMPTY between five bold totals, and an
   * empty cell under the column carrying the ink reads as zero on a screen that spells absence
   * `—` everywhere else (#741).
   */
  pointsOfficial: number
  /** The same total for the comparison, so the question *does the weight 2 change it?* has an answer. */
  pointsNotableWeighted: number
  /**
   * Triggers ÷ kilometres, **both in POINTS** — one ruler, and the two parcels that make up
   * `points_official`. `null` when the denominator is zero: a period where nobody drove with
   * entitlement divides by nothing, and `∞` is not a reading (`DS-COMPONENTE-084` item 2).
   */
  triggerToKmRatio: number | null
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
  let platformUnknown = 0
  for (const row of scored) {
    if (!row.platform) {
      platformUnknown += 1
      continue
    }
    platforms.set(row.platform, (platforms.get(row.platform) ?? 0) + 1)
  }

  const pointsFromTriggers = sum(rows, (row) => row.points_from_triggers)
  const pointsFromKm = sum(rows, (row) => row.points_from_km)

  return {
    accountsScored: scored.length,
    byPlatform: Array.from(platforms.entries())
      .map(([platform, accounts]) => ({ platform, accounts }))
      .sort((a, b) => b.accounts - a.accounts || a.platform.localeCompare(b.platform)),
    platformUnknown,
    pointsFromTriggers,
    pointsFromKm,
    pointsOfficial: sum(rows, (row) => row.points_official),
    pointsNotableWeighted: sum(rows, (row) => row.points_notable_weighted),
    triggerToKmRatio: pointsFromKm > 0 ? pointsFromTriggers / pointsFromKm : null,
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

/**
 * The entitled kilometre as the operator reads it — `39 km`, `1.204,5 km`.
 *
 * The unit comes from `Intl`, so it is the locale's own and not a string glued to a number; the
 * view carries three decimals (metre resolution) and the screen shows one, because nobody
 * calibrates a coefficient on a metre. The QUANTITY it prints is the one column 29 measures —
 * guide on and entitled — and what it is not is said where the column is read, never here.
 */
export function formatKilometres(value: number | null | undefined, locale: string): string {
  if (value == null || !Number.isFinite(value)) return UNKNOWN_VALUE
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'kilometer',
    maximumFractionDigits: 1,
  }).format(value)
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
  return { start: new Date(period.start), endInclusive: new Date(end.getTime() - DAY_MS) }
}

const DAY_MS = 86_400_000

/**
 * The ISO week is SEVEN days, Monday 00:00 UTC to Monday 00:00 UTC — contract, Parte 7. It is a
 * definition and not a tunable, which is what makes `end` a consequence of `start` rather than a
 * second fact that could disagree with the view.
 */
const WEEK_MS = 7 * DAY_MS

/**
 * The selected week as a full period — derived from the SELECTION, never from the reading.
 *
 * This is what #741 broke: the label of the selected period was looked up in `periods`, which is
 * empty until the read lands, so reloading on a week rendered `period.week` — a key with two
 * parameters — with none of them. The week the operator asked for is entirely described by its
 * `start`, so nothing about labelling it has to wait for a round trip.
 *
 * `null` for the two rolling windows (they have no boundary to print) and for a selection whose
 * `start` is not a readable instant, which `parsePeriodParam` already refuses to produce.
 */
export function weekOfSelection(selection: PeriodSelection): PeriodOption | null {
  return selection.kind === 'week' ? periodOfSelection(selection) : null
}

/**
 * ANY ANCHORED WINDOW AS A FULL PERIOD, derived from the SELECTION — the generalisation of
 * `weekOfSelection` the two composed cycles needed (spec §2.3).
 *
 * The end is a CONSEQUENCE of the start and of the calendar, never a second fact that could
 * disagree with the view: a week is seven days, a month ends on the 1st of the next month at
 * midnight UTC, a year on the 1st of January. All three boundaries are `[start, end)` in UTC by
 * decision (**BR-RANKING-005** item 1), which is what makes them derivable at all.
 *
 * It is used for the LABEL, for `(corrente)` and for the instrument coverage — never to decide
 * which rows belong to the period, which is the route's filter over what the view served. `null`
 * for the two rolling windows (their boundary is "now minus N days" and only the view knows it)
 * and for a start that is not a readable instant, which `parsePeriodParam` already refuses.
 */
export function periodOfSelection(selection: PeriodSelection): PeriodOption | null {
  if (!hasAnchoredStart(selection.kind) || !selection.start) return null

  const start = new Date(selection.start)
  if (!Number.isFinite(start.getTime())) return null

  const end =
    selection.kind === 'week'
      ? new Date(start.getTime() + WEEK_MS)
      : selection.kind === 'month'
        ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
        : new Date(Date.UTC(start.getUTCFullYear() + 1, 0, 1))

  return { kind: selection.kind, start: selection.start, end: end.toISOString() }
}

/** The period that contains `now` — the current week is the only one that is still half done. */
export function isCurrentPeriod(period: Pick<PeriodOption, 'start' | 'end'>, now = Date.now()): boolean {
  return new Date(period.start).getTime() <= now && now < new Date(period.end).getTime()
}

/**
 * MAY THIS PERIOD WEAR A SEAL AT ALL? — `DS-COMPONENTE-088`, spec §5.1.
 *
 * Two refusals, and each one exists because of a way the screen could lie:
 *
 * 1. **The cycle has to have CLOSED.** `period_end` is exclusive (contract, Parte 7), so
 *    `period_end <= now` is exactly "the week is over". The roster is a minimum of ten from
 *    Monday on (`BR-RANKING-001`), which means a podium exists at 8 a.m. on Monday with 0,3
 *    point — a gold seal there stops meaning anything by Tuesday.
 * 2. **A rolling window is not a cycle.** `rolling_30d` is calibration, not competition
 *    (`BR-RANKING-001` item 5), and it is NOT the monthly cycle. A monthly seal drawn over
 *    `rolling_30d` would assert a cycle the product does not have.
 * 3. **`month` AND `year` EXIST NOW, AND THEY STILL DRAW NOTHING — that is a decision, not an
 *    omission** (spec §4.8, `DS-COMPONENTE-089` item 4). `RankSeal` already knows how to draw the
 *    three cycles (`SealCycle` is the number of apertures of the ring), and the two composed
 *    cycles have a real `rank_official` since `20260916140000`. What they do not have is a RULE:
 *    the seal asserts a PODIUM, a podium has a floor, and the only floor written down is the
 *    weekly one — **BR-RANKING-003** names itself *"o prêmio do ciclo semanal"*. Drawing gold on
 *    a month would be the screen asserting a prize band no rule defined, on a product that emits
 *    no prize at all (**BR-RANKING-006**). The `#` column keeps printing the ordinal in all five
 *    periods, because the ordinal is the view's datum; when the `produto` writes the monthly
 *    podium this function is one line, and the drawing is already there.
 *
 * `week` is therefore the only cycle this screen can produce today, and the return type says so
 * rather than leaving the caller to guess.
 */
export function sealCycle(
  period: Pick<PeriodOption, 'kind' | 'end'> | null,
  now = Date.now()
): Extract<SealCycle, 'week'> | null {
  if (period === null || period.kind !== 'week') return null

  const end = new Date(period.end).getTime()
  if (!Number.isFinite(end)) return null

  return end <= now ? 'week' : null
}

/**
 * THE POINT FLOOR OF THE PODIUM — `BR-RANKING-003` item 6, and the only DECLARATION of that
 * number in this repository: everything that asks about the podium reads it from here.
 *
 * It is a number of the business and not a comparison: the operator fixed it on 2026-09-16 over
 * the measured distribution of a closed week (median of 7 points), so that the floor separates
 * who played from who drove past a POI. Code cites the ID and reads the number from here
 * (CLAUDE.md §6) — a second `10` typed into a cell or into a test goes green while the rule
 * moves.
 *
 * **IT IS NOT THE "SCORED" PREDICATE, AND THE TWO MUST NOT MERGE.** `summarize` and the `scored`
 * chip answer "did this account score at all" with `points_official > 0`, over the whole
 * population; this one answers "is this line a podium", and only the seal asks it.
 *
 * The comparison is `>=` on the OFFICIAL, UNROUNDED score — the same number that orders the
 * board. The score carries a decimal (a charged minute is worth 0,03 point), so a row at 9,97
 * is below the floor and a row at exactly 10 is on it.
 */
export const PODIUM_POINTS_FLOOR = 10

/**
 * THE SEAL OF ONE ROW, or `null` — the single answer to "does this cell draw a seal".
 *
 * It is one function and not a condition spelled out in the cell because the two halves are only
 * correct together: a podium without a closed cycle is `DS-COMPONENTE-088`, and a closed cycle
 * without a podium is the 4th place that must keep printing its number (spec §4.3).
 *
 * **The seal never computes a position.** `rank` arrives from the view, and the switch upstream
 * decides whether it is `rank_official` or `rank_excluding_internal` — the same ruler the `#`
 * column already prints (`DS-COMPONENTE-082` item 3). A tie is the server's business: two `1`s
 * produce two gold seals and no silver, which is a valid result (spec §5.4). **The count of seals
 * on the screen is never the criterion** — only the three conditions below are.
 *
 * THE THIRD CONDITION — THE PODIUM HAS A FLOOR, AND IT IS `PODIUM_POINTS_FLOOR` (#756).
 * Since `20260916120000` the week ranks the WHOLE roster, the zeros tied at the end, so
 * `rank_official` stopped meaning "won anything" (`BR-RANKING-001`; contract
 * `banco-para-cms.md`, Parte 7, columns 19 and 20). With the minimum roster of ten and a `free`
 * tier that does not score (`BR-MONETIZACAO-055`), fewer than three scoring accounts is enough
 * for the mass tie of zeros to occupy positions 1 to 3: measured on the CT bench, a closed week
 * where nobody scored drew TEN gold seals. The floor is read from the row and never re-derived —
 * the migration owns the score (CLAUDE.md §6).
 *
 * **THE FLOOR IS PER LINE, NEVER A COUNT OF SEALS.** "Each position from 1 to 3 WHOSE OWNER
 * reached the floor", not "the three best with points": one account above the floor draws one
 * gold, and the 2nd and 3rd — who exist, and print their numbers — draw nothing. A week where
 * nobody reaches it draws no seal at all, which is the open podium `BR-RANKING-003` covers by
 * name.
 *
 * `null` rank gets no seal, and the cell keeps printing `UNKNOWN_VALUE`: "does not rank" is not
 * "ranks worst" (`DS-COMPONENTE-084` item 1). **A score under the floor is the other case and
 * prints the NUMBER**, because the position exists — what does not exist is the podium (spec §9
 * item 8bis).
 * The cell needs no branch of its own for that: it already prints `rank` whenever there is no
 * seal.
 */
export function rankSeal(
  rank: number | null,
  row: Pick<RankingRow, 'points_official'>,
  period: Pick<PeriodOption, 'kind' | 'end'> | null,
  now = Date.now()
): { position: SealPosition; cycle: SealCycle } | null {
  const cycle = sealCycle(period, now)
  if (cycle === null) return null
  if (rank !== 1 && rank !== 2 && rank !== 3) return null
  if (!(row.points_official >= PODIUM_POINTS_FLOOR)) return null

  return { position: rank, cycle }
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

/* ------------------------------------------------------------------------------------------- *
 * THE CALIBRATION OF THE KM AXIS, WEEK BY WEEK — spec §3.2.
 *
 * THE AVERAGE IS THE LEAST INFORMATIVE NUMBER ON THIS SCREEN, and that is the whole reason this
 * series exists. Aggregated over the 13 measured weeks the kilometre is worth 25,6% of the
 * scoreboard and the ratio is 2,91 : 1 — inside the band the operator calibrated the coefficient
 * with. But the WEEKLY slice runs from 4,5% to 44,8%, and in 2 of the 11 weeks with a winner the
 * kilometre handed first place to somebody who did NOT deliver the most history. An average that
 * hides both ends answers *"is it calibrated?"* with a number that happened in no week at all.
 *
 * IT COSTS NO SECOND READ. The route already reads the whole view once — that is what builds the
 * `<select>` — so the series is aggregated there, on the `week` rows already in hand, and travels
 * in the payload as thirteen objects. The view costs ~2,8 s against a `statement_timeout` of 8 s
 * (contract, Parte 7): one read per screen load, never two, and never 350 rows for the browser
 * to add up.
 * ------------------------------------------------------------------------------------------- */

/**
 * WHO WOULD HAVE WON WITHOUT THE KM AXIS — and it is not a second scoreboard.
 *
 * `unchanged` (`=`), a named account, or `unknown` (`—`). The three answers are exclusive and the
 * last one is not a failure: a tie at the top of EITHER side has no "who would win", and a week
 * where nobody scored has nobody to name (spec §3.2, `DS-COMPONENTE-083` item 2).
 */
export type CounterfactualWinner =
  | { outcome: 'unchanged' }
  | { outcome: 'changed'; user_id: string; nickname: string | null }
  | { outcome: 'unknown' }

/**
 * The single leader by one ruler, or `null` when there is a tie or nobody scored.
 *
 * A score of zero never leads: with the roster ranking the whole week since `20260916120000`, the
 * mass of zeros is tied at the end and treating it as a leader would name an arbitrary account as
 * the winner of a week nobody played (**BR-RANKING-001**).
 */
function soleLeader(rows: RankingRow[], score: (row: RankingRow) => number): RankingRow | null {
  let leader: RankingRow | null = null
  let best = 0
  let tied = false

  for (const row of rows) {
    const value = Number(score(row)) || 0
    if (value <= 0) continue
    if (leader === null || value > best) {
      leader = row
      best = value
      tied = false
    } else if (value === best) {
      tied = true
    }
  }

  return tied ? null : leader
}

/**
 * The counterfactual of ONE week — the same rows, the same population, reordered by the score
 * WITHOUT the kilometre parcel.
 *
 * It does not recompute `points_official` and it invents no ruler: both parcels come from the
 * view, and `points_from_triggers × streak_multiplier` is the official formula of
 * **BR-RANKING-004** with one term removed (spec §3.2). Comparing two orders of the same
 * population is what `DS-COMPONENTE-083` item 2 demands of any comparison on this screen.
 */
export function winnerWithoutKm(rows: RankingRow[]): CounterfactualWinner {
  const official = soleLeader(rows, (row) => row.points_official)
  const without = soleLeader(rows, (row) => row.points_from_triggers * row.streak_multiplier)

  if (official === null || without === null) return { outcome: 'unknown' }

  return official.user_id === without.user_id
    ? { outcome: 'unchanged' }
    : { outcome: 'changed', user_id: without.user_id, nickname: without.nickname }
}

/** One line of the panel — one ISO week of the horizon. */
export interface KmCalibrationWeek {
  start: string
  /** EXCLUSIVE, as the view emits it. */
  end: string
  pointsFromTriggers: number
  pointsFromKm: number
  /**
   * `points_from_km ÷ (points_from_triggers + points_from_km)`, or `null`.
   *
   * `null` on a FLOOR week and on a week with no points at all: a fraction over partial coverage
   * is a number with no referent — worse than absent, because it looks like a measurement
   * (`DS-COMPONENTE-084` item 2).
   */
  kmShare: number | null
  winnerWithoutKm: CounterfactualWinner
  /**
   * The week is below `ENTITLEMENT_LEDGER_START` or straddles it, so its kilometre is a FLOOR and
   * not a measurement. **Eight of the 13 weeks are in this state** — half the series, not an edge.
   */
  isFloor: boolean
}

/**
 * The series plus the footer, and the footer sums ONLY the weeks with an instrument.
 *
 * A total over the 13 would mix eight floor weeks with five measured ones, which is exactly the
 * fraction `DS-COMPONENTE-084` item 2 forbids. **The consequence the `qa` has to know before
 * opening a ticket: this number does NOT match the 25,6 % of the contract, and that is not a
 * divergence** — the contract measures the 13 weeks, the footer measures the ones with an
 * instrument, and the second is larger (spec §3.2, §9 critério 34).
 */
export interface KmCalibrationSeries {
  weeks: KmCalibrationWeek[]
  /** How many of the weeks the footer summed — the number the footer prints next to the totals. */
  measuredWeeks: number
  pointsFromTriggers: number
  pointsFromKm: number
  kmShare: number | null
}

/**
 * THE SERIES, AGGREGATED ONCE, IN THE ROUTE — over EVERY `week` row of the view, whatever period
 * the operator has selected (spec §9, critério 31).
 *
 * The population is always `NOT excluded_from_metrics`, in BOTH states of the switch: the panel
 * is an aggregate, and an aggregate on this screen does not follow the switch (spec §2.2,
 * contract Parte 7). The switch decides which rows the operator may look at; one internal account
 * holding a fifth of the points would be the loudest voice in every week of this series.
 */
export function kmCalibrationSeries(rows: RankingRow[]): KmCalibrationSeries {
  const weekly = aggregateRows(rows.filter((row) => row.period_kind === 'week'))

  const byWeek = new Map<string, RankingRow[]>()
  for (const row of weekly) {
    const bucket = byWeek.get(row.period_start)
    if (bucket) bucket.push(row)
    else byWeek.set(row.period_start, [row])
  }

  // Chronological, oldest first: the panel is read as time passing, and the instrument appears
  // partway through it. Ordering by anything else is a question the panel does not ask, which is
  // why it has no `SortHead`.
  const weeks: KmCalibrationWeek[] = Array.from(byWeek.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([start, weekRows]) => {
      const end = weekRows[0].period_end
      const isFloor = kmCoverage(start, end) !== 'full'
      const pointsFromTriggers = sum(weekRows, (row) => row.points_from_triggers)
      const pointsFromKm = sum(weekRows, (row) => row.points_from_km)
      const total = pointsFromTriggers + pointsFromKm

      return {
        start,
        end,
        pointsFromTriggers,
        pointsFromKm,
        kmShare: isFloor || total <= 0 ? null : pointsFromKm / total,
        winnerWithoutKm: isFloor
          ? ({ outcome: 'unknown' } as CounterfactualWinner)
          : winnerWithoutKm(weekRows),
        isFloor,
      }
    })

  const measured = weeks.filter((week) => !week.isFloor)
  const pointsFromTriggers = sum(measured, (week) => week.pointsFromTriggers)
  const pointsFromKm = sum(measured, (week) => week.pointsFromKm)
  const total = pointsFromTriggers + pointsFromKm

  return {
    weeks,
    measuredWeeks: measured.length,
    pointsFromTriggers,
    pointsFromKm,
    kmShare: total > 0 ? pointsFromKm / total : null,
  }
}

/**
 * THE MONTH OF A CYCLE, CAPITALISED — `Setembro de 2026`, `September 2026`, `Septiembre de 2026`.
 *
 * **The capital is not a matter of taste** (spec §6.9): `Intl` hands back `setembro de 2026` and
 * `septiembre de 2026` in lower case, and one lower-case option in the middle of a list of
 * capitalised ones reads as a defect. It goes up with `toLocaleUpperCase(locale)` and NEVER with
 * `toUpperCase()`, which does not respect the locale — the classic counter-example is Turkish
 * `i`, and a formatter that is right by accident in three locales is a formatter that breaks on
 * the fourth.
 *
 * It is here, in the module that owns the period, and not inside the page's `label`: the
 * `<select>`, the stamp and the `<caption>` all print the same month, and a second
 * `Intl.DateTimeFormat` typed in a component is a second owner of the same string
 * (`DS-COMPONENTE-085` item 4). The zone is UTC because every cycle boundary is UTC
 * (**BR-RANKING-005** item 1) — formatting a UTC instant in the reader's zone would print
 * `agosto` over a month that starts in September.
 */
export function formatMonthOfCycle(start: string, locale: string): string {
  const date = new Date(start)
  if (!Number.isFinite(date.getTime())) return UNKNOWN_VALUE

  const text = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)

  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1)
}

/** The calendar year a cycle starts in, in UTC — the `{year}` of `period.year`. */
export function yearOfCycle(start: string): string {
  const date = new Date(start)
  if (!Number.isFinite(date.getTime())) return UNKNOWN_VALUE
  return String(date.getUTCFullYear())
}

/** A share as the operator reads it — `25,6 %`. `null` is the em dash, never `0 %`. */
export function formatShare(share: number | null, locale: string): string {
  if (share == null || !Number.isFinite(share)) return UNKNOWN_VALUE
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(share)
}
