/**
 * DELETE /api/admin/partner-invites/{inviteId} — switches a live link off.
 *
 * Revoking exists because the e-mail can have gone to the wrong address. It touches the
 * invite and nothing else: what the establishment already filled in stays where it is, and
 * the screen says that before the click.
 *
 * A consumed link has nothing to revoke, so the answer is 409 and not a silent 200 — a
 * button that changes nothing is worse than an absent one.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { revokeInvite } from '@/lib/services/partner-proposal-admin-service'
import { logAuditEvent } from '@/lib/services/audit-service'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const DELETE = withRateLimit(30, 60_000)(
  withAuth<{ inviteId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const params = await ctx.params
    const inviteId = params?.inviteId
    if (!inviteId || !UUID_PATTERN.test(inviteId)) {
      return NextResponse.json({ error: 'invalid_invite_id' }, { status: 400 })
    }

    const revoked = await revokeInvite(inviteId)
    if (!revoked) {
      return NextResponse.json({ error: 'invite_not_revocable' }, { status: 409 })
    }

    await logAuditEvent({
      request: req,
      action: 'REVOKE_PARTNER_INVITE',
      entity: 'PARTNER_PROPOSAL',
      entityId: inviteId,
      userId: auth.user.id,
      userEmail: auth.user.email ?? null,
      // No address and no token: the trail records the act, not the credential.
      description: 'Partner form invite revoked',
    })

    return NextResponse.json({ ok: true })
  })
)
