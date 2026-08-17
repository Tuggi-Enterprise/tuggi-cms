/**
 * The partnership contract — #342.
 *
 * Covers the three things the card says this feature cannot get wrong:
 *   1. BR-B2B-017 — the value is frozen at generation and a later edit of the registration
 *      moves neither the contract nor the hash (the card's obligatory case);
 *   2. CPC arts. 411 and 434 — the trail records the hash of the exact document, the
 *      server's timestamp, the IP, the user agent and the template version;
 *   3. the acceptance is idempotent per contract, which is the premise the `design` copy
 *      depends on (spec §4.3: "se já tiver dado certo, a gente não assina duas vezes").
 *
 * Plus the clause policy each rule requires to be in the instrument, asserted against the
 * RENDERED text and not against the template source.
 *
 * Run with: npm run test:api
 */

import { test, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'

import {
  buildSnapshot,
  contractChecklist,
  feeDivergence,
  formatFee,
  resolvePlatformOwner,
  type ContractClient,
  type ContractSnapshot,
  type GenerationChoices,
  type PlatformOwnerLookup,
  type RegularityEvidence,
} from '@/lib/contract/snapshot'
import {
  ACTIVE_TEMPLATE_VERSION,
  ELECTRONIC_ACCEPTANCE_CLAUSE_ID,
  ELECTRONIC_ACCEPTANCE_CLAUSE_TITLE,
  GRACE_PERIOD_DAYS,
  SUSPENSION_DAY,
  TERMINATION_NOTICE_DAYS,
  activeTemplate,
  renderClauses,
  templateByVersion,
} from '@/lib/contract/template'
import { CONTRACT_LOCALE, contractPath } from '@/lib/contract/link'
import { isSha256Hex, sha256Hex, shortHash } from '@/lib/contract/hash'
import { hashSingleUseToken } from '@/lib/security/single-use-token'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

// ── Fixtures ───────────────────────────────────────────────────────────────────────────

/**
 * The Tuggi side is a `core.clients` row flagged `is_platform_owner` — not configuration
 * (#342, 2026-08-16). The fixture is a registration, exactly like the partner's, because
 * that is now the single owner of those five facts.
 */
function platformOwner(overrides: Partial<ContractClient> = {}): ContractClient {
  return {
    id: 'tuggi',
    name: 'Tuggi',
    company_name: 'Tuggi Tecnologia Ltda.',
    email: 'suporte@tuggi.app',
    status: 'approved',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    address: 'Rua Exemplo, 100',
    city: 'Búzios',
    state: 'RJ',
    postal_code: '28950-000',
    tax_id: '11222333000181',
    legal_representative_name: 'Fulana de Tal',
    legal_representative_role: 'Sócia-administradora',
    is_platform_owner: true,
    ...overrides,
  } as ContractClient
}

function ownerLookup(overrides: Partial<ContractClient> = {}): PlatformOwnerLookup {
  return { state: 'found', client: platformOwner(overrides) }
}

const OWNER = ownerLookup()

const REGULAR: RegularityEvidence = {
  businessLicenseDocument: true,
  incorporationDocument: true,
  businessLicenseValidUntil: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10),
}

function client(overrides: Partial<ContractClient> = {}): ContractClient {
  return {
    id: 'client-1',
    name: 'Cantina do Antônio',
    company_name: 'Cantina do Antônio Ltda.',
    email: 'antonio@cantina.com.br',
    status: 'approved',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    address: 'Rua das Pedras, 10',
    city: 'Búzios',
    state: 'RJ',
    postal_code: '28950-000',
    tax_id: '12345678000195',
    legal_representative_name: 'Antônio Silva',
    legal_representative_role: 'Sócio',
    commission_rate: 0.2,
    monthly_fee_cents: 10_000,
    is_courtesy: false,
    ...overrides,
  } as ContractClient
}

const PAID: GenerationChoices = { tier: 'paid', paymentMethod: 'pix', qrDeliveryDays: 15 }

function snapshotOf(overrides: Partial<ContractClient> = {}, choices: GenerationChoices = PAID): ContractSnapshot {
  return buildSnapshot(client(overrides), choices, {
    platformOwner: OWNER,
    regularity: REGULAR,
    templateVersion: ACTIVE_TEMPLATE_VERSION,
  })
}

function renderedText(snapshot: ContractSnapshot): string {
  return renderClauses(snapshot)
    .map((clause) => `${clause.title}\n${clause.paragraphs.join('\n')}`)
    .join('\n')
}

// ── BR-B2B-017 — the value is frozen at generation, and the registration moves on ──────

test('BR-B2B-017: editing the registration after acceptance changes neither the contract nor its hash — the card case', () => {
  const snapshot = snapshotOf({ monthly_fee_cents: 10_000 })
  const hashAtAcceptance = sha256Hex(new TextEncoder().encode(renderedText(snapshot)))

  assert.equal(snapshot.monthlyFeeCents, 10_000)
  assert.match(renderedText(snapshot), /R\$\s?100,00/)

  // The operator edits the registration afterwards. This is the whole trap: the field is
  // the value of the NEXT contract, and the signed one keeps its own.
  const edited = client({ monthly_fee_cents: 25_000 })

  assert.equal(snapshot.monthlyFeeCents, 10_000, 'the snapshot must not follow the registration')
  assert.equal(
    sha256Hex(new TextEncoder().encode(renderedText(snapshot))),
    hashAtAcceptance,
    'the document rendered from the snapshot must not change'
  )
  assert.doesNotMatch(renderedText(snapshot), /R\$\s?250,00/)

  const divergence = feeDivergence(snapshot, edited)
  assert.equal(divergence.diverges, true)
  assert.equal(divergence.registrationFeeCents, 25_000)
})

test('BR-B2B-017: no divergence note while the registration still says what the contract says', () => {
  const snapshot = snapshotOf({ monthly_fee_cents: 10_000 })
  assert.equal(feeDivergence(snapshot, client()).diverges, false)
})

