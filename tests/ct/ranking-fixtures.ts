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
    points_from_minutes: 4.29,
    points_official: 49.29,
    rank_official: 1,
    rank_excluding_internal: 1,
    points_notable_weighted: 57,
    rank_notable_weighted: 1,
    trail_span_minutes: 4022,
    metering_gap_minutes: 3879,
    sessions_with_trail: 6,
    sessions_charged: 2,
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
    points_from_minutes: 0,
    charged_minutes: 0,
    points_official: 7,
    rank_official: 3,
    rank_excluding_internal: 2,
    points_notable_weighted: 8,
    rank_notable_weighted: 2,
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
      rank_official: index + 1,
      rank_excluding_internal: index + 1,
      rank_notable_weighted: total - index,
    })
  )
}
