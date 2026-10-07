/**
 * #887 — OS FATOS DO CADASTRO QUE A NARRAÇÃO DO PARCEIRO RECEBE (`partnerNarrationFacts`).
 *
 * BR-B2B-044 item 3: o editor do local VENCE a submissão (o que o curador corrigiu é o que vale),
 * a submissão preenche só o que o local não carrega, e campo vazio nunca vai — um rótulo sem
 * resposta é lido como entrada e o modelo narra o vazio (BR-B2B-025). Booleano só viaja quando
 * `true`. BR-B2B-011: o representante nunca entra.
 *
 * Mutações que a deixam vermelha: inverter a precedência (submissão antes do editor); enviar
 * `has_delivery: false`; enviar lista vazia ou string em branco; ler `amenities` das respostas
 * quando há linha em `place_details`.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { partnerNarrationFacts, type PlaceFactsRow } from '@/lib/partnerships/place-description-policy'
import type { PartnerAnswers } from '@/lib/partner-form/schema'

function place(over: Partial<PlaceFactsRow> = {}): PlaceFactsRow {
  return {
    hasDetailsRow: true,
    place_type: null,
    cuisine: null,
    tags: null,
    price_range: null,
    has_delivery: null,
    accepts_reservations: null,
    has_wifi: null,
    has_outdoor_seating: null,
    opening_hours: null,
    payment_credit_cards: null,
    pet_friendly: null,
    air_conditioning: null,
    wheelchair_accessible: null,
    ...over,
  }
}

const list = (...items: string[]) => JSON.stringify(items)
const A = (over: Record<string, string>): PartnerAnswers => over as PartnerAnswers

const HOURS_ANSWER = JSON.stringify({ monday: [{ open: '08:00', close: '12:00' }] })
const HOURS_EDITOR = { friday: [{ open: '18:00', close: '23:00' }] }

// ── 1. Empty is omitted ──────────────────────────────────────────────────────

test('BR-B2B-044 item 3 · nothing registered, nothing sent: null', () => {
  assert.equal(partnerNarrationFacts(null, null), null)
  assert.equal(partnerNarrationFacts({}, null), null)
  assert.equal(partnerNarrationFacts({}, place()), null)
})

test('BR-B2B-025 · blank, malformed and out-of-range answers are omitted, not sent empty', () => {
  const facts = partnerNarrationFacts(
    A({
      category: '   ',
      subtypes: '[]',
      signature_item: '  ',
      amenities: 'not json',
      price_range: '9',
      languages: '[]',
      opening_hours: 'seg a sex, das 9 às 18',
    }),
    null
  )
  assert.equal(facts, null)
  for (const price of ['0', '5', '2.5', 'abc', '']) {
    assert.equal(partnerNarrationFacts(A({ price_range: price }), null), null, `price ${JSON.stringify(price)}`)
  }
})

test('BR-B2B-044 item 3 · booleans travel only as true: a no never becomes `false` on the wire', () => {
  const noDelivery = partnerNarrationFacts(A({ category: 'bar' }), place({ has_delivery: false, accepts_reservations: false }))
  assert.ok(noDelivery)
  assert.ok(!('has_delivery' in noDelivery) && !('accepts_reservations' in noDelivery))
  const yes = partnerNarrationFacts({}, place({ has_delivery: true, accepts_reservations: true }))
  assert.deepEqual(yes, { has_delivery: true, accepts_reservations: true })
  // `delivery` and `accepts_reservations` have their own keys and never repeat inside `amenities`.
  assert.ok(!yes || !('amenities' in yes))
})

test('BR-B2B-011 · the representative never enters the facts, whatever the answers carry', () => {
  const facts = partnerNarrationFacts(
    A({
      category: 'cafe',
      representative_name: 'Maria Souza',
      representative_cpf: '123.456.789-09',
      representative_email: 'maria@x.com',
      representative_phone: '21999998888',
    }),
    null
  )
  assert.deepEqual(facts, { category: 'cafe' })
})

// ── 2. The editor wins over the submission ───────────────────────────────────

test('BR-B2B-044 item 3 · editor wins: category, subtypes, price range, hours', () => {
  const facts = partnerNarrationFacts(
    A({
      category: 'restaurant',
      subtypes: list('pizza'),
      price_range: '1',
      opening_hours: HOURS_ANSWER,
    }),
    place({ place_type: 'bar', cuisine: ['sushi', ' japonesa '], price_range: 4, opening_hours: HOURS_EDITOR })
  )
  assert.equal(facts?.category, 'bar')
  assert.deepEqual(facts?.subtypes, ['sushi', 'japonesa'])
  assert.equal(facts?.price_range, 4)
  assert.deepEqual(facts?.opening_hours, HOURS_EDITOR)
})

test('BR-B2B-044 item 3 · editor wins on hours also when the column is stored as a JSON string', () => {
  const facts = partnerNarrationFacts(A({ opening_hours: HOURS_ANSWER }), place({ opening_hours: JSON.stringify(HOURS_EDITOR) }))
  assert.deepEqual(facts?.opening_hours, HOURS_EDITOR)
})

test('BR-B2B-044 item 3 · editor wins on delivery and reservations: unchecked in the editor, the submission does not bring them back', () => {
  const facts = partnerNarrationFacts(
    A({ category: 'bar', amenities: list('delivery', 'accepts_reservations') }),
    place({ has_delivery: false, accepts_reservations: false })
  )
  assert.ok(facts)
  assert.ok(!('has_delivery' in facts) && !('accepts_reservations' in facts))
})

test('BR-B2B-044 item 3 · editor wins on amenities: only what the place carries, read through the prefill map', () => {
  const facts = partnerNarrationFacts(
    A({ amenities: list('sea_view', 'live_music', 'wifi') }),
    place({
      has_wifi: true,
      tags: ['parking'],
      pet_friendly: 'yes',
      air_conditioning: 'no',
      wheelchair_accessible: true,
      has_delivery: true,
    })
  )
  // `sea_view`/`live_music` were answered but the place does not carry them: gone.
  assert.deepEqual([...(facts?.amenities ?? [])].sort(), ['parking', 'pet_friendly', 'wheelchair_accessible', 'wifi'])
  assert.equal(facts?.has_delivery, true)
})

test('BR-B2B-044 item 3 · what the place does not carry is filled by the submission', () => {
  // A details row exists but price/cuisine/hours are empty: the answers fill those gaps.
  const facts = partnerNarrationFacts(
    A({ category: 'restaurant', subtypes: list('pizza'), price_range: '2', opening_hours: HOURS_ANSWER }),
    place({ place_type: null, cuisine: [], price_range: null, opening_hours: null })
  )
  assert.equal(facts?.category, 'restaurant')
  assert.deepEqual(facts?.subtypes, ['pizza'])
  assert.equal(facts?.price_range, 2)
  assert.deepEqual(facts?.opening_hours, { monday: [{ open: '08:00', close: '12:00' }] })
})

test('BR-B2B-044 item 3 · signature item and languages have no column: always the answers', () => {
  const facts = partnerNarrationFacts(
    A({ signature_item: ' Crepe de doce de leite ', languages: list('pt', 'fr') }),
    place({ place_type: 'cafe' })
  )
  assert.equal(facts?.signature_item, 'Crepe de doce de leite')
  assert.deepEqual(facts?.languages, ['pt', 'fr'])
})

// ── 3. No place_details row: falls back to the answers ───────────────────────

test('BR-B2B-044 item 3 · no place_details row: the answers carry everything, delivery and reservations from the amenities', () => {
  const answers = A({
    category: 'restaurant',
    subtypes: list('pizza'),
    amenities: list('sea_view', 'delivery', 'accepts_reservations', 'wifi'),
    price_range: '3',
    opening_hours: HOURS_ANSWER,
  })
  const expected = {
    category: 'restaurant',
    subtypes: ['pizza'],
    amenities: ['sea_view', 'wifi'],
    has_delivery: true,
    accepts_reservations: true,
    price_range: 3,
    opening_hours: { monday: [{ open: '08:00', close: '12:00' }] },
  }
  // Both "the place could not be read" (null) and "the place has no details row" read the same.
  assert.deepEqual(partnerNarrationFacts(answers, null), expected)
  assert.deepEqual(partnerNarrationFacts(answers, place({ hasDetailsRow: false })), expected)
})

test('BR-B2B-044 item 3 · a place with a details row and no amenities does NOT inherit the submission\'s amenities', () => {
  const facts = partnerNarrationFacts(A({ category: 'bar', amenities: list('sea_view', 'wifi') }), place())
  assert.ok(facts)
  assert.ok(!('amenities' in facts))
})