test('BR-B2B-017 item 5: the contract states that changing the registration does not change it', () => {
  assert.match(renderedText(snapshotOf()), /termo aditivo com novo aceite/i)
})

// ── BR-B2B-017 item 6 — absent is not zero ─────────────────────────────────────────────

function checklistIds(overrides: Partial<ContractClient>, choices = PAID, regularity = REGULAR): string[] {
  return contractChecklist(client(overrides), choices, { platformOwner: OWNER, regularity }).missing.map(
    (item) => item.id
  )
}

test('BR-B2B-017 item 6: a missing monthly fee blocks generation', () => {
  assert.ok(checklistIds({ monthly_fee_cents: null }).includes('monthly_fee'))
})

test('BR-B2B-017 item 6: a typed zero does NOT count as courtesy', () => {
  const missing = checklistIds({ monthly_fee_cents: 0, is_courtesy: false })
  assert.ok(missing.includes('monthly_fee'))
})

test('BR-B2B-017 item 6: courtesy with a reason releases generation, and freezes no value', () => {
  const overrides = { monthly_fee_cents: null, is_courtesy: true, courtesy_reason: 'Parceiro fundador' }
  assert.deepEqual(checklistIds(overrides), [])

  const snapshot = snapshotOf(overrides)
  assert.equal(snapshot.isCourtesy, true)
  assert.equal(snapshot.monthlyFeeCents, null)
  assert.match(renderedText(snapshot), /regime de cortesia/i)
})

test('BR-B2B-017 item 6: courtesy without a reason is not a decision', () => {
  assert.ok(
    checklistIds({ monthly_fee_cents: null, is_courtesy: true, courtesy_reason: null }).includes('courtesy_reason')
  )
})

test('BR-B2B-017: the free tier needs no fee and no payment method', () => {
  const free: GenerationChoices = { tier: 'free', paymentMethod: null, qrDeliveryDays: 15 }
  assert.deepEqual(checklistIds({ monthly_fee_cents: null }, free), [])
  assert.equal(snapshotOf({ monthly_fee_cents: null }, free).monthlyFeeCents, null)
})

test('BR-B2B-017, 3rd edge case: the paid tier does not generate without an agreed payment method', () => {
  assert.ok(checklistIds({}, { tier: 'paid', paymentMethod: null, qrDeliveryDays: 15 }).includes('payment_method'))
})

// ── BR-B2B-022 — the entry gate is a closed list of documents ──────────────────────────

test('BR-B2B-022 item 3: no licence, no contract', () => {
  const missing = contractChecklist(client(), PAID, {
    platformOwner: OWNER,
    regularity: { ...REGULAR, businessLicenseDocument: false },
  }).missing.map((item) => item.id)
  assert.ok(missing.includes('business_license'))
})

test('BR-B2B-022 item 3: an expired licence is an absent licence', () => {
  const missing = contractChecklist(client(), PAID, {
    platformOwner: OWNER,
    regularity: { ...REGULAR, businessLicenseValidUntil: '2020-01-01' },
  }).missing.map((item) => item.id)
  assert.ok(missing.includes('business_license_expired'))
})

test('BR-B2B-022 item 3: no incorporation document, no contract', () => {
  const missing = contractChecklist(client(), PAID, {
    platformOwner: OWNER,
    regularity: { ...REGULAR, incorporationDocument: false },
  }).missing.map((item) => item.id)
  assert.ok(missing.includes('incorporation'))
})

// ── BR-B2B-031 — the same gate, restated for the two facts it adds over BR-B2B-022 item 3:
// the block reaches BOTH tiers (including the free one), and an undated licence blocks the
// same as an expired one. `loadRegularity`, in the route, only maps the conference's raw
// date into `businessLicenseValidUntil` — the comparison against `now` proven here is the
// whole of the applied gate; there is no second copy of it to audit at the route layer.

test('BR-B2B-031 item 2: an expired licence blocks a NEW contract on the free tier too', () => {
  const free: GenerationChoices = { tier: 'free', paymentMethod: null, qrDeliveryDays: 15 }
  const missing = contractChecklist(client(), free, {
    platformOwner: OWNER,
    regularity: { ...REGULAR, businessLicenseValidUntil: '2020-01-01' },
  }).missing.map((item) => item.id)
  assert.ok(missing.includes('business_license_expired'), 'the free tier is not an exception')
})

test('BR-B2B-031, 1st edge case: a licence seen with no date blocks the same as an expired one', () => {
  const missing = contractChecklist(client(), PAID, {
    platformOwner: OWNER,
    regularity: { ...REGULAR, businessLicenseValidUntil: null },
  }).missing.map((item) => item.id)
  assert.ok(missing.includes('business_license_validity'), 'undated is treated as absent, same as vencido')
})

test('BR-B2B-031: a renewed licence (valid date, future) releases the free tier — the other direction of the mutation', () => {
  const free: GenerationChoices = { tier: 'free', paymentMethod: null, qrDeliveryDays: 15 }
  const missing = contractChecklist(client(), free, { platformOwner: OWNER, regularity: REGULAR }).missing.map(
    (item) => item.id
  )
  assert.equal(
    missing.some((id) => id.startsWith('business_license')),
    false,
    'a licence within validity blocks nothing, on either tier'
  )
})

test('BR-B2B-022 item 3: no legal representative role, no contract', () => {
  assert.ok(checklistIds({ legal_representative_role: undefined }).includes('representative_role'))
})

test('BR-B2B-022 item 4: regularity is a continuing obligation inside the instrument', () => {
  const text = renderedText(snapshotOf())
  assert.match(text, /obriga-se a manter, durante toda a vigência/i)
  assert.match(text, /comunicar à TUGGI/i)
  assert.match(text, /causa de encerramento/i)
})

