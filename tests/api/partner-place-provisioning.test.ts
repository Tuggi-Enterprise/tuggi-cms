/**
 * Approving the partner creates the place — #360.
 *
 * The card is one sentence and four prohibitions, and the prohibitions are what this file is
 * for: creating the place must not APPROVE it (BR-B2B-011), must not start the BILLING
 * (BR-B2B-018, item 1), must not give it PROMINENCE (BR-B2B-010, item 6), and must not turn
 * 1 client : N places into 1 : 1 (BR-B2B-033, item 3).
 *
 * Every write the effect performs is recorded and inspected as a whole, so a column that is
 * never supposed to be written is proved absent from what actually left the process — not from
 * a list somebody kept up to date.
 *
 * Run with: npm run test:api
 */

import { test, before, mock } from 'node:test'
import assert from 'node:assert/strict'

import {
  PLACE_PREFILL_NEVER_WRITES,
  PLACE_TYPE_BY_CATEGORY,
  buildPlacePrefill,
  placePrefillIsClosed,
} from '@/lib/partner-form/place-prefill'
import { PLACE_TYPES } from '@/lib/core/place-service'
import type { PartnerAnswers } from '@/lib/partner-form/schema'
import type { PartnerPlaceOutcome } from '@/lib/services/partner-place-provisioning'

const CLIENT_ID = '44444444-4444-4444-4444-444444444444'
const SUBMISSION_ID = '33333333-3333-3333-3333-333333333333'
const ATTRACTION_ID = '77777777-7777-7777-7777-777777777777'

function answers(overrides: PartnerAnswers = {}): PartnerAnswers {
  return {
    trade_name: 'Cantina do Zé',
    legal_name: 'Cantina do Zé Alimentos Ltda',
    tax_id: '12ABC34501DE35',
    category: 'restaurant',
    address: 'Rua das Pedras, 120',
    address_complement: 'sobreloja',
    district: 'Centro',
    postal_code: '28950-000',
    city: 'São Vicente',
    state: 'SP',
    website: 'https://cantinadoze.com.br',
    instagram: '@cantinadoze',
    opening_hours: 'Terça a domingo, 12h às 23h',
    representative_name: 'Antônio Ferreira',
    representative_role: 'Sócio',
    representative_email: 'antonio@cantina.com.br',
    representative_phone: '+55 22 99999-0000',
    story_founder: 'Meu avô Aurélio abriu a cantina em 1962, no galpão do antigo mercado de peixe.',
    ...overrides,
  }
}

// ── The prefill, as a decision ───────────────────────────────────────────────────────────────

test('#360: the place is named, located and typed by what the partner answered', () => {
  const prefill = buildPlacePrefill(answers())
  assert.ok(prefill)
  // #409 · NO PADRÃO DO CATÁLOGO, e não como o formulário escreve. O parceiro responde `SP`; o
  // resto de `core.attractions` guarda `São Paulo` e `Brazil`, que é o canônico de
  // `lib/shared/location-normalize` — por onde já passam a ingestão do OSM, a importação do
  // Google Places e a edição manual do POI. Gravar a sigla punha o local do parceiro num dialeto
  // que nenhuma faceta de país ou estado do catálogo alcança.
  assert.deepEqual(prefill.create, {
    name: 'Cantina do Zé',
    city: 'São Vicente',
    country: 'Brazil',
    state: 'São Paulo',
    place_type: 'restaurant',
  })
  assert.equal(
    prefill.attraction.formatted_address,
    'Rua das Pedras, 120, sobreloja, Centro',
    'one column, three answers — the same join the client record gets'
  )
  assert.equal(prefill.attraction.postal_code, '28950-000')
  assert.equal(prefill.attraction.website, 'https://cantinadoze.com.br')
})

test('#360: a category the catalogue does not answer is left for the curator, not guessed', () => {
  // `bar_cafe` is one option in the form and two types in the catalogue. Guessing is right half
  // the time and looks deliberate every time.
  assert.equal(buildPlacePrefill(answers({ category: 'bar_cafe' }))?.create.place_type, null)
  assert.equal(buildPlacePrefill(answers({ category: 'attraction' }))?.create.place_type, null)
  assert.equal(buildPlacePrefill(answers({ category: '' }))?.create.place_type, null)
  assert.equal(buildPlacePrefill(answers({ category: 'inn' }))?.create.place_type, 'hotel')

  for (const value of Object.values(PLACE_TYPE_BY_CATEGORY)) {
    if (value !== null) {
      assert.equal(
        (PLACE_TYPES as readonly string[]).includes(value),
        true,
        `${value} is not a type any CMS screen can show`
      )
    }
  }
})

test('#360: answers that cannot name a place create none', () => {
  // `core.attractions` has `name`, `city` and `country` NOT NULL. A placeholder row in a
  // catalogue of 2.2 million is worse than no row, and the approval carries on either way.
  assert.equal(buildPlacePrefill(answers({ trade_name: '' })), null)
  assert.equal(buildPlacePrefill(answers({ city: '   ' })), null)
})

