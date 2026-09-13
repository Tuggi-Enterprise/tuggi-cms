/**
 * GET /api/dashboard/ranking/sessions — one row per trip session (#741, tab 2).
 *
 * Same gate and same client as `../route.ts`, for the same reason: `core.ranking_session_metering`
 * grants `SELECT` to `service_role` alone, and `auth.supabase` would come back `42501`
 * (`docs/contracts/banco-para-cms.md`, Parte 7). The session client proves the operator is an
 * admin; the service key never leaves this server.
 *
 * ORDERED BY `metering_gap_minutes` DESCENDING, at the database. This tab exists for the TAIL of
 * the BR-MONETIZACAO-049 divergence — the median session is 2,1 minutes apart and the maximum is
 * 4.802 — so if a ceiling ever cuts the list, what it cuts is the part nobody came to see.
 *
 * `?userId=` is the drill-down from the `Diferença` cell of the scoreboard. It is validated as a
 * uuid before it becomes a filter: a route is the only barrier in front of PostgREST, and
 * `service_role` ignores RLS.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import type { SessionMeteringRow } from '@/lib/ranking/scoreboard'

export const dynamic = 'force-dynamic'

const COLUMNS = [
  'trip_session_id',
  'user_id',
  'nickname',
  'excluded_from_metrics',
  'platform',
  'session_start',
  'session_end',
  'was_interrupted',
  'interruption_reason',
  'first_signal_at',
  'last_signal_at',
  'trail_points',
  'trail_span_minutes',
  'charged_minutes',
  'first_charge_at',
  'last_charge_at',
  'guide_active_minutes',
  'metering_gap_minutes',
  'trigger_points_fired',
].join(',')

/** 310 sessions in 30 days (contract); 13 weeks of them stay far below this. */
const ROW_CEILING = 5000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const GET = withAuth({ roles: ['admin'] }, async (req: NextRequest) => {
  // `new URL(req.url)`, not `req.nextUrl`: the handler has to work for any `Request` the
  // runtime hands it, and the sibling route reads its parameters the same way.
  const userId = new URL(req.url).searchParams.get('userId')

  if (userId !== null && !UUID.test(userId)) {
    return NextResponse.json({ error: 'userId must be a uuid' }, { status: 400 })
  }

  let query = getSupabaseService()
    .schema('core')
    .from('ranking_session_metering')
    .select(COLUMNS, { count: 'exact' })
    .order('metering_gap_minutes', { ascending: false })
    .limit(ROW_CEILING)

  if (userId) query = query.eq('user_id', userId)

  const { data, error, count } = await query

  if (error) {
    console.error('[dashboard/ranking/sessions] select failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 502 })
  }

  // The generated row type of a view the repo has no schema types for is `GenericStringError`;
  // the named column list above is what pins the shape, and it is checked against the contract.
  const rows = (data ?? []) as unknown as SessionMeteringRow[]

  if (typeof count === 'number' && count > rows.length) {
    console.error(`[dashboard/ranking/sessions] truncated read: ${rows.length} of ${count}`)
    return NextResponse.json(
      { error: 'ranking_session_metering returned more rows than the route ceiling' },
      { status: 502 }
    )
  }

  return NextResponse.json({ data: { rows } })
})