test('BR-B2B-022: every checklist item names where it is resolved', () => {
  const result = contractChecklist(client({ tax_id: undefined }), PAID, {
    platformOwner: OWNER,
    regularity: { ...REGULAR, businessLicenseDocument: false },
  })
  assert.equal(result.ready, false)
  for (const item of result.missing) {
    assert.ok(item.label.length > 0 && item.where.length > 0, `${item.id} has to say where`)
  }
})

/**
 * BR-B2B-022, item 3, and CLAUDE.md §6 — a name that lies is worse than a name that is bad.
 *
 * The partner form has asked for NO file since 2026-08-16: the papers are checked in person before
 * the link is sent, and `loadRegularity` reads the `ConferenceRecord` inside the review annotation.
 * So `Alvará de funcionamento anexado` named an act nobody performs and `formulário do parceiro`
 * sent the operator to a screen with no field for it — a checklist whose whole job is to say where.
 */
test('BR-B2B-022 item 3: the document items point at the conference band, not at the form', () => {
  const missing = contractChecklist(client(), PAID, {
    platformOwner: OWNER,
    regularity: { businessLicenseDocument: false, incorporationDocument: false, businessLicenseValidUntil: null },
  }).missing

  const documents = missing.filter((item) => item.id === 'business_license' || item.id === 'incorporation')
  assert.equal(documents.length, 2, 'both documents are missing in this fixture')

  for (const item of documents) {
    assert.match(item.where, /Conferência presencial/, `${item.id} must name where the evidence is`)
    assert.equal(/formul[áa]rio do parceiro/i.test(item.where), false, `${item.id} still points at the form`)
    assert.equal(/anexad/i.test(item.label), false, `${item.id} still promises an upload`)
  }

  // The band is the one the operator reads at the top of the conference section, so the label on the
  // checklist and the heading on the screen are the same words.
  const heading = JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'messages/pt.json'), 'utf8')
  ).PartnerProposals.conference.heading
  assert.equal(heading, 'Conferência presencial')
  for (const item of documents) assert.ok(item.where.includes(heading))

  // The two validity branches point at the same place: a `where` that drifts on one of them sends
  // somebody to a screen that cannot answer.
  for (const regularity of [
    { businessLicenseDocument: true, incorporationDocument: true, businessLicenseValidUntil: null },
    { businessLicenseDocument: true, incorporationDocument: true, businessLicenseValidUntil: '2020-01-01' },
  ]) {
    const item = contractChecklist(client(), PAID, { platformOwner: OWNER, regularity }).missing.find(
      (candidate) => candidate.id.startsWith('business_license')
    )
    assert.match(item!.where, /Conferência presencial/)
  }
})

test('BR-B2B-022: an incomplete partner registration blocks the snapshot outright', () => {
  assert.throws(() =>
    buildSnapshot(client({ tax_id: undefined }), PAID, {
      platformOwner: OWNER,
      regularity: REGULAR,
      templateVersion: ACTIVE_TEMPLATE_VERSION,
    })
  )
})

// ── BR-B2B-023 — the qualification of the Tuggi as a party comes from the registration
// flagged `is_platform_owner`, and its absence blocks instead of printing a placeholder into
// an instrument somebody signs. Those five facts had a second owner — five environment
// variables — until 2026-08-16, and changing the address of the company was a deploy.

function ownerChecklist(lookup: PlatformOwnerLookup) {
  return contractChecklist(client(), PAID, { platformOwner: lookup, regularity: REGULAR })
}

test('BR-B2B-023: with no client marked as platform owner the contract is NOT generated, and the message says where', () => {
  const result = ownerChecklist({ state: 'absent' })
  assert.equal(result.ready, false)

  const item = result.missing.find((entry) => entry.id === 'platform_owner')
  assert.ok(item, 'the block has to be a checklist item, not a silently empty CONTRATADA')
  assert.match(item!.label, /dono da plataforma/i)
  assert.match(item!.where, /Fiscal e Pagamentos/i)

  assert.throws(
    () =>
      buildSnapshot(client(), PAID, {
        platformOwner: { state: 'absent' },
        regularity: REGULAR,
        templateVersion: ACTIVE_TEMPLATE_VERSION,
      }),
    /platform_owner/
  )
})

test('BR-B2B-023: two clients marked as owner is a configuration error, and nobody picks the first', () => {
  const result = ownerChecklist({ state: 'ambiguous' })
  assert.equal(result.ready, false)
  assert.ok(result.missing.some((entry) => entry.id === 'platform_owner_ambiguous'))
  assert.equal(resolvePlatformOwner({ state: 'ambiguous' }).party, null)
})

test('BR-B2B-023: each of the five Tuggi facts blocks by NAME, and names the tab that resolves it', () => {
  const cases: [Partial<ContractClient>, string, RegExp, RegExp][] = [
    [{ company_name: undefined, name: '' }, 'provider_legal_name', /Razão social da Tuggi/, /Perfil/],
    [{ tax_id: undefined }, 'provider_tax_id', /CNPJ da Tuggi/, /Fiscal e Pagamentos/],
    [{ address: '  ' }, 'provider_address', /Endereço da Tuggi/, /Perfil/],
    [
      { legal_representative_name: undefined },
      'provider_representative_name',
      /representante legal da Tuggi/,
      /Fiscal e Pagamentos/,
    ],
    [
      { legal_representative_role: '' },
      'provider_representative_role',
      /representante legal da Tuggi/,
      /Fiscal e Pagamentos/,
    ],
  ]

  for (const [overrides, id, label, where] of cases) {
    const result = ownerChecklist(ownerLookup(overrides))
    const item = result.missing.find((entry) => entry.id === id)
    assert.ok(item, `${id} has to appear when the field is empty`)
    assert.match(item!.label, label)
    assert.match(item!.where, where, `${id} has to name the tab, or the operator hunts for the field`)
    assert.equal(result.ready, false)
  }

  // The other direction of the mutation: a complete owner blocks nothing.
  assert.equal(
    ownerChecklist(OWNER).missing.some(
      (entry) => entry.id.startsWith('provider_') || entry.id.startsWith('platform_owner')
    ),
    false
  )
})

