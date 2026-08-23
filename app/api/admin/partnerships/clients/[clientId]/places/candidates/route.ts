/**
 * GET /api/admin/partnerships/clients/{clientId}/places/candidates?q= — the places this partner
 * might already BE.
 *
 * IT EXISTS BECAUSE CREATING WAS THE ONLY PATH, and that produced a duplicate for every one of
 * the three clients that used it (see `lib/partnerships/place-link`). The establishment was
 * already in the catalogue, approved and with a pin; the button made an empty row beside it.
 *
 * IT NEVER FILTERS THE REFUSED ONES OUT. A candidate that cannot be linked comes back WITH its
 * reason: an operator searching for `Tucas` and getting nothing would create the duplicate all
 * over again, while `este é um event, o app não serve eventos como local` is an answer they can
 * act on. Deciding is `verdictFor`, and this route does not re-implement it.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE CLIENT'S CITY IS READ WITH `service_role`, AND THAT IS A DEFECT FIX, NOT A PREFERENCE.
 *
 * Until 2026-08-23 this route read `partner.clients` with the operator's client, and the read
 * failed every single time:
 *
 *     ERROR: 42501: permission denied for schema partner
 *
 * `authenticated` has no `USAGE` on schema `partner`, and policy `clients_select_safe` compares
 * `cms_users.id = auth.uid()`, false for all 15 `cms_users` (measured 2026-08-23). The `error`
 * was discarded, `clientRow` came back `null`, `scopeOf` returned `null`, the scope never
 * reached the `WHERE` — and the search became a `Seq Scan` over 2,646,466 rows: 64 seconds,
 * 57014, and `A busca falhou` in the operator's face. Scoped, the same `ILIKE` costs 10 ms.
 *
 * The route already sits behind `withAuth({ roles: ['admin'] })`, so the asker is an active
 * admin; `service_role` here reads ONE field of ONE client the operator already sees on screen.
 * The CATALOGUE is still read with the operator's own client: unapproved rows are visible
 * through the `CMS admins can read attractions` policy, and answering for an identity that is
 * not the one about to write is how a search shows what the link then refuses.
 *
 * AND THE SCOPE BECAME MANDATORY. Without `city`/`country` there is no indexable query on this
 * table under RLS — `texticlike` is not leakproof, so the trigram index is out of reach and
 * every unscoped `ILIKE` is a scan. The route refuses with `scope_required` instead of taking
 * the database down: the screen can say the registration is missing its city, and the operator
 * fixes that in ten seconds.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  MIN_SEARCH_LENGTH,
  isSearchable,
  verdictFor,
  type LinkCandidate,
} from '@/lib/partnerships/place-link'
import { namePattern } from '@/lib/shared/name-search'
import { DEFAULT_SCOPE, isScopeMode, scopeOf } from '@/lib/partnerships/place-scope'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Enough to choose from without turning the panel into a list nobody reads. */
const RESULT_CAP = 20

/**
 * How many rows the database hands back BEFORE the final cut, and why it is more than
 * `RESULT_CAP`.
 *
 * The ordering happens in memory over what came back (see the end of the route), so cutting at
 * 20 in the `LIMIT` would drop the published result off the page whenever 20 namesakes arrive
 * first. The scope already reduced this to dozens, so asking for triple costs almost nothing.
 */
const SEARCH_CAP = RESULT_CAP * 3

interface CandidateRow {
  id: string
  name: string
  city: string | null
  state: string | null
  country: string | null
  entity_kind: string
  approved: boolean | null
  partner_client_id: string | null
}

