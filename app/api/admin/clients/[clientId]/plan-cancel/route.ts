/**
 * GET  /api/admin/clients/[clientId]/plan-cancel?attractionId= — what cancelling would do (plan,
 *      the day the story and photos leave, the exit fee). Writes nothing.
 * POST /api/admin/clients/[clientId]/plan-cancel { attractionId, expectedFeeCents } — cancels.
 *
 * #1054, BR-B2B-060 (support edge case): the partner asked in writing and a CMS admin cancels. Admin
 * only here (403), and again in `places-payment` (the token) and in the database
 * (`partner.support_cancel_place_plan`). The operator is the session's, never the body's.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import { callSupportCancel } from '@/lib/services/place-plan-cancel-service'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function accessTokenOf(supabase: any): Promise<string | null> {
  // `withAuth` already proved the user with `getUser()`; the token only travels, and the function
  // proves it again against the Auth server.
  const { data } = await supabase.auth.getSession()
  return typeof data?.session?.access_token === 'string' ? data.session.access_token : null
}

export const GET = withAuth<{ clientId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
  const clientId = (await ctx.params)?.clientId
  const attractionId = req.nextUrl.searchParams.get('attractionId')
  if (!clientId || !UUID_PATTERN.test(clientId)) return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
  if (!attractionId || !UUID_PATTERN.test(attractionId)) return NextResponse.json({ error: 'invalid_attraction_id' }, { status: 400 })
  const token = await accessTokenOf(auth.supabase)
  if (!token) return NextResponse.json({ error: 'relogin' }, { status: 401 })
  const r = await callSupportCancel('support_cancel_quote', { clientId, attractionId }, token)
  return NextResponse.json(r.body, { status: r.status })
})

export const POST = withRateLimit(10, 60_000)(
  withAuth<{ clientId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const clientId = (await ctx.params)?.clientId
    if (!clientId || !UUID_PATTERN.test(clientId)) return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }
    const attractionId = typeof body.attractionId === 'string' ? body.attractionId : ''
    if (!UUID_PATTERN.test(attractionId)) return NextResponse.json({ error: 'invalid_attraction_id' }, { status: 400 })
    const fee = body.expectedFeeCents
    if (!(Number.isInteger(fee) && (fee as number) >= 0)) return NextResponse.json({ error: 'invalid_expected_fee_cents' }, { status: 400 })
    const token = await accessTokenOf(auth.supabase)
    if (!token) return NextResponse.json({ error: 'relogin' }, { status: 401 })

    const r = await callSupportCancel('support_cancel', { clientId, attractionId, expectedFeeCents: fee as number }, token)
    if (r.status === 200) {
      await logAuditEvent({
        request: req,
        action: 'SUPPORT_CANCEL_PLACE_PLAN',
        entity: 'CLIENT',
        entityId: clientId,
        userId: auth.user.id,
        userEmail: auth.user.email ?? null,
        description: `Paid plan of place ${attractionId} cancelled by the support (${String(r.body.result)}, provider ${String(r.body.provider)})`,
      })
    }
    return NextResponse.json(r.body, { status: r.status })
  })
)