test('BR-B2B-023: the qualification printed in the contract is the one in the registration', () => {
  const text = renderedText(snapshotOf())
  assert.match(text, /Tuggi Tecnologia Ltda\./)
  assert.match(text, /11\.222\.333\/0001-81/)
  assert.match(text, /Rua Exemplo, 100, Búzios, RJ, 28950-000/)
  assert.match(text, /Fulana de Tal/)
  assert.match(text, /Sócia-administradora/)

  // And no environment variable is consulted any more: the module that builds the
  // qualification must not reach for `process.env` at all.
  const source = readFileSync(resolve(REPO_ROOT, 'lib/contract/snapshot.ts'), 'utf8')
  assert.doesNotMatch(source, /process\.env/, 'the registration is the only owner of the five facts')
  assert.doesNotMatch(source, /TUGGI_LEGAL_NAME|TUGGI_TAX_ID|TUGGI_ADDRESS|TUGGI_REPRESENTATIVE/)
})

test('BR-B2B-017: editing the OWNER registration moves the NEXT contract and not the signed one', () => {
  const signed = snapshotOf()
  const hashAtAcceptance = sha256Hex(new TextEncoder().encode(renderedText(signed)))

  // The Tuggi moves office. The column is the qualification of the next contract, and the
  // accepted document keeps the one it was accepted with.
  const moved = ownerLookup({ address: 'Avenida Nova, 900', city: 'Rio de Janeiro' })
  const next = buildSnapshot(client(), PAID, {
    platformOwner: moved,
    regularity: REGULAR,
    templateVersion: ACTIVE_TEMPLATE_VERSION,
  })

  assert.match(renderedText(next), /Avenida Nova, 900, Rio de Janeiro/, 'the new contract carries the new address')
  assert.equal(signed.provider.addressLine, 'Rua Exemplo, 100, Búzios, RJ, 28950-000')
  assert.doesNotMatch(renderedText(signed), /Avenida Nova/)
  assert.equal(
    sha256Hex(new TextEncoder().encode(renderedText(signed))),
    hashAtAcceptance,
    'the accepted document keeps its own qualification, hash included'
  )
})

// ── The clauses the card lists, asserted on the rendered document ──────────────────────

test('MP 2.200-2 art. 10 §2º: the electronic acceptance clause is inside the contract', () => {
  const clauses = renderClauses(snapshotOf())
  const clause = clauses.find((item) => item.id === ELECTRONIC_ACCEPTANCE_CLAUSE_ID)
  assert.ok(clause, 'without this clause the external route is not publishable')
  assert.equal(clause!.title, ELECTRONIC_ACCEPTANCE_CLAUSE_TITLE)
  assert.match(clause!.paragraphs.join(' '), /2\.200-2/)
  assert.match(clause!.paragraphs.join(' '), /SHA-256/)
  // The trail it promises is the trail the code records.
  for (const promised of [/endereço IP/i, /agente de usuário/i, /data e a hora do servidor/i]) {
    assert.match(clause!.paragraphs.join(' '), promised)
  }
})

test('BR-B2B-016: the object names both tiers and says which one was contracted', () => {
  const paid = renderedText(snapshotOf())
  assert.match(paid, /FAIXA GRATUITA/)
  assert.match(paid, /FAIXA PAGA/)
  assert.match(paid, /A faixa contratada neste instrumento é a FAIXA PAGA/)

  const free = renderedText(snapshotOf({}, { tier: 'free', paymentMethod: null, qrDeliveryDays: 15 }))
  assert.match(free, /A faixa contratada neste instrumento é a FAIXA GRATUITA/)
})

test('BR-B2B-016: the paid-only clauses are absent from a free-tier contract', () => {
  const ids = renderClauses(snapshotOf({}, { tier: 'free', paymentMethod: null, qrDeliveryDays: 15 })).map((c) => c.id)
  assert.ok(!ids.includes('price_and_payment'))
  assert.ok(!ids.includes('payment_default'))
  // And the instrument is still the same one — BR-B2B-022 item 2.
  assert.ok(ids.includes('regularity'))
  assert.ok(ids.includes(ELECTRONIC_ACCEPTANCE_CLAUSE_ID))
})

test('BR-B2B-021 item 2: the QR delivery deadline is written, and it comes from the contract', () => {
  const snapshot = snapshotOf({}, { ...PAID, qrDeliveryDays: 7 })
  assert.match(renderedText(snapshot), /7 dias corridos/)
})

test('BR-B2B-018 and BR-B2B-026: vigência starts at signature, cobrança at publication', () => {
  const text = renderedText(snapshotOf())
  assert.match(text, /vigência começa a contar da data da assinatura eletrônica/i)
  assert.match(text, /somente começa a correr na data da publicação/i)
})

test('BR-B2B-019: the dunning calendar in the instrument is the one in the rule', () => {
  const text = renderedText(snapshotOf())
  assert.match(text, new RegExp(`${GRACE_PERIOD_DAYS} dias corridos`))
  assert.match(text, new RegExp(`${SUSPENSION_DAY}º dia`))
  assert.match(text, /o ponto permanece no aplicativo/i)
})

test('BR-B2B-023 item 1: prazo indeterminado, 30 dias, sem multa e sem fidelidade', () => {
  const text = renderedText(snapshotOf())
  assert.match(text, /prazo indeterminado/i)
  assert.match(text, new RegExp(`${TERMINATION_NOTICE_DAYS} dias corridos`))
  assert.match(text, /sem multa/i)
})

