/**
 * #886 / #887 — O QUE `loadPlaceDescriptionPolicy` ENTREGA DO CADASTRO: `registration` (painel do
 * editor, somente leitura) e `facts` (insumo da geração).
 *
 * O serviço real roda; só o RPC, as duas leituras do local e a leitura do portal são falsos.
 * Nenhum banco é tocado.
 *
 * Defende: BR-B2B-030 (nada do representante chega ao navegador), BR-B2B-033 (a fonte do cadastro
 * é a submissão do portal do local; o formulário antigo usa a proposta promovida), BR-B2B-016 item 1
 * e BR-B2B-011 gate 2 (pagante sem bloco de história não gera — a decisão é de uma pessoa, e
 * `facts` sozinho nunca vira entrada), BR-B2B-044 item 3 (o editor vence a submissão).
 *
 * Mutações que a deixam vermelha: a falha na leitura do portal derrubar a política; o portal perder
 * para a proposta; devolver `registration` num local sem parceiro; `story` ser derivada de `facts`.
 *
 * Run with: npm run test:api
 */

import { test, before, mock } from 'node:test'
import assert from 'node:assert/strict'

type PortalRead = { answers: Record<string, string>; acceptedPlanChoice: null } | null | undefined
let portalRead: () => Promise<PortalRead>

let svc: typeof import('@/lib/services/place-description-policy-service')

before(async () => {
  mock.module('@/lib/core/supabase-client', {
    namedExports: { getSupabaseService: () => ({ auth: { admin: { getUserById: async () => ({ data: null, error: null }) } } }) },
  })
  mock.module('@/lib/services/portal-validation-service', {
    namedExports: { portalRegistrationOfPlace: () => portalRead() },
  })
  svc = await import('@/lib/services/place-description-policy-service')
})

const POI = '22222222-2222-4222-8222-222222222222'

const REPRESENTATIVE = {
  representative_name: 'Maria Representante',
  representative_cpf: '123.456.789-09',
  representative_email: 'maria.rep@x.com',
  representative_phone: '21999998888',
}

const PORTAL_ANSWERS = {
  signature_item: 'Feijoada de sábado',
  category: 'restaurant',
  instagram: '@portal',
  ...REPRESENTATIVE,
}
const PROPOSAL_ANSWERS = {
  signature_item: 'Pastel de angu',
  category: 'restaurant',
  instagram: '@proposta',
  story_founder: 'Seu Zé abriu em 1980.',
  ...REPRESENTATIVE,
}

interface FakeOptions {
  row?: Record<string, unknown>
  attraction?: Record<string, unknown> | null
  details?: Record<string, unknown> | null
  placeReadError?: boolean
}

function db(opts: FakeOptions = {}) {
  const row = {
    attraction_id: POI,
    name: 'Bar do Zé',
    city: 'Gramado',
    entity_kind: 'restaurant',
    partner_client_id: 'c1',
    base_description: null,
    base_has_audio: null,
    base_generation_kind: null,
    proposal_answers: null,
    accepted_plan_choice: 'map_and_description', // paid → partner_story
    ...opts.row,
  }
  const table = (name: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () =>
          opts.placeReadError
            ? { data: null, error: { code: 'XX000' } }
            : { data: name === 'attractions' ? (opts.attraction ?? {}) : (opts.details ?? null), error: null },
      }),
    }),
  })
  return { schema: () => ({ rpc: async () => ({ data: [row], error: null }), from: table }) } as never
}

// ── 886 · 4: a place with no partner ─────────────────────────────────────────

test('BR-B2B-033 · a place with no partner has no registration and no facts (the panel renders nothing)', async () => {
  portalRead = async () => ({ answers: PORTAL_ANSWERS, acceptedPlanChoice: null })
  const v = await svc.loadPlaceDescriptionPolicy(POI, db({ row: { partner_client_id: null, proposal_answers: PROPOSAL_ANSWERS } }))
  assert.ok(v)
  assert.equal(v.partnerClientId, null)
  assert.equal(v.registration, null)
  assert.equal(v.facts, null)
  assert.equal(v.story, null)
})

// ── 886 · 5: portal vs old form ──────────────────────────────────────────────

test('BR-B2B-033 · a portal place reads the PORTAL submission, even when a promoted proposal exists', async () => {
  portalRead = async () => ({ answers: PORTAL_ANSWERS, acceptedPlanChoice: null })
  const v = await svc.loadPlaceDescriptionPolicy(POI, db({ row: { proposal_answers: PROPOSAL_ANSWERS } }))
  assert.equal(v?.registration?.source, 'portal')
  assert.equal(v?.registration?.signatureItem, 'Feijoada de sábado')
  assert.equal(v?.registration?.instagram, '@portal')
})

test('BR-B2B-033 · the old form (no portal submission) reads the promoted proposal', async () => {
  portalRead = async () => null
  const v = await svc.loadPlaceDescriptionPolicy(POI, db({ row: { proposal_answers: PROPOSAL_ANSWERS } }))
  assert.equal(v?.registration?.source, 'proposal')
  assert.equal(v?.registration?.signatureItem, 'Pastel de angu')
  assert.deepEqual(v?.registration?.story, [{ id: 'story_founder', answer: 'Seu Zé abriu em 1980.' }])
})

