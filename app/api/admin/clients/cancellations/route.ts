/**
 * GET /api/admin/clients/cancellations?contact=pending|done|declined&reason=<code>&clientId=<id>&page=&limit=
 *
 * Admin-only. The cancellations of the Com história made in the portal with their survey
 * (#913, BR-B2B-060 item 7): `partner.list_place_cancellation_feedback()`, which checks
 * `core.is_caller_platform_admin()` in its body, so it runs on the admin's own session, not on
 * service_role. The list and the client record read this same route (`clientId=` for the record).
 *
 * The RPC takes no filter: filter, order and page are here (a few rows per month). Nothing from a
 * row goes to the log, only the code. Until the migration is applied the function does not exist:
 * 503 `not_available`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { UUID } from '@/lib/finance/input'
import { operatorLabel } from '@/lib/services/operator-label'
import {
  contactErrorStatus,
  isCancelReason,
  isContactState,
  toCancellations,
  type CancellationFeedbackRow,
} from '@/lib/clients/cancellations'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

function positiveInt(raw: string | null, fallback: number, max: number): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) return fallback
  return Math.min(n, max)
}

export const GET = withAuth({ roles: ['admin'] }, async (request: NextRequest, _ctx, auth) => {
  const params = request.nextUrl.searchParams
  const contact = params.get('contact')
  const reason = params.get('reason')
  const client = (params.get('clientId') ?? '').trim()
  if (client && !UUID.test(client)) return NextResponse.json({ error: 'clientId must be a uuid' }, { status: 400 })
  const limit = positiveInt(params.get('limit'), DEFAULT_LIMIT, MAX_LIMIT)
  const page = positiveInt(params.get('page'), 1, Number.MAX_SAFE_INTEGER)

  const { data, error } = await auth.supabase.schema('partner').rpc('list_place_cancellation_feedback')
  if (error) {
    console.error('[cancellations] list refused:', error.code)
    const e = contactErrorStatus(error.code)
    return NextResponse.json({ error: e.error, code: e.error }, { status: e.status })
  }

  const rows = (Array.isArray(data) ? data : []) as CancellationFeedbackRow[]
  const ids = [...new Set(rows.map((r) => r.contacted_by).filter((v): v is string => !!v))]
  const names = new Map<string, string>()
  await Promise.all(
    ids.map(async (id) => {
      const label = await operatorLabel(id)
      if (label) names.set(id, label)
    })
  )

  const all = toCancellations(rows, {
    contact: isContactState(contact) ? contact : null,
    reason: isCancelReason(reason) ? reason : null,
    clientId: client || null,
  }, names)
  const pages = Math.max(1, Math.ceil(all.length / limit))
  return NextResponse.json({
    cancellations: all.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total: all.length, pages },
  })
})