test('BR-B2B-023 item 2: no agent names the adjustment index, and the template says so', () => {
  const text = renderedText(snapshotOf())
  assert.match(text, /reajustado anualmente/i)
  assert.match(text, /ÍNDICE A DEFINIR PELO JURÍDICO/)
  // Naming one here would be an agent taking a decision the rule reserves for the lawyer.
  for (const index of [/IPCA/, /IGP-M/, /INPC/, /IGPM/]) {
    assert.doesNotMatch(text, index)
  }
})

test('BR-B2B-023 items 3 and 4: non-exclusivity and the two-way brand licence are in', () => {
  const text = renderedText(snapshotOf())
  assert.match(text, /não é exclusivo em nenhuma das duas direções/i)
  assert.match(text, /licenças terminam com o contrato/i)
})

test('BR-B2B-024: the counterparty is the CNPJ, and a new CNPJ is a new contract', () => {
  const text = renderedText(snapshotOf())
  assert.match(text, /pessoa jurídica identificada pelo CNPJ/i)
  assert.match(text, /CNPJ diverso exige contrato novo/i)
})

test('BR-B2B-025: the establishment answers for what it sends, and the Tuggi does not verify it', () => {
  const text = renderedText(snapshotOf())
  assert.match(text, /informações que fornece à TUGGI são verdadeiras/i)
  assert.match(text, /não apura, confere ou certifica/i)
})

test('BR-MONETIZACAO-039: the commission rate is read from the registration, never a literal', () => {
  assert.match(renderedText(snapshotOf({ commission_rate: 0.35 })), /35,00%/)
  assert.match(renderedText(snapshotOf({ commission_rate: 0.2 })), /20,00%/)

  const source = readFileSync(resolve(REPO_ROOT, 'lib/contract/template.ts'), 'utf8')
  assert.doesNotMatch(source, /\b(20|30|35)\s?%/, 'a percentage typed into the template is a second source of it')
})

test('BR-B2B-027: the instrument states the penalty and its effect, and the POI stays', () => {
  const text = renderedText(snapshotOf())
  assert.match(text, /suspensão da descrição/i)
  assert.match(text, /permanece no aplicativo/i)
})

test('BR-B2B-016 item 2: the contract never promises the partner access, hours or tier', () => {
  assert.match(renderedText(snapshotOf()), /não concede ao ESTABELECIMENTO[^.]*qualquer acesso/i)
})

// ── Versioning — a signed document has to stay renderable ──────────────────────────────

test('a contract renders with ITS OWN template version, and an unknown version fails loudly', () => {
  assert.equal(templateByVersion(ACTIVE_TEMPLATE_VERSION)?.version, ACTIVE_TEMPLATE_VERSION)
  assert.equal(templateByVersion('v0-nao-existe'), null)
  assert.throws(() => renderClauses({ ...snapshotOf(), templateVersion: 'v0-nao-existe' }))
})

test('the active template declares whether a lawyer has reviewed it — and it gates nothing', () => {
  const review = activeTemplate().legalReview
  assert.ok(review.status === 'pending' || review.status === 'approved')
  if (review.status === 'pending') {
    assert.ok(review.pending.length > 0, 'pending has to name which clauses are holding it')
    assert.ok(review.note.length > 0)
  }

  // Since 2026-08-17 the field is a statement, not a rule: it must not claim to stop the
  // sending, because it does not. The refusal it used to describe is gone, and the send
  // going through in this very state is proven further down.
  assert.doesNotMatch(review.note, /não pode ser enviado|nao pode ser enviado/i)
})

// ── The signing link ───────────────────────────────────────────────────────────────────

test('the signing link is pinned to pt, and the Edge Function twin says the same', () => {
  assert.equal(CONTRACT_LOCALE, 'pt')
  assert.equal(contractPath('abc'), '/pt/contrato/abc')

  // The Deno side cannot import this module, so the duplication is held by this assertion.
  const edge = readFileSync(resolve(REPO_ROOT, 'supabase/functions/send-transactional/index.ts'), 'utf8')
  assert.match(edge, /const CONTRACT_LOCALE = 'pt';/)
  assert.match(edge, /\/\$\{CONTRACT_LOCALE\}\/contrato\/\$\{token\}/)
})

test('no href of the contract e-mails is assembled from the request body', () => {
  const edge = readFileSync(resolve(REPO_ROOT, 'supabase/functions/send-transactional/index.ts'), 'utf8')
  const templates = edge.slice(edge.indexOf('function renderContractSign'))
  assert.doesNotMatch(templates, /data\.url/)
  assert.doesNotMatch(templates, /data\.app_url/)
  assert.match(templates, /contractHref\(String\(data\.token \?\? ''\)\)/)
})

test('the hash helpers answer what the receipt shows', () => {
  const bytes = new TextEncoder().encode('contrato')
  const hex = sha256Hex(bytes)
  assert.equal(hex, createHash('sha256').update(bytes).digest('hex'))
  assert.equal(isSha256Hex(hex), true)
  assert.equal(isSha256Hex(hex.toUpperCase()), false)
  assert.equal(shortHash(hex), hex.slice(0, 12).toUpperCase())
})

test('money is Brazilian reais, and only that', () => {
  assert.match(formatFee(10_000), /R\$/)
  assert.equal(formatFee(null), '—')
})

// ── The service, against a fake Postgres: idempotency, the trail and the archive ────────
//
// The fake enforces the ONE constraint the design leans on — `contract_id` is unique in
// `partner_contract_acceptances` — and the storage is a real map of bytes, so the hash the
// trail records is the hash of what was actually stored. Rendering is the real
// `@react-pdf/renderer`: if the PDF pipeline does not run under Node, these go red.

interface FakeTables {
  partner_contracts: Record<string, any>[]
  partner_contract_acceptances: Record<string, any>[]
}

let tables: FakeTables
let objects: Map<string, Uint8Array>
let emails: Record<string, unknown>[]

