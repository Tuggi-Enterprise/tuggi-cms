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
 * asking twice would run a 443 ms view twice per screen. The rows that leave this route are
 * already of exactly ONE period — `DS-COMPONENTE-082` item 1, and the contract's number-one
 * suspect when the screen disagrees with the reference measurement.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  parsePeriodParam,
  periodOptions,
  rowsForPeriod,
  type RankingRow,
} from '@/lib/ranking/scoreboard'

export const dynamic = 'force-dynamic'

/**
 * Every column of the view, named. `select('*')` would make a column added by `data` arrive
 * here unannounced, and the screen's job is to know what each number means.
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
].join(',')

/**
 * The ceiling, and what happens when it is reached.
 *
 * The whole view is ~180 rows for 90 days, ~145 for 30 and 30 to 35 per week over a 13-week
 * horizon — around 800 (contract, measured 2026-09-13). The ceiling is generous, and a
 * truncated read is refused rather than served: a scoreboard missing rows looks exactly like a
 * scoreboard, and PostgREST's own `max-rows` would cut it without saying so.
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
    return NextResponse.json({ error: error.message }, { status: 502 })
  }

  // The generated row type of a view the repo has no schema types for is `GenericStringError`;
  // the named column list above is what pins the shape, and it is checked against the contract.
  const rows = (data ?? []) as unknown as RankingRow[]

  if (typeof count === 'number' && count > rows.length) {
    console.error(`[dashboard/ranking] truncated read: ${rows.length} of ${count}`)
    return NextResponse.json(
      { error: 'ranking_scoreboard returned more rows than the route ceiling' },
      { status: 502 }
    )
  }

  return NextResponse.json({
    data: {
      periods: periodOptions(rows),
      period,
      rows: rowsForPeriod(rows, period),
    },
  })
})
