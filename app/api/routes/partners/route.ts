import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import type { RoutePartner } from '@/lib/routes/route-ownership'

/**
 * `/api/routes/partners` — the partners a route can belong to (#792), `core.custom_route_partners`.
 *
 * Same gate and same client as `../[id]/route.ts`: the editor of `/routes` opens for `admin` and
 * `client`, and the cookie client keeps the table's RLS underneath — SELECT for any active CMS
 * operator, writes for platform admin only. Creating a partner is admin-only here too, so a
 * `client` gets a 403 instead of a raw RLS error.
 *
 * Public attribution only (name, short description, optional logo): the table has no contact
 * field by design. The logo is not set from the CMS yet.
 */

export const dynamic = 'force-dynamic'

const COLUMNS = 'id, name, short_description, logo_url'
const NAME_MAX = 120
const SHORT_DESCRIPTION_MAX = 280

export const GET = withAuth({ roles: ['admin', 'client'] }, async (_req: NextRequest, _ctx, auth) => {
  const { data, error } = await auth.supabase
    .schema('core')
    .from('custom_route_partners')
    .select(COLUMNS)
    .order('name', { ascending: true })

  if (error) {
    console.error('GET /api/routes/partners error:', error)
    return NextResponse.json({ error: error.message, code: error.code }, { status: 500 })
  }

  return NextResponse.json({ partners: (data ?? []) as RoutePartner[] })
})

export const POST = withAuth({ roles: ['admin'] }, async (req: NextRequest, _ctx, auth) => {
  const body = await req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const rawDescription = typeof body?.short_description === 'string' ? body.short_description.trim() : ''

  if (name.length < 1 || name.length > NAME_MAX) {
    return NextResponse.json({ error: `name must have 1 to ${NAME_MAX} characters` }, { status: 400 })
  }
  if (rawDescription.length > SHORT_DESCRIPTION_MAX) {
    return NextResponse.json(
      { error: `short_description must have at most ${SHORT_DESCRIPTION_MAX} characters` },
      { status: 400 }
    )
  }

  const { data, error } = await auth.supabase
    .schema('core')
    .from('custom_route_partners')
    .insert({ name, short_description: rawDescription || null })
    .select(COLUMNS)
    .single()

  if (error) {
    console.error('POST /api/routes/partners error:', error)
    return NextResponse.json({ error: error.message, code: error.code }, { status: 500 })
  }

  return NextResponse.json({ partner: data as RoutePartner }, { status: 201 })
})
