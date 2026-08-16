/**
 * POST   /api/admin/partner-proposals/{submissionId}/discard — files the proposal away.
 * DELETE /api/admin/partner-proposals/{submissionId}/discard — puts it back.
 *
 * DISCARDING IS NOT REJECTING AT TRIAGE. A place turned down at triage is still a partner
 * (BR-B2B-011, first edge case), and no reason on `DISCARD_REASONS` is a gate. Nothing here
 * touches the establishment, the client record, or any status other than the proposal's own.
 *
 * It is reversible while nobody has promoted, and the screen says so before the click:
 * an irreversible discard makes the operator hesitate to use the right reason.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import { discardProposal, restoreProposal } from '@/lib/services/partner-proposal-admin-service'
import { isDiscardReason } from '@/lib/partner-form/proposal-review'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const POST = withRateLimit(20, 60_000)(
  withAuth<{ submissionId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const params = await ctx.params
    const submissionId = params?.submissionId
    if (!submissionId || !UUID_PATTERN.test(submissionId)) {
      return NextResponse.json({ error: 'invalid_submission_id' }, { status: 400 })
    }

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    // Closed list, and the reason is required: a discard with no reason is a proposal that
    // disappears and nobody can say why six months later.
    if (!isDiscardReason(body.reason)) {
      return NextResponse.json({ error: 'invalid_reason' }, { status: 400 })
    }

    const outcome = await discardProposal(submissionId, body.reason, auth.user.id)
    if (!outcome.ok) {
      const status = outcome.reason === 'not_discardable' ? 409 : 503
      return NextResponse.json({ error: outcome.reason }, { status })
    }

    await logAuditEvent({
      request: req,
      action: 'DISCARD_PARTNER_PROPOSAL',
      entity: 'PARTNER_PROPOSAL',
      entityId: submissionId,
      userId: auth.user.id,
      userEmail: auth.user.email ?? null,
      description: `Partner proposal discarded: ${body.reason}`,
    })

    return NextResponse.json({ ok: true })
  })
)

export const DELETE = withRateLimit(20, 60_000)(
  withAuth<{ submissionId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const params = await ctx.params
    const submissionId = params?.submissionId
    if (!submissionId || !UUID_PATTERN.test(submissionId)) {
      return NextResponse.json({ error: 'invalid_submission_id' }, { status: 400 })
    }

    const outcome = await restoreProposal(submissionId)
    if (!outcome.ok) {
      const status = outcome.reason === 'not_discardable' ? 409 : 503
      return NextResponse.json({ error: outcome.reason }, { status })
    }

    await logAuditEvent({
      request: req,
      action: 'RESTORE_PARTNER_PROPOSAL',
      entity: 'PARTNER_PROPOSAL',
      entityId: submissionId,
      userId: auth.user.id,
      userEmail: auth.user.email ?? null,
      description: 'Partner proposal returned to the review queue',
    })

    return NextResponse.json({ ok: true })
  })
)
