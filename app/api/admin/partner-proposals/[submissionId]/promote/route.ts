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
  loadProposalDetail,
  promoteProposal,
} from '@/lib/services/partner-proposal-admin-service'
import {
  buildPromotionPlan,
  resolvePromotionWrite,
  summarizePromotion,
} from '@/lib/partner-form/promotion'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
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

    // The target is the client this proposal was already promoted into, or nothing — in which
    // case the promotion creates a record. There is no third option and there is no id in the
    // body that can name one: `core.clients.email` stopped being unique, so the collision the
    // operator used to resolve here does not exist, and a body that could redirect a promotion
    // at an arbitrary client record would be the same door with none of the reason.
    const target = detail.client

    const plan = buildPromotionPlan(answers, target, { categoryLabel: industry })
    const write = resolvePromotionWrite(plan, { approved })

    if (write.written.length === 0) {
      return NextResponse.json({ error: 'nothing_to_write' }, { status: 400 })
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

      // THE RESIDUE GETS A ROW. The client is written before the claim (BR-B2B-026: the claim
      // has to name its destination in the same statement), so a refusal here can mean the
      // record already exists in `core.clients` — with the representative's name, e-mail,
      // phone and role, the CNPJ and the address on it — while the proposal is still in the
      // queue. That row has no authorship column, no audit trigger and no unique `tax_id`
      // behind it, so without this event nothing at all says who created it or what it came
      // from. `clientId` is null when the client write is what failed: nothing was written,
      // so there is nothing to trace and no row to write.
      //
      // UUIDS AND THE REASON, NOTHING ELSE. What makes this record worth tracking is exactly
      // what must not be copied into the trail — the audit table is read by more people than
      // the client record is, and a description carrying the answers would put the personal
      // data in a second place while claiming to protect it.
      if (outcome.clientId) {
        await logAuditEvent({
          request: req,
          action: 'PROMOTE_PARTNER_PROPOSAL_UNCLAIMED',
          entity: 'CLIENT',
          entityId: outcome.clientId,
          userId: auth.user.id,
          userEmail: auth.user.email ?? null,
          description: `Client ${outcome.clientId} was written by the promotion of partner proposal ${submissionId}, but the claim was refused (${outcome.reason}). The client record exists with no promotion behind it and the proposal is still in the queue; reconcile the two by hand — promoting again would write a second record.`,
        })
      }

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
