/**
 * The operator's decision on a Portal Locais submission (#812, BR-B2B-049): approve, ask for
 * changes, or refuse. One route, three acts, all ending in `partner.transition_place_submission`
 * — `lib/services/portal-validation-service.ts` holds the rules; this only gates and answers.
 *
 * Body: `{ "action": "approve" }` · `{ "action": "request_changes", "note": string }` ·
 * `{ "action": "reject", "reason": PortalRefusalReason, "note": string }`.
 *
 * 409 `status_conflict` when another operator acted first (the spec's conflict state).
 *
 * GET reads the submission for the validation screen, CPF masked
 * (`portal-submission-review-service.ts`); `GET ?reveal=cpf` returns the signer's whole CPF
 * and leaves an audit row — the number is never in the page before the click.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import {
  approvePortalSubmission,
  parsePortalDecision,
  rejectPortalSubmission,
  requestPortalChanges,
} from '@/lib/services/portal-validation-service'
import { getPortalSubmissionReview, revealPortalSignerCpf } from '@/lib/services/portal-submission-review-service'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const AUDIT = {
  approve: 'APPROVE_PORTAL_SUBMISSION',
  request_changes: 'REQUEST_PORTAL_CHANGES',
  reject: 'REJECT_PORTAL_SUBMISSION',
} as const

export const GET = withRateLimit(120, 60_000)(
  withAuth<{ submissionId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const params = await ctx.params
    const submissionId = params?.submissionId
    if (!submissionId || !UUID_PATTERN.test(submissionId)) {
      return NextResponse.json({ error: 'invalid_submission_id' }, { status: 400 })
    }

    if (new URL(req.url).searchParams.get('reveal') === 'cpf') {
      const revealed = await revealPortalSignerCpf(submissionId)
      if (!revealed.ok) return NextResponse.json({ error: revealed.error }, { status: revealed.httpStatus })
      await logAuditEvent({
        request: req,
        action: 'REVEAL_PORTAL_CPF',
        entity: 'PARTNER_PROPOSAL',
        entityId: submissionId,
        userId: auth.user.id,
        userEmail: auth.user.email ?? null,
        description: `Portal submission ${submissionId}: signer CPF revealed`,
      })
      return NextResponse.json({ cpf: revealed.cpf }, { headers: { 'Cache-Control': 'no-store' } })
    }

    const outcome = await getPortalSubmissionReview(submissionId)
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.httpStatus })
    return NextResponse.json(outcome.review, { headers: { 'Cache-Control': 'no-store' } })
  })
)

export const POST = withRateLimit(30, 60_000)(
  withAuth<{ submissionId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const params = await ctx.params
    const submissionId = params?.submissionId
    if (!submissionId || !UUID_PATTERN.test(submissionId)) {
      return NextResponse.json({ error: 'invalid_submission_id' }, { status: 400 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }
    const decision = parsePortalDecision(body)
    if ('error' in decision) return NextResponse.json({ error: decision.error }, { status: 400 })

    const outcome =
      decision.action === 'approve'
        ? await approvePortalSubmission(submissionId, auth.supabase, auth.user.id)
        : decision.action === 'request_changes'
          ? await requestPortalChanges(submissionId, auth.user.id, decision.note)
          : await rejectPortalSubmission(submissionId, auth.user.id, decision.note)

    if (!outcome.ok) {
      return NextResponse.json(
        { error: outcome.error, attractionId: outcome.attractionId ?? null },
        { status: outcome.httpStatus }
      )
    }

    await logAuditEvent({
      request: req,
      action: AUDIT[decision.action],
      entity: 'PARTNER_PROPOSAL',
      entityId: submissionId,
      userId: auth.user.id,
      userEmail: auth.user.email ?? null,
      description:
        decision.action === 'reject'
          ? `Portal submission ${submissionId} refused (${decision.reason})`
          : decision.action === 'approve'
            ? `Portal submission ${submissionId} approved; place ${outcome.attractionId ?? '?'}`
            : `Portal submission ${submissionId}: changes requested`,
    })

    return NextResponse.json({ ok: true, status: outcome.status, attractionId: outcome.attractionId ?? null })
  })
)
