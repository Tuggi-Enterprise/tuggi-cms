/**
 * POST /api/admin/public-identity/reports/[reportId]/decide `{ decision: 'remove' | 'dismiss' }`
 * (#1144, BR-USUARIO-051 item 5). Contract `identidade-publica.md`, "CMS":
 * `drive.decide_public_identity_report_as` with `p_actor` = the curator signed in.
 *
 * `remove` sends the field back to a generated name (an empty bio) and closes the open reports of
 * that field; a removed @ is blocked forever. `dismiss` changes nothing. A report someone else
 * decided first answers 200 with `already_decided`: it is an answer, not a failure.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import { decideReport, statusOf } from '@/lib/services/public-identity-moderation-service'
import { isReportDecision, positiveIdOf } from '@/lib/public-identity/moderation'

export const dynamic = 'force-dynamic'

export const POST = withRateLimit(60, 60_000)(
  withAuth<{ reportId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const params = await ctx.params
    const reportId = positiveIdOf(params?.reportId)
    if (reportId === null) return NextResponse.json({ error: 'invalid_report_id' }, { status: 400 })

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }
    const decision = body?.decision
    if (!isReportDecision(decision)) return NextResponse.json({ error: 'invalid_decision' }, { status: 400 })

    const result = await decideReport(reportId, decision, auth.user.id)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: statusOf(result.error) })

    if (result.value.kind !== 'already_decided') {
      // The reported value stays out of the trail: the report id leads to it.
      await logAuditEvent({
        userId: auth.user.id,
        userEmail: auth.user.email,
        action: 'DECIDE_PUBLIC_IDENTITY_REPORT',
        entity: 'USER',
        entityId: String(reportId),
        description: `Denúncia de nome ${reportId}: ${result.value.kind}`,
        request: req,
      })
    }

    return NextResponse.json({ outcome: result.value })
  })
)
