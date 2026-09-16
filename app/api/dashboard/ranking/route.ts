/**
 * GET /api/dashboard/ranking — the scoring scoreboard, one period at a time (#741).
 *
 * TWO THINGS ABOUT THE CLIENT, AND THEY ARE THE POINT OF THIS FILE.
 *
 * 1. The read is `getSupabaseService()`, never `auth.supabase`. `core.ranking_scoreboard` and
 *    `core.ranking_session_metering` grant `SELECT` to `service_role` and to nobody else — the
 *    migration revokes all seven verbs from `PUBLIC`, `anon`, `authenticated` AND `service_role`
 *    and hands back only `SELECT` to the last one. `auth.supabase` reaches PostgREST as
 *    `authenticated`, which in `drive` is every logged-in tourist, so it would come back `42501`
 *    (`docs/contracts/banco-para-cms.md`, Parte 7).
 * 2. The session client is still what proves WHO is asking: `withAuth({ roles: ['admin'] })`
 *    runs first and revalidates the JWT against the Auth server. The service key never leaves
 *    the Next server, and the view carries the nominal scoreboard of 538 people — nickname,
 *    platform, fired triggers, charged minutes. Personal data, BR-USUARIO-042 item 5.
 *
 * WHY THE WHOLE VIEW COMES BACK AND THE PERIOD IS FILTERED HERE: the `<select>` of periods is
 * built from the periods the view actually produced, not from a calendar in the browser, and
 * asking twice would run the view twice per screen. THAT CEILING GOT REAL with the kilometre
 * axis: the view went from ~400 ms to **~3,2 s**, against a `statement_timeout` of 8 s that
 * `service_role` does not override (contract, Parte 7) — one read per screen load, never two.
 *
 * The rows that leave this route are already of exactly ONE period — `DS-COMPONENTE-082` item 1,
 * and the contract's number-one suspect when the screen disagrees with the reference
 * measurement.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  accountRows,
  countInternalAccounts,
  kmCalibrationSeries,
  parsePeriodParam,
  periodOptions,
  rowsForPeriod,
  type ScoreboardReadRow,
} from '@/lib/ranking/scoreboard'

export const dynamic = 'force-dynamic'

/**
 * The columns the screen reads, each one named. `select('*')` would make a column added by
 * `data` arrive here unannounced, and the screen's job is to know what each number means.
 *
 * THIRTY OF THE VIEW'S THIRTY-ONE. The one not named is `in_roster` (column 28): the screen has
 * no roster treatment of its own — see `RankingRow` — and a column nobody reads does not belong
 * in a read that costs ~2,8 s.
 */
const COLUMNS = [
  'period_kind',
  'period_start',
  'period_end',
  'user_id',
  'nickname',
  'platform',
  'excluded_from_metrics',
  'trigger_points_fired',
  'trigger_points_notable',
  'visits_indeterminate',
  'visits_manual',
  'charged_minutes',
  'story_days',
  'has_full_week_streak',
  'streak_multiplier',
  'points_from_triggers',
  'points_from_minutes',
  'points_official',
  'rank_official',
  'rank_excluding_internal',
  'points_notable_weighted',
  'rank_notable_weighted',
  'trail_span_minutes',
  'metering_gap_minutes',
  'sessions_with_trail',
  'sessions_charged',
  // Column 27, added by `20260913150000`. Named here like the other 26 precisely because the
  // view gained it after this route existed: alpha-2 or `null`, never a country name, and the
  // screen is what decides what `null` prints (contract, Parte 7 · `DS-COMPONENTE-086`).
  'top_country_code',
  // Columns 29 and 30, born with `20260916130000` (**BR-RANKING-004**). They are the axis that
  // replaced the minute one in `points_official`: 29 is the kilometre driven with the guide on
  // AND with entitlement — never "kilometres driven" — and 30 is that kilometre at 0,11 point.
  // `points_from_minutes` (17) stays on the list because the view still emits it and the type
  // still declares it; it is `0` constant and nothing on the screen adds it to anything.
  'km_with_entitlement',
  'points_from_km',
  // Column 31, born with `20260916140000` (**BR-RANKING-005**). How many PODIUM components the
  // row's `points_official` came from — weeks in `month`, months in `year`, and `null` in the
  // three older cycles, where there is no composition at all. It costs +12 ms (+0,4%) because it
  // is a `count(*)` over a grouping the view already had, and the screen does NOT derive it:
  // deriving would mean a second read and a second podium ruler in the browser (contract,
  // Parte 7 · spec §10 item 2).
  'podium_components',
].join(',')