test('BR-B2B-011 / BR-B2B-010 / BR-B2B-018: the prefill cannot reach approval, prominence or a description', () => {
  assert.equal(placePrefillIsClosed(), true)

  const prefill = buildPlacePrefill(answers())
  const written = Object.keys({ ...prefill?.create, ...prefill?.attraction })
  for (const column of PLACE_PREFILL_NEVER_WRITES) {
    assert.equal(written.includes(column), false, `${column} is reachable from an answer`)
  }
})

test('BR-B2B-030: the representative is a person, and their contact stays off the POI', () => {
  // `representative_phone` and `representative_email` are collected to talk to whoever signs
  // the contract. They live in `partner.clients`; a POI column is read by the app.
  const prefill = buildPlacePrefill(answers())
  const values = JSON.stringify({ ...prefill?.create, ...prefill?.attraction })
  assert.equal(values.includes('99999-0000'), false)
  assert.equal(values.includes('antonio@cantina.com.br'), false)
  assert.equal(values.includes('Terça a domingo'), false, 'free text is not a jsonb opening_hours')
  assert.equal(values.includes('Aurélio'), false, 'the story is not a description — BR-B2B-018')
})

// ── The effect, against a recorded database ─────────────────────────────────────────────────

interface Recorded {
  rpcs: { name: string; args: Record<string, unknown> }[]
  updates: { table: string; patch: Record<string, unknown> }[]
}

interface FakeState {
  submissions: Record<string, unknown>[]
  linkedPlaces: { id: string; partner_client_id: string }[]
  lookupFails: boolean
  createFails: boolean
  linkFails: boolean
  recorded: Recorded
}

let state: FakeState

function freshState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    submissions: [
      {
        id: SUBMISSION_ID,
        status: 'promoted',
        answers: answers(),
        promoted_client_id: CLIENT_ID,
        promoted_at: '2026-08-16T12:00:00Z',
      },
    ],
    linkedPlaces: [],
    lookupFails: false,
    createFails: false,
    linkFails: false,
    recorded: { rpcs: [], updates: [] },
    ...overrides,
  }
}

/** The `service_role` side: the proposal queue, and nothing else. */
function createFakeService() {
  const build = () => {
    const filters: [string, unknown][] = []
    const chain: any = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters.push([column, value])
        return chain
      },
      order: () => chain,
      limit: () => chain,
      then: (onFulfilled: (value: any) => unknown) => {
        const rows = state.submissions.filter((row) =>
          filters.every(([column, value]) => (row as any)[column] === value)
        )
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled)
      },
    }
    return chain
  }
  return { schema: () => ({ from: () => build() }) }
}

/** The OPERATOR's side: the identity `cms_create_place` and the RLS policies answer to. */
function createFakeOperator() {
  const from = (table: string) => {
    let operation: 'select' | 'update' = 'select'
    let patch: Record<string, unknown> = {}
    const chain: any = {
      select: () => chain,
      update: (next: Record<string, unknown>) => {
        operation = 'update'
        patch = next
        return chain
      },
      eq: () => chain,
      limit: () => chain,
      then: (onFulfilled: (value: any) => unknown) => {
        if (operation === 'update') {
          if (state.linkFails) {
            return Promise.resolve({ error: { message: 'permission denied' } }).then(onFulfilled)
          }
          state.recorded.updates.push({ table, patch })
          return Promise.resolve({ error: null }).then(onFulfilled)
        }
        if (state.lookupFails) {
          return Promise.resolve({ data: null, error: { message: 'timeout' } }).then(onFulfilled)
        }
        return Promise.resolve({ data: state.linkedPlaces, error: null }).then(onFulfilled)
      },
    }
    return chain
  }

  return {
    schema: () => ({
      from,
      rpc: async (name: string, args: Record<string, unknown>) => {
        state.recorded.rpcs.push({ name, args })
        if (state.createFails) return { data: null, error: { message: 'not authorized to create places' } }
        return { data: ATTRACTION_ID, error: null }
      },
    }),
  }
}

let provisionPartnerPlace: (
  clientId: string,
  operator: any
) => Promise<PartnerPlaceOutcome>

before(async () => {
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseService: () => createFakeService(),
      getSupabase: () => createFakeService(),
      getSupabaseClient: () => ({}),
      getSupabaseRouteHandler: () => createFakeOperator(),
    },
  })

  const effects = await import('@/lib/services/partner-place-provisioning')
  provisionPartnerPlace = effects.provisionPartnerPlace as any
})

