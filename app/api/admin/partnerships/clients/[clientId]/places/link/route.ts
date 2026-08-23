/**
 * POST /api/admin/partnerships/clients/{clientId}/places/link — `Vincular um local que já existe`.
 *
 * THE OTHER HALF OF BAND 4, and the one that stops the duplicates: `../places` creates a place
 * from the proposal, this one points the client at a place the catalogue already carries. Three
 * of three clients that used the create path got an empty second row beside the establishment
 * that was already published (`lib/partnerships/place-link`), so this is the ordinary act and
 * creating is the exception.
 *
 * IT RE-DECIDES NOTHING AND IT TRUSTS NOTHING. `verdictFor` is the same pure rule the search
 * renders, and it is applied HERE against rows read at this instant: the panel's verdict is
 * minutes old and the operator's tab may have been open all afternoon. A client-side check is a
 * courtesy; this is the gate.
 *
 * IT WRITES ONE COLUMN ON THE CATALOGUE. `partner_client_id`, and nothing else — not `approved`
 * (BR-B2B-011: the triage is a human decision, and a place that was already approved STAYS
 * approved because linking is not a publication), not `priority_level`, not `is_tuggi_partner`
 * (BR-B2B-010, item 6: same treatment as any POI). Linking is a statement about who the place
 * belongs to.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * AND IT ADOPTS THE WELCOME POI, because they were never two facts.
 *
 * `partner.clients.welcome_poi_id` — the POI that plays when somebody lands on `/d/{slug}` —
 * was a second, hand-typed pointer at "this partner's POI", and nothing forced the two to
 * agree. Measured on 2026-08-23: of the 10 clients carrying a `welcome_poi_id`, 10 pointed at a
 * POI that was NOT the client's linked place. The pipeline read `partner_client_id` and
 * reported pendencies about an empty row while the real establishment was on air.
 *
 * So `partner_client_id` is the fact and `welcome_poi_id` follows it: linking the first place
 * writes both. It is written only when the column is EMPTY — `.is('welcome_poi_id', null)` —
 * because BR-B2B-033, item 3, is 1 client : N places, and the second address of the same CNPJ
 * does not silently take over the welcome page the operator chose.
 *
 * The write goes through `service_role`, and it has to: `authenticated` has no `USAGE` on
 * schema `partner` (`42501`), which is the same defect that made the candidate search fall back
 * to a full scan. The route is behind `withAuth({ roles: ['admin'] })`.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'
import { verdictFor, type LinkCandidate } from '@/lib/partnerships/place-link'

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

    const { data, error } = await auth.supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, country, entity_kind, approved, partner_client_id')
      .eq('id', attractionId)
      .maybeSingle()

    if (error) {
      console.error('[partnerships] link lookup failed:', error.message)
      return NextResponse.json({ error: 'lookup_failed' }, { status: 503 })
    }
    if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const row = data as {
      id: string
      name: string
      city: string | null
      state: string | null
      country: string | null
      entity_kind: string
      approved: boolean | null
      partner_client_id: string | null
    }

    const { count, error: coordinateError } = await auth.supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('attraction_id', { count: 'exact', head: true })
      .eq('attraction_id', attractionId)

    if (coordinateError) {
      console.error('[partnerships] coordinate lookup failed:', coordinateError.message)
      return NextResponse.json({ error: 'lookup_failed' }, { status: 503 })
    }

    const candidate: LinkCandidate = {
      attractionId: row.id,
      name: row.name,
      city: row.city,
      state: row.state,
      country: row.country,
      entityKind: row.entity_kind,
      approved: row.approved === true,
      hasCoordinate: (count ?? 0) > 0,
      partnerClientId: row.partner_client_id,
    }

    const verdict = verdictFor(candidate, clientId)
    // Idempotent: linking what is already linked answers 200 and writes nothing, so a double
    // click cannot look like a failure.
    if (verdict.kind === 'already_linked') {
      return NextResponse.json({ ok: true, linked: false, place: candidate })
    }
    if (verdict.kind === 'refused') {
      return NextResponse.json({ error: verdict.reason, place: candidate }, { status: 409 })
    }

    // `.is('partner_client_id', null)` is the race guard, not decoration: two operators on two
    // tabs would otherwise both pass the check above and the second would silently take the
    // place from the first.
    const { data: updated, error: writeError } = await auth.supabase
      .schema('core')
      .from('attractions')
      .update({ partner_client_id: clientId })
      .eq('id', attractionId)
      .is('partner_client_id', null)
      .select('id')

    if (writeError) {
      console.error('[partnerships] link failed:', writeError.message)
      return NextResponse.json({ error: 'link_failed' }, { status: 503 })
    }
    if (!updated || updated.length === 0) {
      // Somebody linked it between the read and the write.
      return NextResponse.json({ error: 'other_owner', place: candidate }, { status: 409 })
    }

    // The welcome POI follows the link — see the header. A failure here does not fail the act:
    // the place IS linked, and the pipeline reads that column, not this one.
    let welcomeAdopted = false
    const { data: clientRow } = await getSupabaseService()
      .schema('partner')
      .from('clients')
      .select('welcome_poi_id')
      .eq('id', clientId)
      .maybeSingle()

    if (clientRow && (clientRow as { welcome_poi_id: string | null }).welcome_poi_id === null) {
      const { data: adopted, error: welcomeError } = await getSupabaseService()
        .schema('partner')
        .from('clients')
        .update({ welcome_poi_id: attractionId })
        .eq('id', clientId)
        .is('welcome_poi_id', null)
        .select('id')

      if (welcomeError) {
        console.error('[partnerships] welcome poi not adopted:', welcomeError.message)
      } else {
        welcomeAdopted = (adopted ?? []).length > 0
      }
    }

    await logAuditEvent({
      request: req,
      action: 'LINK_PARTNER_PLACE',
      entity: 'POI',
      entityId: attractionId,
      userId: auth.user.id,
      userEmail: auth.user.email ?? null,
      description:
        `Existing ${row.entity_kind} ${attractionId} (${row.name}) linked to client ${clientId} ` +
        `as its place, from the partnership pipeline` +
        (welcomeAdopted ? ', and adopted as its welcome POI' : ''),
    })

    return NextResponse.json({
      ok: true,
      linked: true,
      welcomeAdopted,
      place: { ...candidate, partnerClientId: clientId },
    })
  })
)
