/**
 * POST /api/admin/partner-proposals/{submissionId}/promote — the irreversible act.
 *
 * THE PLAN IS REBUILT HERE, FROM THE DATABASE. The panel's plan is a rendering; this one is
 * the decision. The body says only which divergent columns the operator ticked, and a column
 * that is not in the server's plan is not written however the body names it — which is what
 * keeps `commission_rate`, `slug`, `iban` and the rest of `PROMOTION_NEVER_WRITES` out of
 * reach without a denylist doing the work (DS-COMPONENTE-018).
 *
 * THE EDITED VALUES ARRIVE IN `overrides`, AND THEY ARE NOT TRUSTED. The body may name any
 * column; only the ones `PROMOTION_MAP` marks `editable` are honoured, by
 * `resolvePromotionWrite` and not by anything here. `industry` is one of them and also the
 * only one that feeds the plan itself: the category id is English (`restaurant`) and the
 * column is free text read by people, so the panel pre-fills it with the Portuguese label the
 * partner saw. It is not read from `messages/pt.json` here — the copy has one owner, the
 * panel, and the operator always sees what will be written before it is written.
 *
 * LENGTH IS CHECKED HERE TOO, AGAINST THE SAME MAP THE PANEL USES (#679). The panel blocks the
 * button, and this refuses the body: `service_role` ignores RLS and this route is the only
 * barrier left, so "the screen already checked" is not a check. A value that does not fit its
 * column comes back `400 too_long` naming the column and the limit — it is a filling mistake
 * the operator can fix, and it used to be a 503 that said the write might have happened.
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
  lengthViolations,
  resolvePromotionWrite,
  summarizePromotion,
} from '@/lib/partner-form/promotion'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The typed values, filtered to strings. Not filtered by column: `resolvePromotionWrite` reads
 * only the columns the plan produced and only the ones the map calls editable, so a key nobody
 * promotes is a key nobody reads.
 */
function readOverrides(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const overrides: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') overrides[key] = entry
  }
  return overrides
}

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

    const overrides = readOverrides(body.overrides)

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
    // body that can name one: `partner.clients.email` stopped being unique, so the collision the
    // operator used to resolve here does not exist, and a body that could redirect a promotion
    // at an arbitrary client record would be the same door with none of the reason.
    const target = detail.client

    const plan = buildPromotionPlan(answers, target, { categoryLabel: overrides.industry ?? '' })
    const write = resolvePromotionWrite(plan, { approved, overrides })

    if (write.written.length === 0) {
      return NextResponse.json({ error: 'nothing_to_write' }, { status: 400 })
    }

    // A VALUE THAT DOES NOT FIT IS A FILLING MISTAKE, and it is answered before anything is
    // written. One column at a time — the operator fixes what is named, and naming all of them
    // at once is a list nobody reads on a screen that already shows the field.
    const [violation] = lengthViolations(write.updates)
    if (violation) {
      return NextResponse.json(
        { error: 'too_long', column: violation.column, limit: violation.limit },
        { status: 400 }
      )
    }

    const outcome = await promoteProposal({
      submissionId,
      clientId: target?.id ?? null,
      updates: write.updates,
      written: write.written,
      promotedBy: auth.user.id,
      // For the material order, not for `partner.clients` — what lands in the record is
      // `updates`, and only `PROMOTION_MAP` decides that.
      answers,
    })

    if (!outcome.ok) {
      // THREE OUTCOMES, THREE ANSWERS — and until #679 they were one. `write_failed` covered a
      // value that did not fit, a client write that wrote nothing and a claim that failed over a
      // client already on disk, and the screen said the same sentence to all three: "the record
      // may have been created". For two of them that sentence is false, and it sent the operator
      // to look for a record that does not exist before promoting again.
      //
      // `clientWritten` is the fact that separates the last two, and it is the outcome's own
      // `clientId` — never a guess by the screen.
      const status =
        outcome.reason === 'not_promotable' ? 409 : outcome.reason === 'too_long' ? 400 : 503
      console.error(`[partner-proposals] promotion refused: ${outcome.reason}`)

      // THE RESIDUE GETS A ROW. The client is written before the claim (BR-B2B-026: the claim
      // has to name its destination in the same statement), so a refusal here can mean the
      // record already exists in `partner.clients` — with the representative's name, e-mail,
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

      return NextResponse.json(
        { error: outcome.reason, clientWritten: outcome.clientId !== null },
        { status }
      )
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
