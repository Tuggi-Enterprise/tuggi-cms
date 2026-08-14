/**
 * POST /api/admin/partner-proposals/{submissionId}/promote — the irreversible act.
 *
 * THE PLAN IS REBUILT HERE, FROM THE DATABASE. The panel's plan is a rendering; this one is
 * the decision. The body says only which divergent columns the operator ticked, and a column
 * that is not in the server's plan is not written however the body names it — which is what
 * keeps `commission_rate`, `slug`, `iban` and the rest of `PROMOTION_NEVER_WRITES` out of
 * reach without a denylist doing the work (DS-COMPONENTE-018).
 *
 * `industry` is the one editable value, and it arrives from the operator: the category id is
 * English (`restaurant`) and the column is free text read by people, so the panel pre-fills
 * it with the Portuguese label the partner saw and lets the operator adjust it. It is not
 * read from `messages/pt.json` here — the copy has one owner, the panel, and the operator can
 * always see what will be written before it is written.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import {
  findClientByEmail,
  loadClient,
  loadProposalDetail,
  promoteProposal,
} from '@/lib/services/partner-proposal-admin-service'
import {
  buildPromotionPlan,
  resolvePromotionWrite,
  summarizePromotion,
} from '@/lib/partner-form/promotion'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const INDUSTRY_MAX = 120

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

    const approved = Array.isArray(body.approved)
      ? body.approved.filter((column): column is string => typeof column === 'string')
      : []

    const industry = typeof body.industry === 'string' ? body.industry.trim() : ''
    if (industry.length > INDUSTRY_MAX) {
      return NextResponse.json({ error: 'invalid_industry' }, { status: 400 })
    }

    const detail = await loadProposalDetail(submissionId)
    if (!detail) {
      return NextResponse.json({ error: 'proposal_not_found' }, { status: 404 })
    }
    if (detail.submission.status !== 'submitted') {
      // A draft is still being typed and a promoted one is done. Neither is an error the
      // operator caused, so the code says which it is and the screen says it in words.
      return NextResponse.json(
        { error: 'not_promotable', status: detail.submission.status },
        { status: 409 }
      )
    }

    const answers = detail.submission.answers ?? {}
    const representativeEmail = (answers.representative_email ?? '').trim()
    const holder = representativeEmail ? await findClientByEmail(representativeEmail) : null

    // THE TWO WAYS OUT OF THE UNIQUE-EMAIL COLLISION, and neither of them is free text.
    // `linkClientId` is only honoured when it names the client that ACTUALLY holds that
    // e-mail: the operator resolved a specific collision, so an id typed into the body cannot
    // redirect the promotion at some other client's record.
    const linkClientId = typeof body.linkClientId === 'string' ? body.linkClientId : null
    if (linkClientId && (!holder || holder.id !== linkClientId)) {
      return NextResponse.json({ error: 'invalid_link_client' }, { status: 409 })
    }

    const emailOverride =
      typeof body.emailOverride === 'string' ? body.emailOverride.trim().toLowerCase() : ''
    if (emailOverride && !EMAIL_PATTERN.test(emailOverride)) {
      return NextResponse.json({ error: 'invalid_email_override' }, { status: 400 })
    }

    const target = linkClientId ? await loadClient(linkClientId) : detail.client
    if (linkClientId && !target) {
      return NextResponse.json({ error: 'invalid_link_client' }, { status: 409 })
    }

    const plan = buildPromotionPlan(answers, target, { categoryLabel: industry })
    const write = resolvePromotionWrite(plan, { approved })

    // The override replaces the value the plan carries; it does not add a column. A body that
    // names an e-mail for a promotion that was not going to write one changes nothing.
    if (emailOverride && write.updates.email) write.updates.email = emailOverride

    if (write.written.length === 0) {
      return NextResponse.json({ error: 'nothing_to_write' }, { status: 400 })
    }

    // The collision is resolved before the button appears; reaching here with one means the
    // record changed under the operator, so the answer is the choice again and never a 23505.
    const targetEmail = write.updates.email
    if (targetEmail) {
      const existing = await findClientByEmail(targetEmail)
      if (existing && existing.id !== target?.id) {
        return NextResponse.json(
          { error: 'email_taken', client: { id: existing.id, name: existing.name } },
          { status: 409 }
        )
      }
    }

    const outcome = await promoteProposal({
      submissionId,
      clientId: target?.id ?? null,
      updates: write.updates,
      written: write.written,
      promotedBy: auth.user.id,
    })

    if (!outcome.ok) {
      const status = outcome.reason === 'not_promotable' ? 409 : 503
      console.error(`[partner-proposals] promotion refused: ${outcome.reason}`)
      return NextResponse.json({ error: outcome.reason }, { status })
    }

    await logAuditEvent({
      request: req,
      action: 'PROMOTE_PARTNER_PROPOSAL',
      entity: 'CLIENT',
      entityId: outcome.clientId,
      userId: auth.user.id,
      userEmail: auth.user.email ?? null,
      description: `Partner proposal ${submissionId} promoted into client ${outcome.clientId} (${outcome.created ? 'created' : 'updated'}): ${write.written.join(', ')}`,
    })

    return NextResponse.json({
      ok: true,
      clientId: outcome.clientId,
      created: outcome.created,
      written: write.written,
      kept: write.kept,
      summary: summarizePromotion(plan, { approved }),
    })
  })
)
