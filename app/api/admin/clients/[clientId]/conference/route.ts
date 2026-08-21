/**
 * GET/PUT /api/admin/clients/{clientId}/conference — the in-person conference of BR-B2B-022,
 * item 3, against the client.
 *
 * WHY IT IS ITS OWN ROUTE AND NOT A FIELD OF THE CONTRACT. The conference is not part of the
 * contract: it is a fact about the establishment that the contract gate happens to read, it
 * survives the contract being superseded, and it is written by an act with its own author. The
 * contract route reads it and refuses generation without it; it never writes it.
 *
 * IT IS AUDITED, AND IT HAS TO BE. This is an UPDATE that overwrites: a second operator
 * rewriting the conference takes `reviewed_by` with them, and the earlier assertion is gone
 * from the table. The audit row is the only place it survives — the same reasoning, and the
 * same shape, as `PUT /api/admin/partner-proposals/{id}/review-note` (security review,
 * 2026-08-16, M-2).
 *
 * IT WRITES NO `status`, reaches no column of `partner.clients`, and sends nothing to the
 * partner. What it decides is whether a CONTRACT can be produced, and that gate lives on the
 * other side of this write.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import {
  getClientConference,
  normalizeClientConference,
  saveClientConference,
} from '@/lib/services/client-conference-service'
import { operatorLabel } from '@/lib/services/operator-label'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Codes only. The trail needs WHO asserted WHAT, and since 2026-08-21 the what is a list of
 * ticks — `user_id`/`user_email` on the audit row carry the who.
 */
function describe(conference: { documentsSeen: string[] }): string {
  return `documents_seen=${conference.documentsSeen.join('+') || 'none'}`
}

export const GET = withRateLimit(60, 60_000)(
  withAuth<{ clientId: string }>({ roles: ['admin'] }, async (_req, ctx) => {
    const params = await ctx.params
    const clientId = params?.clientId
    if (!clientId || !UUID_PATTERN.test(clientId)) {
      return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
    }

    const record = await getClientConference(clientId)
    return NextResponse.json({
      conference: record.conference,
      reviewedAt: record.reviewedAt,
      // A uuid on screen names nobody. BR-B2B-030 item 2 asks the trail to say who conferred.
      reviewedByLabel: record.reviewedBy ? await operatorLabel(record.reviewedBy) : null,
    })
  })
)

export const PUT = withRateLimit(30, 60_000)(
  withAuth<{ clientId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const params = await ctx.params
    const clientId = params?.clientId
    if (!clientId || !UUID_PATTERN.test(clientId)) {
      return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const conference = normalizeClientConference(body)
    if (!conference) {
      return NextResponse.json({ error: 'invalid_conference' }, { status: 400 })
    }

    const saved = await saveClientConference(clientId, conference, auth.user.id)
    if (!saved) {
      return NextResponse.json({ error: 'conference_not_saved' }, { status: 503 })
    }

    await logAuditEvent({
      request: req,
      action: 'REVIEW_CLIENT_CONFERENCE',
      entity: 'CLIENT',
      entityId: clientId,
      userId: auth.user.id,
      userEmail: auth.user.email ?? null,
      description: describe(conference),
    })

    return NextResponse.json({ ok: true, conference })
  })
)