function createFakeService() {
  const build = (tableName: keyof FakeTables) => {
    const filters: [string, unknown][] = []
    const negated: [string, unknown][] = []
    let operation: 'select' | 'insert' | 'update' | 'upsert' = 'select'
    let payload: any = null
    let ignoreDuplicates = false
    let conflictColumn = ''
    let limit = Infinity

    const matches = () =>
      tables[tableName].filter(
        (row) =>
          filters.every(([column, value]) => (row as any)[column] === value) &&
          negated.every(([column, value]) => (row as any)[column] !== value)
      )

    const apply = () => {
      if (operation === 'update') {
        const rows = matches()
        for (const row of rows) Object.assign(row, payload)
        return rows
      }
      if (operation === 'insert' || operation === 'upsert') {
        if (operation === 'upsert' && ignoreDuplicates) {
          const clash = tables[tableName].some((row) => (row as any)[conflictColumn] === payload[conflictColumn])
          // ON CONFLICT DO NOTHING: no row inserted, and no row returned. The count is
          // what decides the winner, exactly as it does in Postgres.
          if (clash) return []
        }
        const inserted = {
          id: `${tableName}-${tables[tableName].length + 1}`,
          created_at: new Date().toISOString(),
          // The server clock, like the column default it stands for.
          accepted_at: new Date().toISOString(),
          signed_document_hash: null,
          signed_document_path: null,
          ...payload,
        }
        tables[tableName].push(inserted)
        return [inserted]
      }
      return matches().slice(0, limit)
    }

    const chain: any = {
      select: () => chain,
      order: () => chain,
      limit: (value: number) => {
        limit = value
        return chain
      },
      eq: (column: string, value: unknown) => {
        filters.push([column, value])
        return chain
      },
      neq: (column: string, value: unknown) => {
        negated.push([column, value])
        return chain
      },
      is: (column: string, value: unknown) => {
        filters.push([column, value])
        return chain
      },
      update: (next: any) => {
        operation = 'update'
        payload = next
        return chain
      },
      insert: (next: any) => {
        operation = 'insert'
        payload = next
        return chain
      },
      upsert: (next: any, options: any) => {
        operation = 'upsert'
        payload = next
        ignoreDuplicates = Boolean(options?.ignoreDuplicates)
        conflictColumn = options?.onConflict ?? 'id'
        return chain
      },
      maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
      single: async () => {
        const rows = apply()
        return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'no rows' } }
      },
      then: (onFulfilled: (value: any) => unknown) =>
        Promise.resolve({ data: apply(), error: null }).then(onFulfilled),
    }
    return chain
  }

  return {
    schema: () => ({ from: (table: keyof FakeTables) => build(table) }),
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Uint8Array) => {
          objects.set(path, bytes)
          return { error: null }
        },
        download: async (path: string) => {
          const bytes = objects.get(path)
          return bytes
            ? { data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, error: null }
            : { data: null, error: { message: 'not found' } }
        },
      }),
    },
    functions: {
      invoke: async (_name: string, options: { body: Record<string, unknown> }) => {
        emails.push(options.body)
        return { data: { ok: true }, error: null }
      },
    },
  }
}

let contractService: typeof import('@/lib/services/partner-contract-service')

before(async () => {
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseService: () => createFakeService(),
      getSupabaseRouteHandler: () => ({}),
      getSupabaseClient: () => ({}),
    },
  })
  contractService = await import('@/lib/services/partner-contract-service')
})

function resetState() {
  tables = { partner_contracts: [], partner_contract_acceptances: [] }
  objects = new Map()
  emails = []
}

async function generated(overrides: Partial<ContractClient> = {}) {
  resetState()
  const snapshot = snapshotOf(overrides)
  const created = await contractService.createContract({
    clientId: 'client-1',
    snapshot,
    createdBy: 'operator-1',
  })
  assert.equal(created.ok, true)
  const contract = tables.partner_contracts[0] as any
  // The link is opened by the service, not by the test, so `sent_to_email` is set the way
  // production sets it.
  Object.assign(contract, { status: 'sent', sent_to_email: 'antonio@cantina.com.br' })
  return { snapshot, contract, documentHash: created.documentHash! }
}

test('the PDF is produced in Node, stored, and hashed AS STORED', async () => {
  const { contract, documentHash } = await generated()

  const stored = objects.get(contract.document_path)
  assert.ok(stored && stored.byteLength > 800, 'a real PDF came out of the renderer')
  assert.equal(new TextDecoder().decode(stored!.slice(0, 5)), '%PDF-')
  assert.equal(sha256Hex(stored!), documentHash)
  assert.equal(isSha256Hex(documentHash), true)
})

test('CPC arts. 411 and 434: the acceptance records hash, version, IP, user agent and the server stamp', async () => {
  const { contract } = await generated()

  const outcome = await contractService.acceptContract({
    contract: contract as any,
    signingToken: 'a'.repeat(43),
    signerName: 'Antônio Silva',
    signerRole: 'Sócio',
    ipAddress: '203.0.113.7',
    userAgent: 'Mozilla/5.0 (iPhone)',
  })

  assert.equal(outcome.ok, true)
  if (!outcome.ok) return

  const acceptance = outcome.acceptance
  assert.equal(acceptance.document_hash, contract.document_hash, 'the hash of the document that was displayed')
  assert.equal(acceptance.template_version, contract.template_version)
  assert.equal(acceptance.ip_address, '203.0.113.7')
  assert.equal(acceptance.user_agent, 'Mozilla/5.0 (iPhone)')
  assert.equal(acceptance.recipient_email, 'antonio@cantina.com.br')
  assert.ok(Number.isFinite(new Date(acceptance.accepted_at).getTime()))

  // Two hashes, two questions: what was read, and what is archived. The archive carries
  // the first one printed inside it, which is why they cannot be the same number.
  assert.equal(isSha256Hex(acceptance.signed_document_hash!), true)
  assert.notEqual(acceptance.signed_document_hash, acceptance.document_hash)
  assert.equal(sha256Hex(objects.get(acceptance.signed_document_path!)!), acceptance.signed_document_hash)
})

