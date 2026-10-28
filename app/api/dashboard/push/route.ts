/**
 * `GET /api/dashboard/push?from=YYYY-MM-DD&to=YYYY-MM-DD`: every push sent in the period, by send
 * and by type, and the devices with the app today (BR-COMUNICACAO-019 3.m.9, #1051), from
 * `drive.cms_get_push_report` (service_role only, contract notificacoes.md §13).
 *
 * Admin by `withAuth`, then service_role: the function has no caller check of its own. Aggregates
 * only, no user id. `devices.inactive_tokens_changed` is dropped here: it is the last write on
 * the token, not an uninstall, and no screen may read it as one (decision D5 of 20261028160000).
 * The type filter is the screen's: the chips need the counts of every type in the period.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { pushReportRange, type PushReport } from '@/lib/notifications/push-report'
import { pushRpcFailure } from '@/lib/notifications/push-report-route'

export const dynamic = 'force-dynamic'

export const GET = withAuth({ roles: ['admin'] }, async (req: NextRequest) => {
  const params = new URL(req.url).searchParams
  const range = pushReportRange(params.get('from'), params.get('to'))
  if (!range) {
    return NextResponse.json({ error: 'from and to must be calendar days, from <= to, at most 400 days', code: '22023' }, { status: 400 })
  }

  const { data, error } = await getSupabaseService()
    .schema('drive')
    .rpc('cms_get_push_report', { p_from: range.p_from, p_to: range.p_to })
  if (error) return pushRpcFailure('report', error)

  const raw = data as (PushReport & { devices: PushReport['devices'] & { inactive_tokens_changed?: unknown } }) | null
  if (!raw) return pushRpcFailure('report', { code: 'empty' })
  const { inactive_tokens_changed: _dropped, ...devices } = raw.devices
  return NextResponse.json({ data: { ...raw, devices } satisfies PushReport })
})
