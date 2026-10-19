/**
 * Whether an app user may publish a trip as a route : `drive.profiles.can_publish_routes` (#945).
 *
 * `GET`   `{ available, can_publish_routes }`. `available: false` while migration 20261019110000 is
 *         not applied: the column does not exist and the checkbox is not drawn (never an error).
 * `PATCH` `{ enabled: boolean }` turns it on **and off**. Off is the block of an abusive user that
 *         App Store guideline 1.2 requires of an app with user content (BR-ROTA-006).
 *
 * Admin only, and `service_role` on the server: the column has no grant to `authenticated`, so the
 * user cannot turn it on, and the CMS JWT cannot write `drive.profiles` either. Same shape as the
 * credit door next to it (`../credit/route.ts`); `withAuth` is the whole gate of `/api/*`.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'
import { isMissingColumn } from '@/lib/routes/route-publication'

type Params = { userId: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function badRequest(code: string): NextResponse {
  return NextResponse.json({ error: { code } }, { status: 400 })
}

export const GET = withAuth<Params>({ roles: ['admin'] }, async (_req, ctx) => {
  const { userId } = (await ctx.params) as Params
  if (!userId || !UUID_RE.test(userId)) return badRequest('invalid_user_id')

  const { data, error } = await getSupabaseService()
    .schema('drive')
    .from('profiles')
    .select('can_publish_routes')
    .eq('id', userId)
    .maybeSingle()

  if (isMissingColumn(error)) return NextResponse.json({ available: false, can_publish_routes: false })
  if (error) {
    console.error('[route-publishing] read refused:', error.code)
    return NextResponse.json({ error: { code: 'read_failed' } }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: { code: 'user_not_found' } }, { status: 404 })

  return NextResponse.json({ available: true, can_publish_routes: data.can_publish_routes === true })
})

export const PATCH = withAuth<Params>({ roles: ['admin'] }, async (req, ctx, auth) => {
  const { userId } = (await ctx.params) as Params
  if (!userId || !UUID_RE.test(userId)) return badRequest('invalid_user_id')

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return badRequest('invalid_body')
  }
  if (typeof body.enabled !== 'boolean') return badRequest('invalid_enabled')
  const enabled = body.enabled

  const { data, error } = await getSupabaseService()
    .schema('drive')
    .from('profiles')
    .update({ can_publish_routes: enabled })
    .eq('id', userId)
    .select('can_publish_routes')
    .maybeSingle()

  if (isMissingColumn(error)) return NextResponse.json({ error: { code: 'unavailable' } }, { status: 409 })
  if (error) {
    console.error('[route-publishing] write refused:', error.code)
    return NextResponse.json({ error: { code: 'write_failed' } }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: { code: 'user_not_found' } }, { status: 404 })

  await logAuditEvent({
    request: req,
    action: 'SET_ROUTE_PUBLISHING',
    entity: 'USER',
    entityId: userId,
    userId: auth.user.id,
    userEmail: auth.cmsUser.email,
    description: `Route publishing turned ${enabled ? 'on' : 'off'} for app user ${userId}.`,
  })

  return NextResponse.json({ available: true, can_publish_routes: data.can_publish_routes === true })
})