/**
 * What a partner actually reads in the PDF.
 *
 * `@react-pdf/renderer` writes the page text as hex strings inside Flate-compressed content
 * streams, so `bytes.includes('203.0.113.7')` answers `false` on a document that prints the
 * IP in 10pt Helvetica — a needle search on the raw file is a test that passes for the wrong
 * reason. This inflates every stream and decodes the `TJ`/`Tj` operands back to text: the
 * standard-14 Helvetica this document uses is WinAnsi, so each hex pair is the character.
 * Kerning splits a word across several `<...>` chunks inside one array, which is why the
 * chunks of an array are joined before anything is searched.
 */
function shownText(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes)
  const raw = buf.toString('latin1')

  let content = ''
  const streams = /stream\r?\n/g
  let match: RegExpExecArray | null
  while ((match = streams.exec(raw))) {
    const start = match.index + match[0].length
    const end = raw.indexOf('endstream', start)
    if (end < 0) continue
    try {
      content += inflateSync(buf.subarray(start, end)).toString('latin1')
    } catch {
      // Not every stream is text and not every stream is deflated; those are not the ones
      // this test is about.
    }
  }

  return (content.match(/\[[\s\S]*?\]\s*TJ|<[0-9a-fA-F\s]*?>\s*Tj/g) ?? [])
    .map((operand) =>
      (operand.match(/<[0-9a-fA-F\s]*?>/g) ?? [])
        .map((hex) => Buffer.from(hex.slice(1, -1).replace(/\s/g, ''), 'hex').toString('latin1'))
        .join('')
    )
    .join('\n')
}

test('#390 · LGPD art. 6º, III: the copy the PARTNER downloads carries neither the IP nor the user agent', async () => {
  const { contract } = await generated()

  const outcome = await contractService.acceptContract({
    contract: contract as any,
    signingToken: 'a'.repeat(43),
    signerName: 'Antônio Silva',
    signerRole: 'Sócio',
    ipAddress: '203.0.113.7',
    userAgent: 'Mozilla/5.0 (iPhone)',
  })
  assert.equal(outcome.ok, true)
  if (!outcome.ok) return

  const archived = objects.get(outcome.acceptance.signed_document_path!)
  assert.ok(archived, 'the signed copy is in the bucket')

  // The layout wraps long values (the SHA-256 breaks after its first character), so the
  // absence is asserted against a whitespace-free view: a needle cannot hide in a line break.
  const shown = shownText(archived!)
  const packed = shown.replace(/\s+/g, '')
  const packedNeedle = (value: string) => value.replace(/\s+/g, '')

  // The two needles are the fixture's own values, so this cannot pass by rendering nothing:
  // the four facts below prove the appendix is there and was read.
  assert.equal(
    packed.indexOf(packedNeedle('203.0.113.7')),
    -1,
    'the signer IP is not printed in the artefact that travels'
  )
  assert.equal(packed.indexOf(packedNeedle('Mozilla/5.0 (iPhone)')), -1, 'nor is the user agent')

  // And neither are the labels — a row with an empty value is the same leak with worse copy.
  assert.equal(/Endere.oIP/.test(packed), false)
  assert.equal(/Agentedeusu.rio/.test(packed), false)

  // The proof of acceptance is untouched: who signed, under which version, and the hash of
  // what was read (MP 2.200-2, art. 10, §2º).
  assert.ok(shown.indexOf('Termo de aceite eletrônico') >= 0, 'the appendix really did render')
  assert.ok(shown.indexOf('Antônio Silva') >= 0, 'the signer is still named')
  assert.ok(
    packed.indexOf(contract.document_hash) >= 0,
    'and the hash of the accepted document is still printed'
  )
  assert.ok(shown.indexOf('antonio@cantina.com.br') >= 0, 'as is the invited address')
})

test('#390: the trail keeps what the PDF stopped printing — the record does not move', async () => {
  const { contract } = await generated()

  const outcome = await contractService.acceptContract({
    contract: contract as any,
    signingToken: 'a'.repeat(43),
    signerName: 'Antônio Silva',
    signerRole: 'Sócio',
    ipAddress: '203.0.113.7',
    userAgent: 'Mozilla/5.0 (iPhone)',
  })
  assert.equal(outcome.ok, true)
  if (!outcome.ok) return

  // Taking the two facts off the document is not deleting them. They stay in
  // `core.partner_contract_acceptances`, which the database guard makes write-once, and the
  // operator reads them on the internal surface.
  assert.equal(outcome.acceptance.ip_address, '203.0.113.7')
  assert.equal(outcome.acceptance.user_agent, 'Mozilla/5.0 (iPhone)')
})

test('the acceptance is idempotent per contract — one token, one signature', async () => {
  const { contract } = await generated()
  const input = {
    contract: contract as any,
    signingToken: 'a'.repeat(43),
    signerName: 'Antônio Silva',
    signerRole: 'Sócio',
    ipAddress: '203.0.113.7',
    userAgent: 'Mozilla/5.0 (iPhone)',
  }

  const first = await contractService.acceptContract(input)
  const second = await contractService.acceptContract({ ...input, ipAddress: '198.51.100.9' })

  assert.equal(first.ok && second.ok, true)
  if (!first.ok || !second.ok) return

  assert.equal(tables.partner_contract_acceptances.length, 1, 'a second acceptance row is a second version of the fact')
  assert.equal(first.alreadyAccepted, false)
  assert.equal(second.alreadyAccepted, true)
  assert.equal(second.acceptance.accepted_at, first.acceptance.accepted_at, 'the stamp does not move on retry')
  assert.equal(second.acceptance.signed_document_hash, first.acceptance.signed_document_hash)
  assert.equal(second.acceptance.ip_address, '203.0.113.7', 'the retry does not overwrite the first signer')
})