test('BR-B2B-033: provisioning creates the place already linked to the client', async () => {
  state = freshState()

  const outcome = await provisionPartnerPlace(CLIENT_ID, createFakeOperator())

  assert.deepEqual(outcome, { status: 'created', attractionId: ATTRACTION_ID })
  assert.equal(state.recorded.rpcs[0].name, 'cms_create_place')
  assert.equal(state.recorded.rpcs[0].args.p_name, 'Cantina do Zé')
  assert.equal(state.recorded.rpcs[0].args.p_country, 'Brazil')
  assert.equal(state.recorded.updates.length, 1)
  assert.equal(state.recorded.updates[0].table, 'attractions')
  assert.equal(
    state.recorded.updates[0].patch.partner_client_id,
    CLIENT_ID,
    'the column of #358, and the only place a link is written'
  )
})

test('BR-B2B-011: nothing this act writes approves, activates or promotes the place', async () => {
  // The place is born `approved = false` inside `core.cms_create_place`; what is provable on
  // this side is that no payload leaving the CMS can change that. `is_active` is on the same
  // list on purpose — hiding the place by DEACTIVATING it would be a second, false statement
  // about the record (BR-POI-005, item 5), when `approved = false` is the state that is true.
  state = freshState()

  await provisionPartnerPlace(CLIENT_ID, createFakeOperator())

  const payloads = [
    ...state.recorded.rpcs.map((call) => call.args),
    ...state.recorded.updates.map((update) => update.patch),
  ]
  for (const payload of payloads) {
    for (const column of PLACE_PREFILL_NEVER_WRITES) {
      assert.equal(column in payload, false, `${column} was written`)
      assert.equal(`p_${column}` in payload, false, `p_${column} was written`)
    }
  }
})

test('BR-B2B-018: no coordinate is invented, and no description is written', async () => {
  // The form asks for no latitude/longitude, so `cms_set_attraction_coordinate` is not called
  // with a guess — and the fee starts on the publication of the POI with the description on
  // air (item 1), which is a write this path does not have.
  state = freshState()

  await provisionPartnerPlace(CLIENT_ID, createFakeOperator())

  assert.equal(state.recorded.rpcs.length, 1, 'one RPC: the creation')
  assert.equal(state.recorded.rpcs[0].args.p_latitude, null)
  assert.equal(state.recorded.rpcs[0].args.p_longitude, null)
  assert.equal(
    state.recorded.updates.some((update) => update.table !== 'attractions'),
    false,
    'no description, no place_details, no billing'
  )
})

test('BR-B2B-033: a client that already has a place is not given a second one by this act', async () => {
  // The guard is over THIS AUTOMATIC ACT — approving twice does not duplicate the catalogue.
  // It is not a 1 : 1 constraint: the second address of the same CNPJ is a place the operator
  // registers, and item 3 forbids reverting the cardinality to make a screen simpler.
  state = freshState({ linkedPlaces: [{ id: ATTRACTION_ID, partner_client_id: CLIENT_ID }] })

  const outcome = await provisionPartnerPlace(CLIENT_ID, createFakeOperator())

  assert.deepEqual(outcome, { status: 'skipped', reason: 'already_provisioned' })
  assert.equal(state.recorded.rpcs.length, 0)
})

test('#360: a client nobody promoted from a proposal gets no place', async () => {
  // The 10 records that existed before the form, and every client registered by hand.
  state = freshState({ submissions: [] })

  const outcome = await provisionPartnerPlace(CLIENT_ID, createFakeOperator())

  assert.deepEqual(outcome, { status: 'skipped', reason: 'no_promoted_proposal' })
  assert.equal(state.recorded.rpcs.length, 0)
})

test('#360: a failed lookup creates nothing — the guard fails closed', async () => {
  // Creating on a read that did not answer is how one client ends up with two identical places.
  state = freshState({ lookupFails: true })

  const outcome = await provisionPartnerPlace(CLIENT_ID, createFakeOperator())

  assert.deepEqual(outcome, { status: 'failed', reason: 'lookup_failed', attractionId: null })
  assert.equal(state.recorded.rpcs.length, 0)
})

test('BR-B2B-010: a place the CMS could not create does not fail the act', async () => {
  // Approving the partnership is the decision the operator made (item 1) and it already
  // happened. The effect answers with data and never throws, so the route can report it.
  state = freshState({ createFails: true })

  const outcome = await provisionPartnerPlace(CLIENT_ID, createFakeOperator())

  assert.deepEqual(outcome, { status: 'failed', reason: 'create_failed', attractionId: null })
  assert.equal(state.recorded.updates.length, 0, 'nothing was linked to a place that does not exist')
})

test('#360: a place created and not linked names itself, because nothing deletes it', async () => {
  // PostgREST has no transaction across statements and `cms_create_place` takes no
  // `partner_client_id`. Deleting to clean up is a destructive act on the catalogue
  // (CLAUDE.md §3), so the residue is reported with the id the operator has to link by hand.
  state = freshState({ linkFails: true })

  const outcome = await provisionPartnerPlace(CLIENT_ID, createFakeOperator())

  assert.deepEqual(outcome, { status: 'failed', reason: 'link_failed', attractionId: ATTRACTION_ID })
})
