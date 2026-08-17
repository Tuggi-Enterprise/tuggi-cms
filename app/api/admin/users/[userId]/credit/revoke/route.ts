/**
 * Revoking a grant — BR-MONETIZACAO-053, card #310.
 *
 * `drive.revoke_time_credit` invalidates the row with a reason and lets
 * `drive.get_entitlement` recompute the balance from scratch. Nothing is edited in the
 * ledger and nothing is deleted: revoking removes what the grant credited AND the usage
 * it paid for, in the same move, so minutes already used never come back as balance and
 * never start charging somebody else's grant.
 *
 * Two things the caller cannot get wrong from here:
 *
 * - **The reason is required**, and it is required by the database too (`22023`). It is
 *   immutable once written, which is why the form says not to write personal data in it:
 *   `invalidation_reason` has no FK and account deletion cannot reach inside it.
 * - **Revoking runs on the operator's client**, like granting, so the act has an author.
 *
 * A business outcome (`grant_not_found`, `already_revoked`) arrives inside a 200 with
 * `ok: false` — envelope, not exception. Only the gate raises (`42501`).
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import {
  classifyLedgerError,
  classifyRevokeEnvelope,
  creditErrorStatus,
} from '@/lib/credit/errors'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `invalidation_reason` is immutable; a cap keeps a paste from becoming permanent. */
const MAX_REASON_LENGTH = 500

export const POST = withAuth<{ userId: string }>(
  { roles: ['admin'] },
  async (req, ctx, auth) => {
    const params = await ctx.params
    const userId = params?.userId
    if (!userId || !UUID_RE.test(userId)) {
      return NextResponse.json({ error: { code: 'invalid_user_id' } }, { status: 400 })
    }

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 })
    }

    const grantId = body.grant_id
    if (typeof grantId !== 'string' || !UUID_RE.test(grantId)) {
      return NextResponse.json({ error: { code: 'invalid_grant_id' } }, { status: 400 })
    }

    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason) {
      return NextResponse.json({ error: { code: 'reason_required' } }, { status: 400 })
    }
    if (reason.length > MAX_REASON_LENGTH) {
      return NextResponse.json({ error: { code: 'reason_too_long' } }, { status: 400 })
    }

    const { data, error } = await auth.supabase.schema('drive').rpc('revoke_time_credit', {
      p_reason: reason,
      p_grant_id: grantId,
    })

    if (error) {
      console.error('[credit] revoke refused:', error.code)
      const classified = classifyLedgerError(error, 'revoke')
      return NextResponse.json({ error: classified }, { status: creditErrorStatus(classified) })
    }

    if (!data?.ok) {
      const classified = classifyRevokeEnvelope(data?.reason)
      return NextResponse.json({ error: classified }, { status: creditErrorStatus(classified) })
    }

    await logAuditEvent({
      request: req,
      action: 'REVOKE_TIME_CREDIT',
      entity: 'USER',
      entityId: userId,
      userId: auth.user.id,
      userEmail: auth.cmsUser.email,
      // The reason itself is already in the ledger, with its own retention. Copying it
      // into the audit log would duplicate free text an operator was told not to fill
      // with personal data — one copy is enough to audit, two are two to erase.
      description: `Revoked time credit grant ${grantId} of app user ${userId}.`,
    })

    return NextResponse.json(data)
  }
)
