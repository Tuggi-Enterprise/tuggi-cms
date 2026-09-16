/**
 * The rows the scoreboard mounts against, and the two periods that matter.
 *
 * They live in a `.ts` of their own because the CT runner refuses to mount a component that
 * shares a module with the test's own helpers — the same split `marketing-newsletter-fixtures.ts`
 * and `finance-fixtures.ts` already use.
 */

import { kmCalibrationSeries, type PeriodOption, type RankingRow } from '@/lib/ranking/scoreboard'

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
 * #742 — THE TWO COMPOSED CYCLES AND THE CALIBRATION SERIES.
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

/**
 * THE 13 WEEKS OF THE HORIZON, AND EIGHT OF THEM ARE BELOW THE KM BOUNDARY — the same 8/13 split
 * production has (contract, Parte 7; spec §7.7). The horizon starts on Monday 2026-06-22, so the
 * week of 10/08 straddles `ENTITLEMENT_LEDGER_START` (13/08) and the five from 17/08 on are the
 * measured ones.
 */
const HORIZON_START = Date.UTC(2026, 5, 22)
const WEEK_MS = 7 * 86_400_000

export const CALIBRATION_WEEKS = Array.from({ length: 13 }, (_, index) => ({
  start: new Date(HORIZON_START + index * WEEK_MS).toISOString(),
  end: new Date(HORIZON_START + (index + 1) * WEEK_MS).toISOString(),
}))

/** The week where the km axis HANDS FIRST PLACE to somebody who delivered less history. */
export const FLIPPED_WEEK_INDEX = 10

/**
 * Two accounts per week plus the internal one — and the internal one holds a thousand points on
 * purpose: the panel is an aggregate, aggregates never follow the switch (spec §2.2), so if it
 * ever did, every share in the series would move at once.
 */
export function calibrationRows(): RankingRow[] {
  return CALIBRATION_WEEKS.flatMap((week, index) => {
    const flips = index === FLIPPED_WEEK_INDEX
    const base = {
      period_kind: 'week' as const,
      period_start: week.start,
      period_end: week.end,
    }

    return [
      row({
        ...base,
        trigger_points_fired: 10,
        points_from_triggers: 10,
        points_from_km: flips ? 2 : 6,
        points_official: flips ? 12 : 16,
        rank_official: flips ? 2 : 1,
        rank_excluding_internal: flips ? 2 : 1,
      }),
      row({
        ...base,
        user_id: '22222222-2222-4222-8222-222222222222',
        nickname: 'quiet-tapir',
        platform: 'android',
        trigger_points_fired: 8,
        points_from_triggers: 8,
        points_from_km: flips ? 5 : 1,
        points_official: flips ? 13 : 9,
        rank_official: flips ? 1 : 2,
        rank_excluding_internal: flips ? 1 : 2,
      }),
      row({
        ...base,
        user_id: '99999999-9999-4999-8999-999999999999',
        nickname: 'tuggi-operator',
        excluded_from_metrics: true,
        trigger_points_fired: 500,
        points_from_triggers: 500,
        points_from_km: 500,
        points_official: 1000,
        rank_official: 1,
        rank_excluding_internal: null,
      }),
    ]
  })
}

/** The series exactly as the route builds it — the real function, never a hand-written literal. */
export const CALIBRATION = kmCalibrationSeries(calibrationRows())