export const GET = withRateLimit(60, 60_000)(
  withAuth<{ clientId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const params = await ctx.params
    const clientId = params?.clientId
    if (!clientId || !UUID_PATTERN.test(clientId)) {
      return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
    }

    const params_ = new URL(req.url).searchParams
    const rawScope = params_.get('scope')
    const mode = isScopeMode(rawScope) ? rawScope : DEFAULT_SCOPE
    const term = (params_.get('q') ?? '').trim()
    if (!isSearchable(term)) {
      // Not an error: the panel opens empty and says how many characters it needs.
      return NextResponse.json({ candidates: [], scope: null, minLength: MIN_SEARCH_LENGTH })
    }

    // `service_role`, and the reason is in the header: with the operator's client this read
    // fails on `permission denied for schema partner` and the scope vanishes silently.
    const { data: clientRow, error: clientError } = await getSupabaseService()
      .schema('partner')
      .from('clients')
      .select('city, country, state')
      .eq('id', clientId)
      .maybeSingle()

    if (clientError) {
      console.error('[partnerships] client scope lookup failed:', clientError.message)
      return NextResponse.json({ error: 'scope_unavailable' }, { status: 503 })
    }

    const client = (clientRow ?? null) as {
      city: string | null
      country: string | null
      state: string | null
    } | null
    const scope = scopeOf({
      city: client?.city ?? null,
      country: client?.country ?? null,
      state: client?.state ?? null,
    })

    /**
     * NO SCOPE, NO SEARCH, and the refusal is deliberate.
     *
     * `country` is the least `idx_attractions_geo_search (country, state, city)` accepts;
     * without it the planner only has the scan. Answering `scope_required` tells the operator
     * what is missing — the city on the client's registration — instead of hanging the screen
     * for 64 s and answering 503.
     */
    if (!scope || !scope.country) {
      return NextResponse.json(
        { candidates: [], scope: null, minLength: MIN_SEARCH_LENGTH, error: 'scope_required' },
        { status: 200 }
      )
    }

    /**
     * THE NAME IS MATCHED AS A REGEX, blind to accent, to case and to punctuation — see
     * `namePattern`. `ILIKE` compared bytes, so `Faella Bistro` did not find `Faella Bistrô`
     * and neither did `Faella Bistrô` when the row was written in the other Unicode
     * normalisation. The operator who cannot find the establishment creates it again.
     *
     * The pattern never contains a regex metacharacter or a comma of the operator's own, so
     * there is nothing to escape for PostgREST's filter grammar either.
     */
    let query = auth.supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, country, entity_kind, approved, partner_client_id')
      .in('entity_kind', ['place', 'poi', 'event'])
      // `.filter(...)` e não `.imatch(...)`: o método existe na TIPAGEM de `postgrest-js`
      // 2.110.0 e NÃO existe no objeto em runtime —
      // `auth.supabase.schema(...).from(...).select(...).in(...).imatch is not a function`,
      // 500 na cara do operador. `filter` monta o mesmo `name=imatch.<padrão>` e está lá desde
      // sempre; o servidor suporta o operador, o cliente é que não tem o atalho.
      .filter('name', 'imatch', namePattern(term))
      .eq('country', scope.country)

    // `all` is the operator deliberately asking beyond the city — and there the scope stays
    // country and state, which is what keeps the query on the index.
    if (scope.state) query = query.eq('state', scope.state)
    if (mode === 'city') query = query.eq('city', scope.city)

    const { data, error } = await query.limit(SEARCH_CAP)

    if (error) {
      console.error('[partnerships] candidate search failed:', error.message)
      return NextResponse.json({ error: 'search_failed' }, { status: 503 })
    }

    const rows = (data ?? []) as CandidateRow[]

    const ids = rows.map((row) => row.id)

    // One lookup for the whole page, not one per row: the coordinate decides the verdict, and
    // N+1 over a panel the operator types into is a request per keystroke per row.
    const pinned = new Set<string>()
    if (ids.length > 0) {
      const { data: coordinates } = await auth.supabase
        .schema('core')
        .from('attraction_coordinate')
        .select('attraction_id')
        .in('attraction_id', ids)
      for (const row of (coordinates ?? []) as { attraction_id: string }[]) {
        pinned.add(row.attraction_id)
      }
    }

    const all = rows.map((row) => {
      const candidate: LinkCandidate = {
        attractionId: row.id,
        name: row.name,
        city: row.city,
        state: row.state,
        country: row.country,
        entityKind: row.entity_kind,
        approved: row.approved === true,
        hasCoordinate: pinned.has(row.id),
        partnerClientId: row.partner_client_id,
      }
      return { ...candidate, verdict: verdictFor(candidate, clientId) }
    })

    // Published first, then by name — in memory, over the dozens that came back. As an
    // `ORDER BY` this cost the whole table scan.
    const candidates = all
      .slice()
      .sort((left, right) => {
        if (left.approved !== right.approved) return left.approved ? -1 : 1
        return left.name.localeCompare(right.name)
      })
      .slice(0, RESULT_CAP)

    return NextResponse.json({
      candidates,
      // The city as the CLIENT wrote it: that is what the screen shows, and showing the `slug`
      // would make the operator read `cabo frio` over a registration that says `Cabo Frio`.
      scope: scope.city,
      minLength: MIN_SEARCH_LENGTH,
    })
  })
)
