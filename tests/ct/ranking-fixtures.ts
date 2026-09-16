/**
 * The rows the scoreboard mounts against, and the two periods that matter.
 *
 * They live in a `.ts` of their own because the CT runner refuses to mount a component that
 * shares a module with the test's own helpers — the same split `marketing-newsletter-fixtures.ts`
 * and `finance-fixtures.ts` already use.
 */

import type { PeriodOption, RankingRow } from '@/lib/ranking/scoreboard'

/** A week of the meter's era. Three accounts, one of them marked as internal. */
export const WEEK: PeriodOption = {
  kind: 'week',
  start: '2026-08-31T00:00:00+00:00',
  end: '2026-09-07T00:00:00+00:00',
}

/**
 * A week that STRADDLES the first row of the ledger: part of it has an instrument and part does
 * not. It is the shape of `rolling_30d` today, which is this screen's default period — the state
 * the screen used to flatten into `full` everywhere except the amber band (#741).
 */
export const WEEK_ACROSS_METER: PeriodOption = {
  kind: 'week',
  start: '2026-08-17T00:00:00+00:00',
  end: '2026-08-24T00:00:00+00:00',
}

/** A week BEFORE 2026-08-18 20:41 UTC: the minute axis has no instrument in it. */
export const WEEK_BEFORE_METER: PeriodOption = {
  kind: 'week',
  start: '2026-07-06T00:00:00+00:00',
  end: '2026-07-13T00:00:00+00:00',
}

function row(overrides: Partial<RankingRow> = {}): RankingRow {
  return {
    period_kind: 'week',
    period_start: WEEK.start,
    period_end: WEEK.end,
    user_id: '11111111-1111-4111-8111-111111111111',
    nickname: 'hoppy-otter',
    platform: 'ios',
    excluded_from_metrics: false,
    trigger_points_fired: 45,
    trigger_points_notable: 12,
    visits_indeterminate: 3,
    visits_manual: 2,
    charged_minutes: 143,
    story_days: 4,
    has_full_week_streak: false,
    streak_multiplier: 1,
    points_from_triggers: 45,
    /**
     * `0` CONSTANT, as the view emits it since `20260916130000`: the minute axis is out of the
     * score (**BR-RANKING-004** item 2) and `charged_minutes` above is untouched. A fixture that
     * kept the old 4,29 here would be the only place in the repository where the removed axis
     * still scores.
     */
    points_from_minutes: 0,
    points_official: 49.29,
    rank_official: 1,
    rank_excluding_internal: 1,
    points_notable_weighted: 57,
    rank_notable_weighted: 1,
    trail_span_minutes: 4022,
    metering_gap_minutes: 3879,
    sessions_with_trail: 6,
    sessions_charged: 2,
    /** Alpha-2, as the view guarantees it — one of the 15 codes the screen sees today. */
    top_country_code: 'BR',
    /**
     * THE AXIS THAT REPLACED THE MINUTE ONE — **BR-RANKING-004**. Not "kilometres driven": it is
     * the kilometre with the guide on AND with entitlement, GPS noise filtered.
     *
     * 39 km × 0,11 = 4,29 points, which is exactly what the 143 charged minutes used to be worth
     * at 0,03 — so `points_official` stays 49,29 and every number the seal tests pin keeps its
     * meaning while the axis under it changes.
     */
    km_with_entitlement: 39,
    points_from_km: 4.29,
    /**
     * COLUMN 31 — `null` in `week`, and that is the value the view emits in the three older
     * cycles, never `0` (contract, Parte 7 · **BR-RANKING-005**). A fixture with `0` here would
     * make every week row claim "no podium component", which is the exact misreading the column
     * was given a nullable type to prevent.
     */
    podium_components: null,
    ...overrides,
  }
}

/**
 * The operator's own account is the reason the filter exists (#740): marked, and holding the
 * largest score of the week. `tuggi-operator` is here so a row that must not render has a name
 * a test can look for.
 */
