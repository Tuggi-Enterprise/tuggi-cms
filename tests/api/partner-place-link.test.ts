/**
 * LINKING A PLACE THAT ALREADY EXISTS — the writer band 4 said it did not have. #409.
 *
 * THE DEFECT THIS CLOSES WAS MEASURED, on 2026-08-23, over every client that used
 * `Criar o local a partir da proposta`. All three already had their establishment in the
 * catalogue, approved and with a pin; the button made a second, empty row beside it:
 *
 *   BAIRES BISTRO       `Baires Bistrô` (aprovado, com pin)  +  `BAIRES BISTRO` (sem pin, 0 TP)
 *   Tucas               `Tucas Empório Bistrô` (1 TP)        +  `Tucas` (sem pin, 0 TP)
 *   CAFETERIA ENCONTROS `Cafeteria Encontros` (com pin)      +  `CAFETERIA ENCONTROS` (sem pin)
 *
 * `welcome_poi_id` pointed at the real one and `partner_client_id` at the empty one, so the
 * pipeline read the empty one and reported pendencies about a place nobody would ever fix.
 *
 * Mutations that turn this suite red:
 *  · linking an `event`, which `core.app_get_nearby_places` does not carry — the measured case
 *    is one client whose welcome POI is a FESTIVAL;
 *  · linking a place with no coordinate, which is the same dead end the create path falls into;
 *  · linking a place that already belongs to another client (BR-B2B-033, item 3, is
 *    1 client : N places, never N clients : 1 place);
 *  · letting the link write anything but `partner_client_id` — approving on link would hand the
 *    triage to a search box (BR-B2B-011);
 *  · dropping the `.is('partner_client_id', null)` race guard;
 *  · searching on fewer than three characters, which degenerates the trigram index into the
 *    scan that produced the 57014 timeouts.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { DEFAULT_SCOPE, isScopeMode, scopeOf } from '@/lib/partnerships/place-scope'
import {
  LINKABLE_KINDS,
  MIN_SEARCH_LENGTH,
  canLink,
  isSearchable,
  verdictFor,
  type LinkCandidate,
} from '@/lib/partnerships/place-link'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

/** The source without its comments — a ruler that reads prose measures the prose. */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const CLIENT = '44444444-4444-4444-4444-444444444444'
const OTHER = '55555555-5555-5555-5555-555555555555'

function candidate(overrides: Partial<LinkCandidate> = {}): LinkCandidate {
  return {
    attractionId: '77777777-7777-7777-7777-777777777777',
    name: 'Tucas Empório Bistrô',
    city: 'Cabo Frio',
    state: 'RJ',
    country: 'BR',
    entityKind: 'place',
    approved: true,
    hasCoordinate: true,
    partnerClientId: null,
    ...overrides,
  }
}

// ── What may be linked ───────────────────────────────────────────────────────────────────────

test('#409 · the ordinary case: an establishment the catalogue already carries', () => {
  assert.deepEqual(verdictFor(candidate(), CLIENT), { kind: 'ok' })
  assert.equal(canLink(candidate(), CLIENT), true)

  // A `poi` is in on purpose and is the COMMON case: a restaurant catalogued years before it
  // became a partner is a `poi`, and refusing it sends the operator back to the duplicate.
  assert.deepEqual(verdictFor(candidate({ entityKind: 'poi' }), CLIENT), { kind: 'ok' })
  assert.deepEqual(LINKABLE_KINDS, ['place', 'poi'])

  // Not yet approved is fine: linking is not publishing, and the triage is a separate human
  // decision (BR-B2B-011).
  assert.deepEqual(verdictFor(candidate({ approved: false }), CLIENT), { kind: 'ok' })
})