test('BR-B2B-033 · a partner with no registration anywhere has a null registration, and the policy still answers', async () => {
  portalRead = async () => null
  const v = await svc.loadPlaceDescriptionPolicy(POI, db({ row: { proposal_answers: null } }))
  assert.ok(v)
  assert.equal(v.registration, null)
  assert.equal(v.decision.policy, 'partner_story')
})

// ── 886 · 6: the wire never carries the representative ───────────────────────

test('BR-B2B-030 · the whole view, serialised, carries nothing of the representative', async () => {
  portalRead = async () => ({ answers: PORTAL_ANSWERS, acceptedPlanChoice: null })
  for (const proposal of [null, PROPOSAL_ANSWERS]) {
    const v = await svc.loadPlaceDescriptionPolicy(POI, db({ row: { proposal_answers: proposal }, details: { place_type: 'bar' } }))
    const wire = JSON.stringify(v)
    for (const [key, value] of Object.entries(REPRESENTATIVE)) {
      assert.ok(!wire.includes(value), `${key} value on the wire`)
      assert.ok(!wire.includes(key), `${key} on the wire`)
    }
  }
})

// ── 886 · 7: a failed portal read ────────────────────────────────────────────

test('BR-B2B-033 · the portal read FAILS (undefined): the policy answers, from the proposal', async () => {
  portalRead = async () => undefined
  const v = await svc.loadPlaceDescriptionPolicy(POI, db({ row: { proposal_answers: PROPOSAL_ANSWERS } }))
  assert.ok(v)
  assert.equal(v.decision.policy, 'partner_story')
  assert.equal(v.registration?.source, 'proposal')
  assert.ok(v.story, 'the story from the proposal is still offered')
})

test('BR-B2B-033 · the portal read THROWS: the policy still answers', async () => {
  portalRead = async () => {
    throw new Error('connection reset')
  }
  const v = await svc.loadPlaceDescriptionPolicy(POI, db({ row: { proposal_answers: PROPOSAL_ANSWERS } }))
  assert.ok(v)
  assert.equal(v.decision.policy, 'partner_story')
  assert.equal(v.registration?.source, 'proposal')
})

// ── 887 · place facts: editor wins, failure falls back ───────────────────────

test('BR-B2B-044 item 3 · the facts the view carries are the editor\'s first, then the submission\'s', async () => {
  portalRead = async () => ({ answers: { ...PORTAL_ANSWERS, category: 'restaurant', price_range: '1', languages: JSON.stringify(['pt']) }, acceptedPlanChoice: null })
  const v = await svc.loadPlaceDescriptionPolicy(
    POI,
    db({ attraction: { pet_friendly: 'yes' }, details: { place_type: 'bar', price_range: 3, has_delivery: true, cuisine: ['sushi'] } })
  )
  assert.deepEqual(v?.facts, {
    category: 'bar',
    subtypes: ['sushi'],
    signature_item: 'Feijoada de sábado',
    amenities: ['pet_friendly'],
    has_delivery: true,
    price_range: 3,
    languages: ['pt'],
  })
})

test('BR-B2B-044 item 3 · no place_details row: the facts come from the answers', async () => {
  portalRead = async () => ({ answers: { category: 'restaurant', price_range: '2', amenities: JSON.stringify(['delivery']) }, acceptedPlanChoice: null })
  const v = await svc.loadPlaceDescriptionPolicy(POI, db({ details: null }))
  assert.deepEqual(v?.facts, { category: 'restaurant', has_delivery: true, price_range: 2 })
})

test('BR-B2B-044 item 3 · the place read fails: the facts come from the answers alone, and the generation is not blocked', async () => {
  portalRead = async () => ({ answers: { category: 'restaurant', price_range: '2' }, acceptedPlanChoice: null })
  const v = await svc.loadPlaceDescriptionPolicy(POI, db({ placeReadError: true, details: { place_type: 'bar' } }))
  assert.ok(v)
  assert.deepEqual(v.facts, { category: 'restaurant', price_range: 2 })
})

test('BR-B2B-044 item 3 · facts travel only under partner_story (a free place gets none)', async () => {
  portalRead = async () => ({ answers: PORTAL_ANSWERS, acceptedPlanChoice: null })
  const v = await svc.loadPlaceDescriptionPolicy(POI, db({ row: { accepted_plan_choice: 'map_only' }, details: { place_type: 'bar' } }))
  assert.equal(v?.decision.policy, 'name_only')
  assert.equal(v?.facts, null)
  assert.equal(v?.story, null)
  assert.ok(v?.registration, 'the read-only panel still shows what was informed')
})

// ── 887 · 7: paid with no story block does not generate ──────────────────────

test('BR-B2B-011 gate 2 · a PAID place with no story block has story=null — facts alone never become generation input', async () => {
  portalRead = async () => ({ answers: PORTAL_ANSWERS, acceptedPlanChoice: null }) // no story_* blocks
  const v = await svc.loadPlaceDescriptionPolicy(POI, db({ row: { proposal_answers: { instagram: '@x' } }, details: { place_type: 'bar' } }))
  assert.equal(v?.decision.policy, 'partner_story')
  assert.ok(v?.facts, 'there ARE facts…')
  assert.equal(v?.story, null, '…and still no story: the gate (`if (!story) return`) has nothing to send')
})