export const ROWS: RankingRow[] = [
  row({
    user_id: '99999999-9999-4999-8999-999999999999',
    nickname: 'tuggi-operator',
    excluded_from_metrics: true,
    top_country_code: 'PT',
    trigger_points_fired: 120,
    points_from_triggers: 120,
    points_official: 124.29,
    rank_official: 1,
    rank_excluding_internal: null,
    rank_notable_weighted: 1,
  }),
  row({ rank_official: 2, rank_excluding_internal: 1, rank_notable_weighted: 4 }),
  row({
    user_id: '22222222-2222-4222-8222-222222222222',
    nickname: 'quiet-tapir',
    platform: 'android',
    trigger_points_fired: 7,
    points_from_triggers: 7,
    // Fired seven times and drove no entitled kilometre: the score is the trigger axis alone.
    km_with_entitlement: 0,
    points_from_km: 0,
    charged_minutes: 0,
    points_official: 7,
    rank_official: 3,
    rank_excluding_internal: 2,
    points_notable_weighted: 8,
    rank_notable_weighted: 2,
    // The account that entered the period without a visit whose country resolves: `null` is
    // "does not resolve", and the cell prints the em dash (`DS-COMPONENTE-086` item 6).
    top_country_code: null,
    trail_span_minutes: 12,
    // Charged more than the trail spans: the difference IS negative, and the column has to say
    // so instead of printing `0 min` (`DS-COMPONENTE-084` item 3).
    metering_gap_minutes: -12,
  }),
]

/**
 * ENOUGH ROWS TO MAKE THE TABLE SCROLL, which is the only state where the geometry of the two
 * sticky bands exists at all: with `scrollTop = 0` a band that covers the one below it looks
 * exactly like a band that does not. 31 rows and `scrollTop = 400` are the numbers the design
 * measured at 1280 × 800 in Chromium (#752).
 */
export function scrollingRows(total = 31): RankingRow[] {
  return Array.from({ length: total }, (_, index) =>
    row({
      user_id: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
      nickname: `runner-${index + 1}`,
      platform: index % 2 === 0 ? 'ios' : 'android',
      // The country travels with the platform, because the view's ruler is the same one: the
      // rows that have a platform are the rows that have a country (contract, Parte 7).
      top_country_code: index % 3 === 0 ? 'BR' : index % 3 === 1 ? 'ES' : 'US',
      rank_official: index + 1,
      rank_excluding_internal: index + 1,
      rank_notable_weighted: total - index,
    })
  )
}

/* ------------------------------------------------------------------------------------------- *
 * #742 — THE TWO COMPOSED CYCLES.
 * ------------------------------------------------------------------------------------------- */

/** September 2026, a full calendar month — `[1st, 1st of October)`, UTC (**BR-RANKING-005**). */
export const MONTH: PeriodOption = {
  kind: 'month',
  start: '2026-09-01T00:00:00+00:00',
  end: '2026-10-01T00:00:00+00:00',
}

/** The year the view composes out of the months that fit whole in the horizon. */
export const YEAR: PeriodOption = {
  kind: 'year',
  start: '2026-01-01T00:00:00+00:00',
  end: '2027-01-01T00:00:00+00:00',
}

/**
 * A month as the view serves it: `points_official` is the SUM of the podium weeks, `rank_official`
 * is never null, `streak_multiplier` is `1.0` and `podium_components` says how many weeks the sum
 * consumed. The third row carries `null` in the counter — not a state the view produces, but the
 * one the service's own rule produces when a column does not come back (`ranking-service.ts`), and
 * the cell has to print the em dash rather than a zero.
 */