/**
 * The ceiling, and what happens when it is reached.
 *
 * The whole view is ~180 rows for 90 days, ~145 for 30 and 30 to 35 per week over a 13-week
 * horizon — 652 rows measured on 2026-09-16, after the roster and the kilometre axis added 95
 * between them (contract, Parte 7). The ceiling is generous, and a truncated read is refused
 * rather than served: a scoreboard missing rows looks exactly like a scoreboard, and PostgREST's
 * own `max-rows` would cut it without saying so.
 */
const ROW_CEILING = 5000

export const GET = withAuth({ roles: ['admin'] }, async (req: NextRequest) => {
  const params = new URL(req.url).searchParams
  const period = parsePeriodParam(params.get('period'), params.get('start'))

  const { data, error, count } = await getSupabaseService()
    .schema('core')
    .from('ranking_scoreboard')
    .select(COLUMNS, { count: 'exact' })
    .order('period_start', { ascending: false })
    .order('points_official', { ascending: false })
    .limit(ROW_CEILING)

  if (error) {
    // No row, no nickname, no id: the message of a PostgREST error can carry the value that
    // failed, and this read is about people (BR-USUARIO-042).
    console.error('[dashboard/ranking] select failed:', error.message)
    // THE SQLSTATE TRAVELS, and it is the half the screen needs: a `PostgrestError` carries the
    // number in `code` and never inside `message`, so a screen matching the text could not tell
    // `42501` — the grant this route depends on — from any other failure (#755). Still no row,
    // no nickname, no id: the code is five characters of PostgreSQL vocabulary, not PII.
    return NextResponse.json({ error: error.message, code: error.code }, { status: 502 })
  }

  // The generated row type of a view the repo has no schema types for is `GenericStringError`;
  // the named column list above is what pins the shape, and it is checked against the contract.
  const read = (data ?? []) as unknown as ScoreboardReadRow[]

  // THE TRUNCATION GUARD COMPARES WHAT POSTGREST COUNTED WITH WHAT ARRIVED, so it runs BEFORE any
  // filtering of ours: a row we dropped on purpose would otherwise read as a row the ceiling cut,
  // and every single request would be refused as truncated.
  if (typeof count === 'number' && count > read.length) {
    console.error(`[dashboard/ranking] truncated read: ${read.length} of ${count}`)
    return NextResponse.json(
      { error: 'ranking_scoreboard returned more rows than the route ceiling' },
      { status: 502 }
    )
  }

  // The ghost row of `user_id` null is dropped HERE, once, so that the table, the count of marked
  // accounts and the `<select>` of periods below all speak about accounts (contract, Parte 7).
  const rows = accountRows(read)

  return NextResponse.json({
    data: {
      periods: periodOptions(rows),
      period,
      // THE CALIBRATION SERIES IS AGGREGATED HERE, ON THE ROWS ALREADY IN HAND — spec §3.2 and
      // §9 critério 31. It is the same 13 weeks whatever period was asked for, so it cannot be a
      // second request: the view is ~2,8 s against an 8 s `statement_timeout`, and 350 weekly
      // rows crossing the wire for the browser to add up would be the same cost paid twice.
      calibration: kmCalibrationSeries(rows),
      // Counted over the whole view, not over the served period: it answers "is the filter
      // removing anybody at all", which must not flicker when the operator changes the week.
      internalAccounts: countInternalAccounts(rows),
      rows: rowsForPeriod(rows, period),
    },
  })
})
