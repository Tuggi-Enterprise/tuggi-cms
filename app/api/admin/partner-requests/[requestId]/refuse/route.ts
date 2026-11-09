/**
 * POST /api/admin/partner-requests/[requestId]/refuse `{ reason }` — refuses a request of a
 * partner without a place (#1139, BR-USUARIO-052 item 4.d). Contract `parceiro-sem-local.md` §4.3.
 *
 * The reason goes to the person in the app, 1 to 500 characters (the database bounds, checked
 * here first so the curator gets the sentence and not a 503). The reason is not logged: it is
 * free text about a person.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import { refusePartnerRequest } from '@/lib/services/partner-request-service'
import { refusalReasonOf, requestIdOf } from '@/lib/partner-requests/queue'

export const dynamic = 'force-dynamic'

export const POST = withRateLimit(30, 60_000)(
  withAuth<{ requestId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const params = await ctx.params
    const requestId = requestIdOf(params?.requestId)
    if (requestId === null) return NextResponse.json({ error: 'invalid_request_id' }, { status: 400 })

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }
    const reason = refusalReasonOf(body?.reason)
    if (reason === null) return NextResponse.json({ error: 'invalid_reason' }, { status: 400 })

    const result = await refusePartnerRequest(requestId, reason, auth.user.id)
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : result.error === 'invalid_reason' ? 400 : 503
      return NextResponse.json({ error: result.error }, { status })
    }

    if (result.outcome.kind === 'refused') {
      await logAuditEvent({
        userId: auth.user.id,
        userEmail: auth.user.email,
        action: 'REFUSE_PARTNER_REQUEST',
        entity: 'CLIENT',
        entityId: String(requestId),
        description: `Pedido de parceiro sem local ${requestId} recusado com motivo`,
        request: req,
      })
    }

    return NextResponse.json({ outcome: result.outcome })
  })
)