test('the retry sends no second e-mail — one signature, one copy', async () => {
  const { contract } = await generated()
  const input = {
    contract: contract as any,
    signingToken: 'a'.repeat(43),
    signerName: 'Antônio Silva',
    signerRole: 'Sócio',
    ipAddress: '203.0.113.7',
    userAgent: 'agent',
  }

  await contractService.acceptContract(input)
  await contractService.acceptContract(input)

  const signedCopies = emails.filter((body) => body.type === 'partner_contract_signed')
  assert.equal(signedCopies.length, 1)
  // The link is composed inside the function, from the token — never from a URL we send.
  assert.equal((signedCopies[0].data as Record<string, unknown>).token, 'a'.repeat(43))
  assert.ok(!('url' in (signedCopies[0].data as Record<string, unknown>)))
})

test('an acceptance whose archive never landed is FINISHED by the retry, not duplicated', async () => {
  const { contract } = await generated()

  // The crash between the insert and the upload: the row exists, the PDF does not.
  tables.partner_contract_acceptances.push({
    id: 'acceptance-orphan',
    contract_id: contract.id,
    signer_name: 'Antônio Silva',
    signer_role: 'Sócio',
    accepted_at: '2026-08-14T12:00:00.000Z',
    ip_address: '203.0.113.7',
    user_agent: 'agent',
    recipient_email: 'antonio@cantina.com.br',
    template_version: contract.template_version,
    document_hash: contract.document_hash,
    signed_document_hash: null,
    signed_document_path: null,
  })

  const outcome = await contractService.acceptContract({
    contract: contract as any,
    signingToken: 'a'.repeat(43),
    signerName: 'Outra Pessoa',
    signerRole: 'Gerente',
    ipAddress: '198.51.100.9',
    userAgent: 'other',
  })

  assert.equal(outcome.ok, true)
  if (!outcome.ok) return
  assert.equal(tables.partner_contract_acceptances.length, 1)
  assert.equal(outcome.acceptance.signer_name, 'Antônio Silva', 'the first acceptance is the fact')
  assert.equal(outcome.acceptance.accepted_at, '2026-08-14T12:00:00.000Z')
  assert.equal(isSha256Hex(outcome.acceptance.signed_document_hash!), true, 'and its archive now exists')
})

test('`Conferir integridade` compares the STORED file with the recorded hash', async () => {
  const { contract } = await generated()

  const good = await contractService.verifyStoredDocument(contract.document_path, contract.document_hash)
  assert.equal(good.state, 'match')

  objects.set(contract.document_path, new TextEncoder().encode('arquivo trocado'))
  const bad = await contractService.verifyStoredDocument(contract.document_path, contract.document_hash)
  assert.equal(bad.state, 'mismatch')

  const missing = await contractService.verifyStoredDocument('nao/existe.pdf', contract.document_hash)
  assert.equal(missing.state, 'unavailable')
})

test('BR-B2B-026 item 4: the minuta is sent for signature in ANY legal-review state — the operator decides, not the software', async () => {
  const { contract } = await generated()
  const review = activeTemplate().legalReview

  const sent = await contractService.sendForSignature(contract.id, {
    recipientEmail: 'antonio@cantina.com.br',
    sentBy: 'operator-1',
  })

  // Until 2026-08-17 this same call answered `legal_review_pending` and minted no token.
  // The operator took that decision out of the software: BR-B2B-026, item 4 puts the
  // conference before the sending, and the conference is a person's.
  assert.equal(sent.ok, true, `sending must not depend on the review state (it is "${review.status}" here)`)
  if (!sent.ok) return

  assert.match(sent.token, /^[A-Za-z0-9_-]{43}$/, 'a real single-use token came out')
  assert.equal(contract.token_hash, hashSingleUseToken(sent.token), 'and the row holds its hash, not the token')
  assert.equal(contract.token_expires_at, sent.expiresAt)
  assert.equal(contract.sent_by, 'operator-1')
  assert.ok(new Date(sent.expiresAt).getTime() > Date.now(), 'the link has a deadline')
})

test('BR-B2B-026: what still refuses the send is fact about the contract, never opinion about the minuta', async () => {
  const { contract } = await generated()
  Object.assign(contract, { status: 'signed' })

  const resent = await contractService.sendForSignature(contract.id, {
    recipientEmail: 'antonio@cantina.com.br',
    sentBy: 'operator-1',
  })
  assert.equal(resent.ok, false)
  assert.equal(resent.ok === false && resent.reason, 'already_signed')

  const missing = await contractService.sendForSignature('contract-nao-existe', {
    recipientEmail: 'antonio@cantina.com.br',
    sentBy: 'operator-1',
  })
  assert.equal(missing.ok, false)
  assert.equal(missing.ok === false && missing.reason, 'not_found')
})

test('a contract whose template version no longer exists cannot be signed', async () => {
  const { contract } = await generated()
  const outcome = await contractService.acceptContract({
    contract: { ...contract, template_version: 'v0-nao-existe' } as any,
    signingToken: 'a'.repeat(43),
    signerName: 'Antônio Silva',
    signerRole: 'Sócio',
    ipAddress: '203.0.113.7',
    userAgent: 'agent',
  })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.ok === false && outcome.reason, 'unknown_template')
  assert.equal(tables.partner_contract_acceptances.length, 0)
})

test('the raw signing token is never stored — only its SHA-256', async () => {
  const { contract } = await generated()
  const sent = await contractService.sendForSignature(contract.id, {
    recipientEmail: 'antonio@cantina.com.br',
    sentBy: 'operator-1',
  })
  assert.equal(sent.ok, true)
  if (!sent.ok) return
  assert.notEqual(contract.token_hash, sent.token)
  assert.match(contract.token_hash, /^[0-9a-f]{64}$/)
})
