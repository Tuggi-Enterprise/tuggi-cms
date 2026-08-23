/**
 * POST /api/admin/partnerships/clients/{clientId}/places/welcome — WHICH of this client's
 * places answers `/d/{slug}`.
 *
 * IT ONLY EXISTS FOR THE SECOND PLACE. Linking the first one already adopts it as the welcome
 * POI (`../link`), so a client with one place never comes here. BR-B2B-033, item 3, is
 * 1 client : N places, and when there are several somebody has to say which one greets the
 * tourist — this is that act, and it is the ONLY way `welcome_poi_id` is written by hand now.
 *
 * WHAT IT REPLACED, and why the replacement is narrower on purpose: the `POIs` tab took a UUID
 * pasted into a text field and wrote it with no check at all. Measured on 2026-08-23: of the 10
 * clients carrying a `welcome_poi_id`, 10 pointed at a POI that was NOT the client's place, one
 * of them an `event` the app does not serve as a place in any query. A pointer nobody validates
 * is a pointer that drifts.
 *
 * SO THE GATE IS ONE LINE AND IT IS NOT NEGOTIABLE: the attraction has to be THIS client's
 * place already. Everything `verdictFor` refuses — the wrong kind, the missing coordinate,
 * somebody else's place — was refused at the link, and a row that carries
 * `partner_client_id = clientId` has been through it.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const POST = withRateLimit(20, 60_000)(
  withAuth<{ clientId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const params = await ctx.params
    const clientId = params?.clientId
    if (!clientId || !UUID_PATTERN.test(clientId)) {
      return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
    }

    const body = (await req.json().catch(() => null)) as { attractionId?: string } | null
    const attractionId = body?.attractionId
    if (!attractionId || !UUID_PATTERN.test(attractionId)) {
      return NextResponse.json({ error: 'invalid_attraction_id' }, { status: 400 })
    }

    // Read with the operator's client, the identity the screen belongs to — the same reasoning
    // the link route wrote down.
    const { data, error } = await auth.supabase
      .schema('core')
      .from('attractions')
      .select('id, name, partner_client_id')
      .eq('id', attractionId)
      .maybeSingle()

    if (error) {
      console.error('[partnerships] welcome lookup failed:', error.message)
      return NextResponse.json({ error: 'lookup_failed' }, { status: 503 })
    }
    if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const row = data as { id: string; name: string; partner_client_id: string | null }
    if (row.partner_client_id !== clientId) {
      // Not a rejection of the POI — a statement that the welcome POI is chosen among the
      // client's places, and this is not one of them yet.
      return NextResponse.json({ error: 'not_linked' }, { status: 409 })
    }

    // `service_role`: `authenticated` has no `USAGE` on schema `partner` (`42501`).
    const { error: writeError } = await getSupabaseService()
      .schema('partner')
      .from('clients')
      .update({ welcome_poi_id: attractionId })
      .eq('id', clientId)

    if (writeError) {
      console.error('[partnerships] welcome write failed:', writeError.message)
      return NextResponse.json({ error: 'write_failed' }, { status: 503 })
    }

    await logAuditEvent({
      request: req,
      action: 'SET_PARTNER_WELCOME_POI',
      entity: 'POI',
      entityId: attractionId,
      userId: auth.user.id,
      userEmail: auth.user.email ?? null,
      description: `Place ${attractionId} (${row.name}) is now the welcome POI of client ${clientId}`,
    })

    return NextResponse.json({ ok: true, welcomePoiId: attractionId })
  })
)