test('#409 · an event is refused — the app does not serve one as a partner’s place', () => {
  // The measured case: one client's `welcome_poi_id` is `Festival Sabores de Cabo Frio`.
  // `core.app_get_nearby_places` reads `entity_kind = 'place'` and `core.app_poi_read` carries
  // POIs; neither carries events, so it was linked, served nobody, and nothing said so.
  assert.deepEqual(verdictFor(candidate({ entityKind: 'event' }), CLIENT), {
    kind: 'refused',
    reason: 'wrong_kind',
  })
})

test('#409 · no coordinate is refused — it is the same dead end the create path falls into', () => {
  // `buildPlaceReadiness` classes `coordinate` as `blocks_app`, so linking one would choose the
  // exact state the three duplicates are stuck in.
  assert.deepEqual(verdictFor(candidate({ hasCoordinate: false }), CLIENT), {
    kind: 'refused',
    reason: 'no_coordinate',
  })
})

test('#409 · BR-B2B-033 item 3: one place has ONE owner', () => {
  assert.deepEqual(verdictFor(candidate({ partnerClientId: OTHER }), CLIENT), {
    kind: 'refused',
    reason: 'other_owner',
  })

  // Already this client's: a no-op, never an error. A double click must not read as a failure.
  assert.deepEqual(verdictFor(candidate({ partnerClientId: CLIENT }), CLIENT), {
    kind: 'already_linked',
  })
})

test('#409 · ownership is decided BEFORE the rest, so a linked row is never re-refused', () => {
  // A place linked last week whose pin was later removed answers `already_linked`, not
  // `no_coordinate` — refusing something that already happened reads as a broken screen.
  assert.deepEqual(
    verdictFor(candidate({ partnerClientId: CLIENT, hasCoordinate: false, entityKind: 'event' }), CLIENT),
    { kind: 'already_linked' }
  )
})

// ── The search ───────────────────────────────────────────────────────────────────────────────

test('#409 · the search refuses to run on a term that would scan 2.2 M rows', () => {
  assert.equal(MIN_SEARCH_LENGTH, 3)
  assert.equal(isSearchable('tu'), false)
  assert.equal(isSearchable('  a  '), false)
  assert.equal(isSearchable('tuc'), true)
  // `name ILIKE '%q%'` is answered by `idx_attractions_name_trgm` (GIN trigram), measured at
  // 128 ms / 704 buffers for a 9-character term. One or two characters degenerate it into the
  // scan that produced the 57014 timeouts on `cms_search_pois`.
})

// ── O recorte: a cidade do cliente ───────────────────────────────────────────────────────────

/**
 * OS DOIS LADOS FALAVAM DIALETOS DIFERENTES, e é isso que decide o desenho do recorte.
 *
 * `core.attractions` guarda o canônico de `location-normalize` (`Brazil`, `Rio de Janeiro`);
 * `partner.clients` guardava o que o parceiro digitou (`BR`, `RJ`, `barueri`). Medido em
 * 2026-08-23 sobre os 16 clientes, um filtro de igualdade em `country AND state AND city`
 * devolvia **zero para 11 deles** — e zero resultado é exatamente o que faz o operador criar a
 * duplicata que a busca existe para impedir.
 */
/**
 * O RECORTE É O `WHERE`, E ISSO É PERFORMANCE — medido em 2026-08-23 sob o role `authenticated`
 * que a rota realmente usa, contra os 2,6 milhões de linhas de `core.attractions`:
 *
 *   sem recorte, com `ORDER BY approved DESC`   64.030 ms   211.606 buffers   57014 (timeout)
 *   `country` + `state`                          1.413 ms     7.949 buffers
 *   `country` + `state` + `city`                     5 ms       233 buffers
 *
 * Duas causas somadas. O `ORDER BY approved DESC` dava ao planner a saída de varrer
 * `idx_attractions_approved` de ponta a ponta em vez do índice trigram — 2.646.463 linhas
 * removidas por filtro. E `core.attractions` carrega 12 policies permissivas de SELECT, que o
 * Postgres combina num `OR` com `EXISTS` sobre `cms_users` dentro: nenhuma é indexável, e cada
 * linha varrida paga o predicado inteiro. Como `postgres`, sem RLS, a mesma busca custava
 * 128 ms — o que mede o RLS, não a busca.
 */
