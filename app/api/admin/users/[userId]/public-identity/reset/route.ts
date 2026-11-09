/**
 * POST /api/admin/users/[userId]/public-identity/reset `{ field }` (#1144, BR-USUARIO-051 item 5).
 *
 * `drive.reset_public_identity_as` with `p_actor` = the curator: the display name and the @ go back
 * to a generated name, the bio goes empty. It does not pass the filter, does not count toward the
 * limit, works on a locked account, and the removed @ is blocked forever without redirect. The
 * open reports of the field close as removed.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import { resetField, statusOf } from '@/lib/services/public-identity-moderation-service'
import { isPublicIdentityField, userIdOf } from '@/lib/public-identity/moderation'

export const dynamic = 'force-dynamic'

export const POST = withRateLimit(30, 60_000)(
  withAuth<{ userId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const userId = userIdOf((await ctx.params)?.userId)
    if (!userId) return NextResponse.json({ error: 'invalid_user_id' }, { status: 400 })

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }
    const field = body?.field
    if (!isPublicIdentityField(field)) return NextResponse.json({ error: 'invalid_field' }, { status: 400 })

    const result = await resetField(userId, field, auth.user.id)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: statusOf(result.error) })

    // Neither the old value nor the new one in the trail: the account and the field are enough.
    await logAuditEvent({
      userId: auth.user.id,
      userEmail: auth.user.email,
      action: 'RESET_PUBLIC_IDENTITY',
      entity: 'USER',
      entityId: userId,
      description: `Campo ${field} redefinido pela moderação; ${result.value.reportsClosed} denúncia(s) fechada(s)`,
      request: req,
    })
    return NextResponse.json({ outcome: result.value })
  })
)
