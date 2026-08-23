/**
 * GET /api/admin/partnerships/clients/{clientId}/places/candidates?q= — the places this partner
 * might already BE.
 *
 * IT EXISTS BECAUSE CREATING WAS THE ONLY PATH, and that produced a duplicate for every one of
 * the three clients that used it (see `lib/partnerships/place-link`). The establishment was
 * already in the catalogue, approved and with a pin; the button made an empty row beside it.
 *
 * IT READS WITH THE OPERATOR'S CLIENT and not `service_role`. Unapproved rows are visible
 * through the `CMS admins can read attractions` policy, and asking with `service_role` would
 * answer for an identity that is not the one about to write — the same reasoning
 * `applyPartnerApprovalEffects` wrote down.
 *
 * IT NEVER FILTERS THE REFUSED ONES OUT. A candidate that cannot be linked comes back WITH its
 * reason: an operator searching for `Tucas` and getting nothing would create the duplicate all
 * over again, while `este é um event, o app não serve eventos como local` is an answer they can
 * act on. Deciding is `verdictFor`, and this route does not re-implement it.
 *
 * O RECORTE É A CIDADE DO CLIENTE, e ele é aplicado DEPOIS da busca, de propósito. Filtrar no
 * `WHERE` seria mais barato e deixaria a rota sem saber quantos ficaram de fora — e um recorte
 * que devolve lista vazia sem dizer que existe algo além dela é a mesma armadilha de não ter
 * busca nenhuma. Por que a cidade e não `country`/`state`, e por que por `slug`, está em
 * `lib/partnerships/place-scope`: os dois lados guardam localização em padrões diferentes, e a
 * igualdade nos três campos devolveria zero para 11 dos 16 clientes.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import {
  MIN_SEARCH_LENGTH,
  isSearchable,
  verdictFor,
  type LinkCandidate,
} from '@/lib/partnerships/place-link'
import { DEFAULT_SCOPE, isScopeMode, scopeOf } from '@/lib/partnerships/place-scope'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Enough to choose from without turning the panel into a list nobody reads. */
const RESULT_CAP = 20

/**
 * Quantas linhas o banco entrega ANTES do recorte, e é por isso que é mais que `RESULT_CAP`.
 *
 * O recorte roda depois da consulta (ver o cabeçalho), então cortar em 20 no `LIMIT` deixaria o
 * único resultado da cidade do parceiro cair fora da página quando 20 homônimos de outros
 * lugares chegam primeiro — a busca responderia `nenhum em Cabo Frio` sobre um bar que está lá.
 * O `ilike` já foi reduzido pelo índice trigram, então pedir o triplo custa quase nada.
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

    // A cidade do cliente é o recorte. Lida com o client do operador, como o resto da rota.
    const { data: clientRow } = await auth.supabase
      .schema('partner')
      .from('clients')
      .select('city, country, state')
      .eq('id', clientId)
      .maybeSingle()

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
     * O RECORTE VAI PARA O `WHERE`, e é o que faz esta rota responder — ver o cabeçalho de
     * `place-scope` para os números. Sem ele, e com o `ORDER BY approved DESC` que estava aqui,
     * a busca varria 2.646.463 linhas aplicando o `OR` das 12 policies de RLS em cada uma:
     * 64 segundos, e 57014 na cara do operador.
     *
     * SEM `ORDER BY`, DE PROPÓSITO. Ordenar por `approved` dava ao planner a saída de percorrer
     * `idx_attractions_approved` inteiro em vez de usar `idx_attractions_geo_search`, e ele
     * pegava a saída. A ordem é decidida depois, sobre as dezenas de linhas que voltam.
     */
    let query = auth.supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, country, entity_kind, approved, partner_client_id')
      .in('entity_kind', ['place', 'poi', 'event'])
      .ilike('name', `%${term}%`)

    // Só no modo recortado: `all` é o operador pedindo o catálogo inteiro de propósito, e aí a
    // lentidão é escolha dele — mas o `LIMIT` continua segurando o custo.
    if (scope && mode === 'city') {
      if (scope.country) query = query.eq('country', scope.country)
      if (scope.state) query = query.eq('state', scope.state)
      query = query.eq('city', scope.city)
    }

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

    // Publicados primeiro, depois por nome — em memória, sobre as dezenas que voltaram. No
    // `ORDER BY` isto custava a varredura inteira da tabela.
    const candidates = all
      .slice()
      .sort((left, right) => {
        if (left.approved !== right.approved) return left.approved ? -1 : 1
        return left.name.localeCompare(right.name)
      })
      .slice(0, RESULT_CAP)

    return NextResponse.json({
      candidates,
      // A cidade como o CLIENTE a escreveu: é o que a tela mostra, e mostrar o `slug` faria o
      // operador ler `cabo frio` sobre um cadastro que diz `Cabo Frio`.
      scope: scope ? scope.city : null,
      minLength: MIN_SEARCH_LENGTH,
    })
  })
)
