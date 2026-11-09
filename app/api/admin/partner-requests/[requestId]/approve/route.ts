/**
 * POST /api/admin/partner-requests/[requestId]/approve — approves a request of a partner without
 * a place (#1139, BR-B2B-066 items 2 and 6). Contract `parceiro-sem-local.md` §4.2.
 *
 * The database writes the record, the code (BR-B2B-058), the default rate (BR-MONETIZACAO-039
 * item 6, declared only in `drive.approve_partner_request_as`) and the commission mark. This route
 * declares no rate and writes nothing but the audit row.
 *
 * `document_in_use` and `not_in_review` are answers, not failures: 200 with the outcome, and the
 * screen says what to do. Only an unknown request (404) or a failed call (503) is an error.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import { approvePartnerRequest } from '@/lib/services/partner-request-service'
import { requestIdOf } from '@/lib/partner-requests/queue'

export const dynamic = 'force-dynamic'

export const POST = withRateLimit(30, 60_000)(
  withAuth<{ requestId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const params = await ctx.params
    const requestId = requestIdOf(params?.requestId)
    if (requestId === null) return NextResponse.json({ error: 'invalid_request_id' }, { status: 400 })

    const result = await approvePartnerRequest(requestId, auth.user.id)
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.error === 'not_found' ? 404 : 503 }
      )
    }

    if (result.outcome.kind === 'approved') {
      // No name, document or contact in the trail: the request id and the record are enough.
      await logAuditEvent({
        userId: auth.user.id,
        userEmail: auth.user.email,
        action: 'APPROVE_PARTNER_REQUEST',
        entity: 'CLIENT',
        entityId: result.outcome.clientId,
        description: `Pedido de parceiro sem local ${requestId} aprovado; cliente ${result.outcome.clientId}`,
        request: req,
      })
    }

    return NextResponse.json({ outcome: result.outcome })
  })
)