test('#409 · o escopo carrega os três campos que vão para o índice geo', () => {
  const scope = scopeOf({ city: '  Cabo Frio ', country: 'Brazil', state: 'Rio de Janeiro' })
  assert.deepEqual(scope, {
    city: 'Cabo Frio',
    key: 'cabo frio',
    country: 'Brazil',
    state: 'Rio de Janeiro',
  })

  // País sem divisão preenchida — `Tasca das Tias`, em Portugal — recorta pelo que tem.
  assert.deepEqual(scopeOf({ city: 'Angra do Heroísmo', country: 'Portugal', state: null }), {
    city: 'Angra do Heroísmo',
    key: 'angra do heroismo',
    country: 'Portugal',
    state: null,
  })

  // Campo em branco é o mesmo que ausente: um `.eq('state', '')` não casaria com nada.
  assert.equal(scopeOf({ city: 'X', country: '  ', state: '' })!.country, null)
})

test('#409 · sem cidade não há recorte, e o catálogo inteiro é a resposta honesta', () => {
  // 8 dos 16 clientes tinham `country`, `state` e `city` nulos. Recortar por um campo vazio
  // devolveria nada, e nada é a resposta que produz a duplicata.
  assert.equal(scopeOf({ city: null }), null)
  assert.equal(scopeOf({ city: '   ' }), null)
})

test('#409 · a busca abre recortada, e um `scope` inválido não vira busca global', () => {
  assert.equal(DEFAULT_SCOPE, 'city')
  assert.equal(isScopeMode('city'), true)
  assert.equal(isScopeMode('all'), true)
  for (const bogus of ['country', 'state', '', null, undefined, 1]) {
    assert.equal(isScopeMode(bogus), false)
  }
})

