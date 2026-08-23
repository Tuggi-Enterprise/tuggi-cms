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

test('#409 · o recorte vai para o `WHERE`, e o `ORDER BY` não volta', () => {
  const search = code('app/api/admin/partnerships/clients/[clientId]/places/candidates/route.ts')

  // Os três campos do `idx_attractions_geo_search (country, state, city)`, e só no modo
  // recortado: `all` é o operador pedindo o catálogo inteiro de propósito.
  assert.match(search, /if \(scope && mode === 'city'\)/)
  assert.match(search, /query\.eq\('country', scope\.country\)/)
  assert.match(search, /query\.eq\('state', scope\.state\)/)
  assert.match(search, /query\.eq\('city', scope\.city\)/)

  // O `ORDER BY approved DESC` É O QUE CAUSOU O TIMEOUT: ele deu ao planner a saída de varrer
  // `idx_attractions_approved` inteiro em vez de usar o índice geo, e ele varreu 2.646.463
  // linhas aplicando o `OR` de 12 policies de RLS em cada uma. A ordem é decidida em memória,
  // sobre as dezenas de linhas que voltam.
  assert.equal(search.indexOf(".order('approved'"), -1, 'ordenar no banco custou 64 segundos')
  assert.equal(search.indexOf(".order('name'"), -1)
  assert.match(search, /\.sort\(\(left, right\) =>/)

  assert.match(search, /\.limit\(SEARCH_CAP\)/)
  // A cidade que a tela mostra é a do CADASTRO, não o `slug`.
  assert.match(search, /scope: scope \? scope\.city : null/)
})

test('#409 · o cadastro do cliente passa a falar o dialeto do catálogo', () => {
  const promotion = code('lib/partner-form/promotion.ts')
  // `country` era a constante `BR` e `state` era o campo cru do formulário.
  assert.match(promotion, /column: 'country', source: \{ kind: 'canonical_country' \}/)
  assert.match(promotion, /column: 'state', source: \{ kind: 'canonical_state' \}/)
  assert.match(promotion, /normalizeLocation\('BR', text\(answers\.state\)\)/)

  // `city` fica como veio, e é decisão: `location-normalize` canoniza país e estado, e não tem
  // um dicionário de municípios do mundo. Inventar um nome oficial que ninguém conferiu é pior
  // que comparar por `slug`.
  assert.match(promotion, /column: 'city', source: \{ kind: 'field', field: 'city' \}/)

  // E o local criado a partir da proposta grava o mesmo padrão — os dois lados de uma proposta.
  const prefill = code('lib/partner-form/place-prefill.ts')
  assert.match(prefill, /normalizeLocation\('BR', text\(answers\.state\)\)/)
  assert.equal(prefill.indexOf("country: 'BR'"), -1)
})

// ── The surfaces ─────────────────────────────────────────────────────────────────────────────

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
  assert.deepEqual(writes, ['{ partner_client_id: clientId }'])

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

  // Read with the OPERATOR's client — unapproved rows are visible through the `CMS admins can
  // read attractions` policy, and `service_role` would answer for another identity.
  assert.match(search, /auth\.supabase/)
  assert.equal(search.indexOf('getSupabaseService'), -1)
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
