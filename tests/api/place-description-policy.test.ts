/**
 * WHAT TUGGI SAYS ABOUT A PARTNER'S PLACE — the rule, proved without a database.
 *
 * WHAT THIS SUITE IS DEFENDING. `BR-B2B-016`, item 1, is the difference the paid tier buys, and it
 * is the only thing separating the two tiers: the free one is the direction and the NAME, the paid
 * one adds a description produced from what the establishment sent. Item 9 is the consequence — a
 * free-tier place does not trigger produced narration, the first named exception to
 * `BR-CONTEUDO-001` mode 2. A decision that leaks in either direction is money: a paying partner
 * published mute, or a free one getting the paid tier for nothing.
 *
 * Mutations that turn this suite red:
 *  · reading the tier as anything other than `paymentStance`, which is how `undeclared` would
 *    quietly start counting as paying;
 *  · letting the rule reach a curated POI, which is 2.2 million records it must not touch;
 *  · accepting an exception without the reason that makes it auditable (`BR-B2B-016`, item 1, as
 *    the operator qualified it on 2026-08-26);
 *  · offering the exception where there is no rule to break, which records a decision nobody took;
 *  · sending a question the partner did not answer into the generator's input (`BR-B2B-025`: Tuggi
 *    narrates what the establishment asserts, and an unanswered question asserts nothing);
 *  · reading the audio target as the top of the band instead of its middle.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  derivePartnerPlan,
  paymentStance,
  planFactsFromRow,
  type PartnerPlan,
  type PlanKind,
  type PlanSource,
} from '@/lib/clients/partner-plan'
import {
  PARTNER_AUDIO_SECONDS,
  PARTNER_STORY_FIELDS,
  describeDescriptionPolicy,
  normalizedHandle,
  partnerStoryInput,
  type DescriptionException,
} from '@/lib/partnerships/place-description-policy'

const CLIENT = '11111111-1111-1111-1111-111111111111'

function plan(kind: PlanKind): PartnerPlan {
  return {
    source: 'registration',
    kind,
    feeCents: kind === 'paid' ? 9900 : null,
    courtesyReason: kind === 'courtesy' ? 'acordo comercial' : null,
    requested: null,
    divergence: null,
  }
}

const EXCEPTION: DescriptionException = {
  at: '2026-08-26T12:00:00.000Z',
  by: 'suporte@tuggi.app',
  reason: 'cortesia acordada até a assinatura do contrato',
}

// ── The rule itself ────────────────────────────────────────────────────────────────────────────

test('BR-B2B-016 item 1 · a partner that is not paying gets the name and nothing beyond it', () => {
  const decision = describeDescriptionPolicy({
    partnerClientId: CLIENT,
    plan: plan('undeclared'),
    exception: null,
  })

  assert.equal(decision.policy, 'name_only')
  assert.equal(decision.reason, 'free_tier')
  // Item 9: no produced narration for this place. `mayGenerate` is that sentence in code.
  assert.equal(decision.mayGenerate, false)
  assert.equal(decision.mayException, true)
})

test('BR-B2B-016 item 1 · the paid tier adds the description, out of the partner input', () => {
  const decision = describeDescriptionPolicy({
    partnerClientId: CLIENT,
    plan: plan('paid'),
    exception: null,
  })

  assert.equal(decision.policy, 'partner_story')
  assert.equal(decision.reason, 'paid_tier')
  assert.equal(decision.mayGenerate, true)
  // Nothing to except: the description is already theirs, and recording an exception here would be
  // a row claiming a decision nobody took.
  assert.equal(decision.mayException, false)
})

test('BR-B2B-017 item 6 · a courtesy is not a payment, and it does not buy the description', () => {
  // `courtesy` and `undeclared` both read `not_paying` in `paymentStance`, which is TRUE about the
  // money: neither is billing anything today. A courtesy that unlocked the paid tier by itself
  // would be the tier being granted by a field on the registration instead of by a contract.
  for (const kind of ['courtesy', 'undeclared', 'free', 'requested'] as PlanKind[]) {
    const decision = describeDescriptionPolicy({
      partnerClientId: CLIENT,
      plan: plan(kind),
      exception: null,
    })
    assert.equal(decision.policy, 'name_only', `${kind} must not buy the description`)
  }
})

test('BR-B2B-016 · the rule never reaches a POI of the catalogue', () => {
  const decision = describeDescriptionPolicy({
    partnerClientId: null,
    plan: null,
    exception: null,
  })

  assert.equal(decision.policy, 'curation')
  assert.equal(decision.reason, 'not_a_partner')
  assert.equal(decision.mayGenerate, true)
  assert.equal(decision.mayException, false)
})

test('a place pointing at a client that did not resolve is treated as not paying', () => {
  // The safe error. A dangling link that read as `paid` would hand the paid tier to a partner
  // nobody can invoice; reading it as free shows a lock the operator can lift with a reason.
  const decision = describeDescriptionPolicy({
    partnerClientId: CLIENT,
    plan: null,
    exception: null,
  })

  assert.equal(decision.policy, 'name_only')
})

// ── The operator's exception ───────────────────────────────────────────────────────────────────

test("BR-B2B-016 item 1 · the operator's exception lifts the rule, and travels with its reason", () => {
  const decision = describeDescriptionPolicy({
    partnerClientId: CLIENT,
    plan: plan('undeclared'),
    exception: EXCEPTION,
  })

  assert.equal(decision.policy, 'partner_story')
  assert.equal(decision.reason, 'operator_exception')
  assert.equal(decision.mayGenerate, true)
  // The whole record, so the screen can say who and when — not just that a rule is off.
  assert.deepEqual(decision.exception, EXCEPTION)
})

test('the exception never explains a decision the tier already made', () => {
  // A paying partner carrying a stale exception row must still read `paid_tier`: the reason is what
  // the screen prints, and printing `exceção do operador` over a signed contract would send the
  // operator to undo an exception that decides nothing.
  const decision = describeDescriptionPolicy({
    partnerClientId: CLIENT,
    plan: plan('paid'),
    exception: EXCEPTION,
  })

  assert.equal(decision.reason, 'paid_tier')
  assert.equal(decision.exception, null)
})

// ── The input the generator is given ───────────────────────────────────────────────────────────

test('BR-B2B-025 · an unanswered question never reaches the generator', () => {
  const input = partnerStoryInput({
    story_founder: 'O Cozi + nasceu do King Gastronomia, pelas mãos do chef Carlos Braga.',
    story_before: '   ',
    story_unique: 'Gastronomia feita com afeto, do café da manhã ao almoço.',
    // `story_event` absent entirely — the partner skipped it.
    instagram: '@cozimais.cf',
  })

  assert.ok(input)
  assert.deepEqual(input.blocks.map((b) => b.id), ['story_founder', 'story_unique'])
  // Blank and absent are the same thing here: a question with no answer asserts nothing, and
  // sending its label would have the model narrate the gap.
  assert.equal(input.blocks.some((b) => b.id === 'story_before'), false)
})

test('BR-B2B-011 gate 2 · no story at all is reported, never invented', () => {
  // The minimum registration and nothing more is clause (a) of gate 2 — and the gate is a person's
  // to apply. This function only says there is nothing to tell.
  assert.equal(partnerStoryInput({ instagram: '@cozimais.cf' }), null)
  assert.equal(partnerStoryInput({ story_founder: '  ' }), null)
  assert.equal(partnerStoryInput(null), null)
})

test('the four story questions are the four the form asks', () => {
  assert.deepEqual(
    PARTNER_STORY_FIELDS.map((f) => f.id),
    ['story_founder', 'story_before', 'story_unique', 'story_event']
  )
  // The label the model reads is English and semantic. Coupling it to the form's Portuguese copy
  // would let a `design` change rewrite the generator's input in silence.
  for (const field of PARTNER_STORY_FIELDS) {
    assert.match(field.label, /^[a-z ]/)
  }
})

test('the social handle is what TTS can pronounce, not what the partner typed', () => {
  // The field is free text and arrives in all three shapes. A whole URL left in becomes
  // "h t t p s colon slash slash" inside the narration.
  assert.equal(normalizedHandle('@cozimais.cf'), 'cozimais.cf')
  assert.equal(normalizedHandle('cozimais.cf'), 'cozimais.cf')
  assert.equal(normalizedHandle('https://www.instagram.com/cozimais.cf/'), 'cozimais.cf')
  assert.equal(normalizedHandle('instagram.com/cozimais.cf?igshid=abc'), 'cozimais.cf')
  assert.equal(normalizedHandle('   '), null)
  assert.equal(normalizedHandle(null), null)
})

test('the audio target is the middle of the 10–15s band the operator asked for', () => {
  // Aiming at the ceiling produces text that overruns it, because the character limit is derived
  // from the target. 2026-08-26: "uma descrição para um áudio de 10 a 15s".
  assert.equal(PARTNER_AUDIO_SECONDS.min, 10)
  assert.equal(PARTNER_AUDIO_SECONDS.max, 15)
  assert.ok(PARTNER_AUDIO_SECONDS.target > PARTNER_AUDIO_SECONDS.min)
  assert.ok(PARTNER_AUDIO_SECONDS.target < PARTNER_AUDIO_SECONDS.max)
})

// ── The row the two surfaces read ──────────────────────────────────────────────────────────────

test('BR-B2B-017 item 6 · an absent fee stays absent, and a zero is not a price', () => {
  // The row `core.cms_list_places` and `core.cms_place_description_facts` both answer with. The
  // Places card and the description studio build facts through THIS, so they cannot disagree
  // about the same partner.
  const facts = planFactsFromRow({
    partner_client_id: CLIENT,
    monthly_fee_cents: null,
    is_courtesy: false,
    courtesy_reason: null,
    plan_choice: 'map_only',
    contract_tier: 'free',
  })

  assert.equal(facts.fee.monthlyFeeCents, null, 'absent is not zero')
  assert.equal(facts.planChoice, 'map_only')
  assert.equal(facts.contractTier, 'free')
  assert.equal(paymentStance(derivePartnerPlan(facts).kind), 'not_paying')
})

test('the Places card reads paying only where a contract charges and a fee exists', () => {
  // Measured on 2026-08-26: of the 26 partner places, 3 carry `tier = paid` with a real monthly
  // fee and 23 carry `tier = free`. This is the shape of those 3.
  const facts = planFactsFromRow({
    partner_client_id: CLIENT,
    monthly_fee_cents: 9900,
    is_courtesy: false,
    courtesy_reason: null,
    plan_choice: 'map_and_description',
    contract_tier: 'paid',
  })

  const derived = derivePartnerPlan(facts)
  assert.equal(derived.source, 'contract')
  assert.equal(paymentStance(derived.kind), 'paying')
})

test('a tier the contract column does not know reads as no contract at all', () => {
  // `partner_contracts.tier` is free text in the column. Passing an unknown value through would
  // make `derivePartnerPlan` branch on a tier that decides nothing; `null` is the honest reading
  // of a value nobody can price, and it falls back to the registration.
  const facts = planFactsFromRow({
    partner_client_id: CLIENT,
    monthly_fee_cents: 9900,
    is_courtesy: false,
    courtesy_reason: null,
    plan_choice: null,
    contract_tier: 'enterprise',
  })

  assert.equal(facts.contractTier, null)
  assert.equal(derivePartnerPlan(facts).source, 'registration')
})

test('a place with no partner behind it has no plan, and the card shows no badge', () => {
  const facts = planFactsFromRow({ partner_client_id: null })
  assert.equal(facts.clientId, null)
  // 257 of the 283 places measured on 2026-08-26. The screen skips the badge on these rather than
  // printing `não pagante` about the curated catalogue.
  assert.equal(describeDescriptionPolicy({ partnerClientId: null, plan: null, exception: null }).policy, 'curation')
})

// ── What the two surfaces print ────────────────────────────────────────────────────────────────

test('the plan source has a word in the three locales, on both surfaces', () => {
  // The badge says WHETHER they pay; the source says whose answer that is. `cadastro` about a
  // partner with no contract is a different conversation from `contrato` — the first is somebody's
  // pending work, the second is what they signed. A missing key renders the key name on screen.
  const sources: PlanSource[] = ['contract', 'registration', 'proposal']

  for (const locale of ['pt', 'en', 'es']) {
    const messages = JSON.parse(
      readFileSync(resolve(import.meta.dirname, `../../messages/${locale}.json`), 'utf8')
    )
    // The stance badge is shared with the clients directory and the fiscal tab — same words.
    for (const stance of ['paying', 'not_paying']) {
      assert.equal(typeof messages.Clients?.stance?.[stance], 'string', `${locale}.Clients.stance.${stance}`)
    }
    for (const source of sources) {
      const word = messages.Modals?.PartnerDescription?.plan_source?.[source]
      assert.equal(typeof word, 'string', `${locale} is missing plan_source.${source}`)
      assert.equal(word.trim().length > 0, true, `${locale}.plan_source.${source} is empty`)
    }
  }
})

test('every PlanKind collapses to a stance the badge can draw', () => {
  // `paymentStance` is total over the five kinds, and the two surfaces render its result directly.
  // A sixth kind added without a branch here would reach the badge as `undefined`.
  for (const kind of ['paid', 'courtesy', 'undeclared', 'free', 'requested'] as PlanKind[]) {
    const stance = paymentStance(kind)
    assert.ok(stance === 'paying' || stance === 'not_paying', `${kind} has no stance`)
  }
})

test('a faixa do parceiro NUNCA some em silêncio quando a leitura falha', () => {
  // Custou uma volta em 2026-08-26: qualquer erro devolvia `null`, que na tela é idêntico a "este
  // local não tem parceiro". O operador abriu a aba, viu o estúdio de sempre e não tinha o que
  // reportar. Uma faixa que se apaga sozinha quando quebra ensina que está tudo certo.
  const gate = readFileSync(
    resolve(import.meta.dirname, '../../components/entity-management/PartnerDescriptionGate.tsx'),
    'utf8'
  )

  // O ramo de erro vem ANTES do `return null`, senão ele nunca é alcançado.
  const errorBranch = gate.indexOf('if (error) {')
  const silentBranch = gate.indexOf("view.decision.policy === 'curation') return null")
  assert.ok(errorBranch > 0, 'the gate has no error branch')
  assert.ok(silentBranch > errorBranch, 'the silent return comes before the error branch')
  // A mensagem do servidor chega à tela: sem ela, `PGRST202` é indistinguível de qualquer 503.
  assert.match(gate, /error instanceof Error \? error\.message : String\(error\)/)

  // E o texto do estado de erro existe nos três locales.
  for (const locale of ['pt', 'en', 'es']) {
    const messages = JSON.parse(
      readFileSync(resolve(import.meta.dirname, `../../messages/${locale}.json`), 'utf8')
    )
    const block = messages.Modals?.PartnerDescription?.unavailable
    assert.equal(typeof block?.heading, 'string', `${locale} is missing unavailable.heading`)
    assert.equal(typeof block?.body, 'string', `${locale} is missing unavailable.body`)
  }
})

test('o selo é um símbolo só, e ele mantém o nome acessível que a palavra carregava', () => {
  // DS-A11Y-003 aceita cor + ícone + forma sem a palavra, mas DS-A11Y-004 não aceita perder o
  // NOME: sem `aria-label` o leitor de tela anuncia o desenho, ou nada.
  const badge = readFileSync(
    resolve(import.meta.dirname, '../../components/admin/clients/shared/PaymentStanceBadge.tsx'),
    'utf8'
  )

  assert.match(badge, /role="img"/)
  assert.match(badge, /aria-label=\{label\}/)
  assert.match(badge, /title=\{label\}/)
  // UMA renderização, então um `aria-hidden`. Duas seriam duas variantes, e é justamente isso que
  // o padrão de 2026-08-26 removeu.
  assert.equal(badge.split('aria-hidden="true"').length - 1, 1)
})

test('o símbolo é o padrão, e nenhuma tela precisa pedir por ele', () => {
  // Pedido do operador em 2026-08-26: "podemos padronizar esse simbolo em todos os locais". Uma
  // prop `compact` faria do padrão algo que cada chamador precisa lembrar de pedir, e a sexta tela
  // seria a que esqueceu — que é como um design system deixa de ser um.
  const root = resolve(import.meta.dirname, '../..')
  const callers = [
    'app/[locale]/places/page.tsx',
    'components/admin/clients/ClientDirectory.tsx',
    'components/admin/clients/tabs/FiscalPaymentsTab.tsx',
    'components/entity-management/PartnerDescriptionGate.tsx',
  ]

  for (const caller of callers) {
    const source = readFileSync(resolve(root, caller), 'utf8')
    assert.ok(source.includes('PaymentStanceBadge'), `${caller} stopped using the badge`)
    // `stance` e nada mais: qualquer segunda prop é uma variante nascendo.
    assert.equal(
      /<PaymentStanceBadge\s+stance=\{[^}]+\}\s*\/>/.test(source),
      true,
      `${caller} passes something other than stance to the badge`
    )
  }
})