export const MONTH_ROWS: RankingRow[] = [
  row({
    period_kind: 'month',
    period_start: MONTH.start,
    period_end: MONTH.end,
    points_official: 615.7,
    rank_official: 1,
    rank_excluding_internal: 1,
    has_full_week_streak: false,
    streak_multiplier: 1,
    podium_components: 3,
  }),
  row({
    period_kind: 'month',
    period_start: MONTH.start,
    period_end: MONTH.end,
    user_id: '22222222-2222-4222-8222-222222222222',
    nickname: 'quiet-tapir',
    platform: 'android',
    points_official: 132.4,
    rank_official: 2,
    rank_excluding_internal: 2,
    streak_multiplier: 1,
    podium_components: 1,
  }),
  row({
    period_kind: 'month',
    period_start: MONTH.start,
    period_end: MONTH.end,
    user_id: '33333333-3333-4333-8333-333333333333',
    nickname: 'loud-macaw',
    points_official: 48,
    rank_official: 3,
    rank_excluding_internal: 3,
    streak_multiplier: 1,
    podium_components: null,
  }),
]

/** The same shape one level up: the counter counts MONTHS of podium, and the header says so. */
export const YEAR_ROWS: RankingRow[] = MONTH_ROWS.map((entry) => ({
  ...entry,
  period_kind: 'year' as const,
  period_start: YEAR.start,
  period_end: YEAR.end,
  podium_components: entry.podium_components === null ? null : 2,
}))

/* ------------------------------------------------------------------------------------------- *
 * #742 · §11 — THE SHAPE THE OPERATOR ACTUALLY MET, AND THE REASON THE SCREEN WAS REDESIGNED.
 * ------------------------------------------------------------------------------------------- */

/**
 * SIXTEEN ACCOUNTS, ELEVEN OF THEM ZERO IN EVERY CELL — the reading of the current week in
 * production on 2026-09-16, and the measurement §11 opens with.
 *
 * It is a fixture of its own and not `scrollingRows`, because the defect it exists to measure is
 * not the scroll: it is that the five rows that ARE the scoreboard sit under eleven that are not,
 * and that the chip `Todas` was the default. A fixture where every row scores cannot fail the
 * geometric criterion, and cannot show a dimmed row either.
 */
export const FIELD_ROWS: RankingRow[] = [
  ...Array.from({ length: 5 }, (_, index) =>
    row({
      user_id: `${String(index + 1).padStart(8, '0')}-2222-4222-8222-222222222222`,
      nickname: `scorer-${index + 1}`,
      platform: index % 2 === 0 ? 'ios' : 'android',
      top_country_code: index % 2 === 0 ? 'BR' : 'PT',
      trigger_points_fired: 45 - index * 8,
      points_from_triggers: 45 - index * 8,
      km_with_entitlement: 39 - index * 6,
      points_from_km: Number(((39 - index * 6) * 0.11).toFixed(2)),
      points_official: Number((45 - index * 8 + (39 - index * 6) * 0.11).toFixed(2)),
      rank_official: index + 1,
      rank_excluding_internal: index + 1,
      points_notable_weighted: 57 - index * 9,
      rank_notable_weighted: index === 0 ? 2 : index === 1 ? 1 : index + 1,
      story_days: 4 - index,
    })
  ),
  ...Array.from({ length: 11 }, (_, index) =>
    row({
      user_id: `${String(index + 6).padStart(8, '0')}-3333-4333-8333-333333333333`,
      nickname: `silent-${index + 1}`,
      platform: null,
      top_country_code: null,
      trigger_points_fired: 0,
      trigger_points_notable: 0,
      visits_indeterminate: 0,
      visits_manual: 0,
      charged_minutes: 0,
      story_days: 0,
      has_full_week_streak: false,
      streak_multiplier: 1,
      points_from_triggers: 0,
      km_with_entitlement: 0,
      points_from_km: 0,
      points_official: 0,
      rank_official: index + 6,
      rank_excluding_internal: index + 6,
      points_notable_weighted: 0,
      rank_notable_weighted: index + 6,
      trail_span_minutes: 0,
      metering_gap_minutes: 0,
      sessions_with_trail: 0,
      sessions_charged: 0,
    })
  ),
]