test('#409 · the scope goes into the `WHERE`, and it is mandatory', () => {
  const search = code('app/api/admin/partnerships/clients/[clientId]/places/candidates/route.ts')

  // The three columns of `idx_attractions_geo_search (country, state, city)`. `city` only in
  // the scoped mode: `all` is the operator deliberately asking beyond the city, and there the
  // country and the state are what keep the query on the index.
  assert.match(search, /\.eq\('country', scope\.country\)/)
  assert.match(search, /query\.eq\('state', scope\.state\)/)
  assert.match(search, /if \(mode === 'city'\) query = query\.eq\('city', scope\.city\)/)

  // NO SCOPE, NO SEARCH. An unscoped `ILIKE` on this table under RLS is a `Seq Scan` over
  // 2.6 M rows — 64 s and 57014 — because `texticlike` is not leakproof and the trigram index
  // cannot be an index condition below the security quals. The route refuses instead.
  assert.match(search, /error: 'scope_required'/)
  assert.match(search, /if \(!scope \|\| !scope\.country\)/)

  // THE `ORDER BY approved DESC` IS WHAT CAUSED THE TIMEOUT: it gave the planner the option of
  // walking `idx_attractions_approved` end to end instead of the geo index, and it took it. The
  // order is decided in memory, over the dozens of rows that come back.
  assert.equal(search.indexOf(".order('approved'"), -1, 'ordering in the database cost 64 seconds')
  assert.equal(search.indexOf(".order('name'"), -1)
  assert.match(search, /\.sort\(\(left, right\) =>/)

  assert.match(search, /\.limit\(SEARCH_CAP\)/)
  // The city the screen shows is the one on the REGISTRATION, not the `slug`.
  assert.match(search, /scope: scope\.city/)
})

test('#409 · the client scope is read with `service_role`, because the operator cannot', () => {
  const search = code('app/api/admin/partnerships/clients/[clientId]/places/candidates/route.ts')

  // THE DEFECT, measured on 2026-08-23: `authenticated` has no `USAGE` on schema `partner`
  // (`42501: permission denied for schema partner`), and `clients_select_safe` compares
  // `cms_users.id = auth.uid()`, false for all 15 `cms_users`. Reading the client with the
  // operator's session ALWAYS failed, the error was discarded, and the scope silently vanished
  // — which is what turned every search into the full scan.
  const clientRead = search.slice(search.indexOf("from('clients')") - 400, search.indexOf("from('clients')"))
  assert.match(clientRead, /getSupabaseService\(\)/)
  assert.equal(clientRead.indexOf('auth.supabase'), -1)

  // And the error is no longer swallowed: a scope that cannot be read is a 503, not a scan.
  assert.match(search, /if \(clientError\)/)
  assert.match(search, /error: 'scope_unavailable'/)
})

test('#409 · the candidate search uses the shared name matcher', () => {
  // The rule itself — accent, case and punctuation — lives in `lib/shared/name-search` and is
  // proven by `tests/api/name-search.test.ts`, because every search in the CMS shares it.
  const search = code('app/api/admin/partnerships/clients/[clientId]/places/candidates/route.ts')
  assert.match(search, /from '@\/lib\/shared\/name-search'/)
  assert.match(search, /\.imatch\('name', namePattern\(term\)\)/)
  assert.equal(search.indexOf(".ilike('name'"), -1, 'ILIKE compared bytes, and the bytes differed')
})

test('#409 · the route is the gate, and the panel is only a courtesy', () => {
  const route = code('app/api/admin/partnerships/clients/[clientId]/places/link/route.ts')

  // It re-reads the row and applies the SAME pure rule, at this instant: the panel's verdict is
  // minutes old by the time somebody clicks.
  assert.match(route, /verdictFor\(candidate, clientId\)/)
  assert.match(route, /from\('attraction_coordinate'\)/, 'the coordinate is checked server-side')

  // ONE COLUMN, AND ONE WRITE. Approving on link would hand the triage to a search box
  // (BR-B2B-011), and prominence is not a partnership's to grant (BR-B2B-010, item 6). Asserted
  // on the WRITES and not on the word: the route reads `approved` to build the candidate, and a
  // ruler that cannot tell a read from a write measures the wrong thing.
  const writes = Array.from(route.matchAll(/\.update\((\{[^}]*\})\)/g)).map((match) => match[1])
  assert.deepEqual(writes, ['{ partner_client_id: clientId }', '{ welcome_poi_id: attractionId }'])

  // THE WELCOME POI FOLLOWS THE LINK, and it is the same fact — measured on 2026-08-23, of the
  // 10 clients carrying a `welcome_poi_id`, 10 pointed at a POI that was NOT the client's
  // place. It is written only when the column is EMPTY: BR-B2B-033, item 3, is 1 client :
  // N places, and the second address does not take over the welcome page somebody chose.
  assert.match(route, /\.is\('welcome_poi_id', null\)/)
  // Through `service_role`, because `authenticated` has no `USAGE` on schema `partner`.
  const welcomeWrite = route.slice(route.indexOf("update({ welcome_poi_id") - 300, route.indexOf("update({ welcome_poi_id"))
  assert.match(welcomeWrite, /getSupabaseService\(\)/)

  // The race guard, not decoration: two operators on two tabs would otherwise both pass the
  // check and the second would silently take the place from the first.
  assert.match(route, /\.is\('partner_client_id', null\)/)

  assert.match(route, /withAuth<\{ clientId: string \}>\(\{ roles: \['admin'\] \}/)
  assert.match(route, /action: 'LINK_PARTNER_PLACE'/)
})

test('#409 · a refused candidate is shown WITH its reason, never filtered out', () => {
  const search = code('app/api/admin/partnerships/clients/[clientId]/places/candidates/route.ts')

  // Answering `Tucas` with an empty list while `Tucas Empório Bistrô` sits in the catalogue is
  // how the operator creates the duplicate all over again. Events are searched deliberately.
  assert.match(search, /\.in\('entity_kind', \['place', 'poi', 'event'\]\)/)
  assert.match(search, /verdict: verdictFor\(candidate, clientId\)/)
  assert.equal(search.indexOf('.filter('), -1, 'the route must not drop the refused ones')

  // One coordinate lookup for the whole page: N+1 over a panel somebody types into is a request
  // per keystroke per row.
  assert.match(search, /\.in\('attraction_id', ids\)/)

  // The CATALOGUE is read with the OPERATOR's client — unapproved rows are visible through the
  // `CMS admins can read attractions` policy, and `service_role` would answer for another
  // identity than the one about to write. `service_role` appears in this file for ONE reason,
  // and it is the client's city: see the scope test above.
  const catalogueRead = search.slice(
    search.indexOf("from('attractions')") - 200,
    search.indexOf("from('attractions')")
  )
  assert.match(catalogueRead, /auth\.supabase/)
  assert.equal(catalogueRead.indexOf('getSupabaseService'), -1)
})

test('#409 · searching comes BEFORE creating, on both surfaces that offer the act', () => {
  for (const surface of [
    'components/admin/partnerships/PartnershipDetail.tsx',
    'components/admin/clients/tabs/PlacesTab.tsx',
  ]) {
    const source = code(surface)
    const panel = source.indexOf('<PlaceLinkPanel')
    const create = source.indexOf('pendencies.emptyCreate')
    assert.ok(panel >= 0, `${surface} must offer linking`)
    assert.ok(create >= 0, `${surface} must still offer creating`)
    assert.ok(panel < create, `${surface} must offer the search BEFORE the create button`)
  }

  // The dead link is gone: it pointed at `/places` under a comment saying the act had no writer.
  const band = code('components/admin/partnerships/PartnershipDetail.tsx')
  assert.equal(band.indexOf('pendencies.emptyLink'), -1, 'the round trip that ended in nothing')
})

test('#409 · every verdict the panel can render has Portuguese copy', () => {
  const copy = JSON.parse(read('messages/pt.json')).Partnerships.placeLink
  for (const reason of ['wrong_kind', 'no_coordinate', 'other_owner']) {
    assert.equal(typeof copy.refused[reason], 'string', `placeLink.refused.${reason} is missing`)
  }
  for (const key of ['title', 'body', 'searchLabel', 'minLength', 'empty', 'linkAction', 'alreadyLinked', 'orCreate']) {
    assert.equal(typeof copy[key], 'string', `placeLink.${key} is missing`)
  }
  // Portuguese-only, like the rest of the pipeline vocabulary (#408).
  for (const locale of ['en', 'es']) {
    assert.equal(read(`messages/${locale}.json`).indexOf('placeLink'), -1)
  }
})

// ── The welcome POI stopped being a second pointer ───────────────────────────────────────────

test('#409 · the welcome POI is chosen among the client\'s places, never typed', () => {
  const route = code('app/api/admin/partnerships/clients/[clientId]/places/welcome/route.ts')

  // THE GATE IS THE LINK ITSELF. Everything `verdictFor` refuses — the wrong kind, the missing
  // coordinate, somebody else's place — was refused when the place was linked, so a row
  // carrying `partner_client_id = clientId` has already been through it. What replaced this
  // route was a text field that took a pasted UUID with no check at all, and of the 10 clients
  // that carried a `welcome_poi_id`, 10 pointed at a POI that was not the client's place — one
  // of them an `event`, which the app does not serve as a place in any query.
  assert.match(route, /if \(row\.partner_client_id !== clientId\)/)
  assert.match(route, /error: 'not_linked'/)

  assert.match(route, /withAuth<\{ clientId: string \}>\(\{ roles: \['admin'\] \}/)
  assert.match(route, /action: 'SET_PARTNER_WELCOME_POI'/)

  // One write, and it is the pointer. Nothing about the place itself.
  const writes = Array.from(route.matchAll(/\.update\((\{[^}]*\})\)/g)).map((match) => match[1])
  assert.deepEqual(writes, ['{ welcome_poi_id: attractionId }'])
})

test('#409 · the tab offers the choice only where there IS a choice', () => {
  const tab = code('components/admin/clients/tabs/PlacesTab.tsx')

  // Linking the first place already adopted it (`../places/link`), so a client with one place
  // never sees the act — a button that changes nothing is a button that lies.
  assert.match(tab, /canChooseWelcome=\{detail\.places\.length > 1\}/)
  assert.match(tab, /isWelcome=\{place\.readiness\.place\.attractionId === detail\.client\.welcomePoiId\}/)

  // And the pointer the badge reads is the one the pipeline reads, carried by the same answer.
  const service = code('lib/services/partnership-service.ts')
  assert.match(service, /welcomePoiId: \(row\.welcome_poi_id as string\) \?\? null/)
  assert.match(service, /welcome_poi_id'/)
})

// ── The partner that HAS a POI and whose screen said it had none ─────────────────────────────

test('#409 · a welcome POI that is not the client\'s place is shown, not hidden', () => {
  const service = code('lib/services/partnership-service.ts')

  // MEASURED on 2026-08-23: of the 10 clients carrying a `welcome_poi_id`, 10 pointed at a POI
  // that was NOT the client's place. `Garota Beer` points at a published establishment with a
  // pin while `partner_client_id` points nowhere, and band 4 read `este cliente ainda não tem
  // local vinculado` over a partner that has one on air — with `Criar um local novo` as the
  // next move, which is how the duplicate is born.
  assert.match(service, /welcomeDivergence: await loadWelcomeDivergence\(/)

  // Only when the two POINTERS DISAGREE: the query costs nothing in the ordinary case, and a
  // divergence card over a client whose welcome POI IS its place would be noise.
  assert.match(service, /if \(linkedAttractionIds\.indexOf\(welcomePoiId\) >= 0\) return null/)
  assert.match(service, /if \(!welcomePoiId\) return null/)

  // A dangling id is not a divergence the screen can help with.
  assert.match(service, /if \(error \|\| !data\) return null/)
})

test('#409 · the divergence card writes nothing itself, it uses the link route', () => {
  const card = code('components/admin/partnerships/WelcomeDivergenceCard.tsx')

  // The same gate as the search: `verdictFor` refuses an event, a POI with no coordinate and
  // somebody else's place, and the route adopts the welcome POI in the same act. A card that
  // wrote `partner_client_id` on its own would be the second implementation of the link.
  assert.match(card, /places\/link/)
  assert.match(card, /method: 'POST'/)
  assert.equal(card.indexOf('partner_client_id'), -1)
  assert.equal(card.indexOf('welcome_poi_id'), -1)

  // It answers WITH the reason, because the reasons need different acts from the operator: an
  // `event` is not fixed by clicking again, and a missing pin is fixed in the POI editor.
  assert.match(card, /refused\.\$\{refusal\}/)

  // And it renders where the empty state is, on BOTH surfaces that offer the act.
  for (const surface of [
    'components/admin/partnerships/PartnershipDetail.tsx',
    'components/admin/clients/tabs/PlacesTab.tsx',
  ]) {
    const source = code(surface)
    assert.match(source, /<WelcomeDivergenceCard/, `${surface} must show the divergence`)
    const card_ = source.indexOf('<WelcomeDivergenceCard')
    const panel = source.indexOf('<PlaceLinkPanel')
    assert.ok(card_ >= 0 && panel >= 0 && card_ < panel, `${surface}: the POI it already has comes first`)
  }
})
