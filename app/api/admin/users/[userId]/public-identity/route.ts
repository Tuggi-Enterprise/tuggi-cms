/**
 * The public identity of one app account on its record (#1144, BR-USUARIO-051 item 6).
 *
 * `GET`   the display name, the @, the bio, when the moderation last reset each one, and the lock.
 * `PATCH` `{ locked: boolean }` locks or unlocks the edit of the three fields
 *         (`drive.set_public_identity_lock_as`, `p_actor` = the curator). Independent of
 *         `can_publish_routes`, which is the switch next to it (BR-ROTA-006).
 *
 * Admin only, `service_role` on the server: the columns and the lock table have no grant to
 * `authenticated`. `no-store` on the read.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import { readIdentity, setLock, statusOf } from '@/lib/services/public-identity-moderation-service'
import { userIdOf } from '@/lib/public-identity/moderation'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

type Params = { userId: string }

export const GET = withRateLimit(120, 60_000)(
  withAuth<Params>({ roles: ['admin'] }, async (_req, ctx) => {
    const userId = userIdOf((await ctx.params)?.userId)
    if (!userId) return NextResponse.json({ error: 'invalid_user_id' }, { status: 400, headers: NO_STORE })
    const result = await readIdentity(userId)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: statusOf(result.error), headers: NO_STORE })
    return NextResponse.json({ identity: result.value }, { headers: NO_STORE })
  })
)

export const PATCH = withRateLimit(30, 60_000)(
  withAuth<Params>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const userId = userIdOf((await ctx.params)?.userId)
    if (!userId) return NextResponse.json({ error: 'invalid_user_id' }, { status: 400 })

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }
    if (typeof body?.locked !== 'boolean') return NextResponse.json({ error: 'invalid_locked' }, { status: 400 })

    const result = await setLock(userId, body.locked, auth.user.id)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: statusOf(result.error) })

    await logAuditEvent({
      userId: auth.user.id,
      userEmail: auth.user.email,
      action: 'SET_PUBLIC_IDENTITY_LOCK',
      entity: 'USER',
      entityId: userId,
      description: `Edição de nome, @ e bio ${result.value.locked ? 'travada' : 'destravada'} para a conta ${userId}`,
      request: req,
    })
    return NextResponse.json({ locked: result.value.locked })
  })
)
