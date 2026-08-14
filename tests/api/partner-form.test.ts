/**
 * The external partner form — #341.
 *
 * Covers the two cases the card names as obligatory (a valid alphanumeric CNPJ is
 * accepted; a reused link writes nothing) plus the guarantees this surface announces:
 * BR-B2B-022 (the regularity gate belongs to the contract, not to the form),
 * BR-B2B-026 (the journey: proposal first, promotion is an authenticated act),
 * DS-COPY-015, DS-COMPONENTE-016 and DS-LAYOUT-005 where they are verifiable without a
 * browser.
 *
 * Run with: npm run test:api
 */

import { test, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  isValidCnpj,
  normalizeCnpj,
  maskCnpjInput,
  formatCnpj,
  calculateCnpjCheckDigits,
  cnpjCharactersMissing,
  CNPJ_REFERENCE_VECTORS,
} from '@/lib/validation/cnpj'
import {
  PARTNER_FORM_FIELDS,
  FORBIDDEN_FIELDS,
  PARTNER_DOCUMENT_KINDS,
  fieldsOfStep,
} from '@/lib/partner-form/fields'
import { validateAnswers, normalizeAnswers, storyNudge } from '@/lib/partner-form/schema'
import { CLIENT_ADMIN_ONLY_FIELDS } from '@/lib/services/client-editable-fields'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

// ── CNPJ — BR-B2B-022 asks for an active CNPJ, and since 2026-07-31 it has letters ──

test('BR-B2B-022: every CNPJ the Serpro reference calls valid is accepted', () => {
  for (const cnpj of CNPJ_REFERENCE_VECTORS.valid) {
    assert.equal(isValidCnpj(normalizeCnpj(cnpj)), true, `${cnpj} should be valid`)
  }
})

test('BR-B2B-022: every CNPJ the Serpro reference calls invalid is refused', () => {
  for (const cnpj of CNPJ_REFERENCE_VECTORS.invalid) {
    assert.equal(isValidCnpj(cnpj), false, `${cnpj} should be refused`)
  }
})

test('BR-B2B-022: an alphanumeric CNPJ is accepted — the card case', () => {
  // The official example published by Serpro. A `^\d{14}$` regex, `type="number"` or a
  // numeric mask refuses this company and passes every test written with old data.
  assert.equal(isValidCnpj('12.ABC.345/01DE-35'), true)
  assert.equal(isValidCnpj('12ABC34501DE35'), true)
  assert.equal(calculateCnpjCheckDigits('12ABC34501DE'), '35')
})

test('BR-B2B-022: an alphanumeric CNPJ with the wrong check digit is refused', () => {
  assert.equal(isValidCnpj('12.ABC.345/01DE-36'), false)
  assert.equal(isValidCnpj('ABCDEFGHIJKL81'), false)
})

test('the mask keeps letters in the root and only digits in the check digits', () => {
  assert.equal(maskCnpjInput('12abc34501de35'), '12.ABC.345/01DE-35')
  assert.equal(maskCnpjInput('12.ABC.345/01DE-AB'), '12.ABC.345/01DE')
  assert.equal(formatCnpj('12ABC'), '12.ABC')
  assert.equal(cnpjCharactersMissing('12.ABC.345'), 6)
})

// ── What the form asks, and what it must never ask ──

test('#341: no banking column and no billing_email can enter the form', () => {
  const asked = new Set(PARTNER_FORM_FIELDS.map((field) => field.id as string))
  for (const forbidden of FORBIDDEN_FIELDS) {
    assert.equal(asked.has(forbidden), false, `${forbidden} must not be asked on a public surface`)
  }
})

test('BR-B2B-026: the fields the form collects that only an admin may write exist in the admin allowlist', () => {
  // Not a formality: `tax_id` and the legal representative sit in CLIENT_ADMIN_ONLY_FIELDS
  // and `pickEditableFields` drops them. A public path that tried to write core.clients
  // would persist nothing and report success — which is why the submission is a proposal
  // and the promotion is authenticated (BR-B2B-026, item 4).
  const adminOnly = new Set<string>(CLIENT_ADMIN_ONLY_FIELDS as readonly string[])
  assert.equal(adminOnly.has('tax_id'), true)
  assert.equal(adminOnly.has('legal_representative_name'), true)
  assert.equal(adminOnly.has('legal_representative_role'), true)
})

test('DS-COPY-015: step 3 has exactly one required question', () => {
  const required = fieldsOfStep(3).filter((field) => field.required)
  assert.equal(required.length, 1)
  assert.equal(required[0].id, 'story_founder')
})

test('DS-LAYOUT-005 / SC 1.3.5: the person-data fields announce an autocomplete token', () => {
  const expected: Record<string, string> = {
    representative_name: 'name',
    representative_email: 'email',
    representative_phone: 'tel',
    trade_name: 'organization',
    address: 'street-address',
    state: 'address-level1',
    city: 'address-level2',
    postal_code: 'postal-code',
  }
  for (const [id, token] of Object.entries(expected)) {
    const field = PARTNER_FORM_FIELDS.find((candidate) => candidate.id === id)
    assert.equal(field?.autoComplete, token, `${id} should announce autocomplete="${token}"`)
  }
})

// ── Validation ──

function completeAnswers(): Record<string, string> {
  return {
    trade_name: 'Cantina do Antônio',
    legal_name: 'Cantina do Antônio Ltda',
    tax_id: '12.ABC.345/01DE-35',
    category: 'restaurant',
    address: 'Rua das Laranjeiras, 120',
    district: 'Centro',
    postal_code: '28950-000',
    city: 'Armação dos Búzios',
    state: 'RJ',
    representative_name: 'Antônio Ferreira',
    representative_role: 'Sócio-administrador',
    representative_email: 'antonio@cantina.com.br',
    representative_phone: '(22) 99999-1234',
    story_founder: 'Meu avô, Antônio, abriu a casa em 1961 num galpão da antiga fábrica do bairro.',
  }
}

test('BR-B2B-022: a submission with no document at all is valid — the gate is on the contract, not on the form', () => {
  const problems = validateAnswers(completeAnswers(), { hasBusinessLicenseFile: false })
  assert.deepEqual(problems, [], 'missing documents must not block sending the form')
})

test('BR-B2B-022 item 4: the licence date is required as soon as a licence file exists', () => {
  const withFile = validateAnswers(completeAnswers(), { hasBusinessLicenseFile: true })
  assert.deepEqual(
    withFile.map((problem) => problem.field),
    ['business_license_valid_until'],
    'a licence without a validity date cannot be checked for expiry'
  )
})

test('BR-B2B-022 item 4: an expired licence date is refused', () => {
  const answers = { ...completeAnswers(), business_license_valid_until: '2020-01-01' }
  const problems = validateAnswers(answers, {
    hasBusinessLicenseFile: true,
    today: new Date('2026-08-14T12:00:00Z'),
  })
  assert.deepEqual(problems, [{ field: 'business_license_valid_until', code: 'license_date_past' }])
})

test('an invalid CNPJ produces the "does not check out" problem, not the incomplete one', () => {
  const answers = { ...completeAnswers(), tax_id: '12.ABC.345/01DE-36' }
  const problems = validateAnswers(answers)
  assert.deepEqual(problems, [{ field: 'tax_id', code: 'cnpj_invalid' }])
})

test('DS-COPY-015: the quality nudges never block, they only classify', () => {
  assert.equal(storyNudge('Rodízio de pizza aos sábados, R$ 89 por pessoa'), 'offer')
  assert.equal(storyNudge('Abriu em 1961.', { required: true }), 'short')
  assert.equal(
    storyNudge('Meu avô, Antônio, abriu a casa em 1961 num galpão da antiga fábrica do bairro.', {
      required: true,
    }),
    null
  )
})

test('the answers are an allowlist: an unknown key is dropped, not persisted', () => {
  const normalized = normalizeAnswers({
    trade_name: '  Cantina  ',
    commission_rate: '0.5',
    iban: 'BR1500000000',
    status: 'approved',
    tax_id: '12.abc.345/01de-35',
  }) as Record<string, string>

  assert.equal(normalized.trade_name, 'Cantina')
  assert.equal(normalized.tax_id, '12.ABC.345/01DE-35'.replace(/[./-]/g, ''))
  assert.equal('commission_rate' in normalized, false)
  assert.equal('iban' in normalized, false)
  assert.equal('status' in normalized, false)
})

// ── Copy: what this surface may not say ──

test('#341: the form copy publishes no price, no term and no approval', () => {
  const messages = JSON.parse(readFileSync(resolve(REPO_ROOT, 'messages/pt.json'), 'utf8'))
  const copy = JSON.stringify(messages.PartnerForm).toLowerCase()

  // BR-B2B-015 item 8 / BR-B2B-016 item 6 — the capture surface publishes no price,
  // value, recurrence or what the fee buys.
  for (const forbidden of ['r$', 'mensal', 'assinatura', 'plano', 'fidelidade', 'reajuste', 'multa']) {
    assert.equal(copy.includes(forbidden), false, `the form must not say "${forbidden}"`)
  }

  // BR-B2B-011 item 5 — no public surface promises a deadline.
  for (const forbidden of ['dias úteis', 'em até', '72 h', '72h']) {
    assert.equal(copy.includes(forbidden), false, `the form must not promise "${forbidden}"`)
  }

  // BR-B2B-022 item 7 — the Tuggi does not claim to verify, audit or certify anyone's
  // legality; what exists is a condition to contract.
  for (const forbidden of ['auditamos', 'verificamos', 'certificamos', 'fiscalizamos']) {
    assert.equal(copy.includes(forbidden), false, `the form must not claim to "${forbidden}"`)
  }

  // BR-B2B-010 item 3 — the success screen approves nothing.
  assert.equal(
    JSON.stringify(messages.PartnerForm.states).toLowerCase().includes('aprovad'),
    false,
    'the success screen must not say the place was approved'
  )

  // Deliberate exception, reported in #341: "preço" appears twice, and both times it is
  // the form telling the owner NOT to write about it (§3.4 of the spec). Criterion 24
  // read as a literal grep fails the `design`'s own copy.
  assert.equal(copy.split('preço').length - 1, 2, 'only the two "what does not go here" mentions')
})

test('DS-COMPONENTE-016: every field and every document has its copy', () => {
  const messages = JSON.parse(readFileSync(resolve(REPO_ROOT, 'messages/pt.json'), 'utf8'))
  const copy = messages.PartnerForm

  for (const field of PARTNER_FORM_FIELDS) {
    assert.ok(copy.fields?.[field.id]?.label, `${field.id} has no label`)
    if (field.required) {
      assert.ok(copy.fields[field.id].requiredError, `${field.id} needs a required message naming it`)
    }
  }
  for (const kind of PARTNER_DOCUMENT_KINDS) {
    assert.ok(copy.documents?.[kind]?.label, `${kind} has no label`)
    assert.ok(copy.documents[kind].help, `${kind} has no help`)
  }
})

// ── The routes ──

interface FakeState {
  invites: Record<string, any>[]
  submissions: Record<string, any>[]
  documents: Record<string, any>[]
  /** Every table the fake was pointed at, so a write to core.clients would be visible. */
  touchedTables: string[]
}

let state: FakeState

/** The three tables specified for the `data` in #341, mapped to the fake's state keys. */
const TABLE_KEYS: Record<string, keyof FakeState> = {
  partner_form_invites: 'invites',
  partner_form_submissions: 'submissions',
  partner_form_documents: 'documents',
}

/** Minimal PostgREST stand-in: filters, then one of select/insert/update/delete. */
function createFakeService(current: () => FakeState) {
  const build = (table: string) => {
    const tableName = TABLE_KEYS[table] ?? table
    const filters: [string, unknown][] = []
    let operation: 'select' | 'insert' | 'update' | 'delete' = 'select'
    let payload: any = null

    const rows = () => {
      const table = (current() as any)[tableName] as Record<string, any>[]
      return table.filter((row) => filters.every(([column, value]) => row[column] === value))
    }

    const apply = (): Record<string, any>[] => {
      const matched = rows()
      if (operation === 'update') {
        for (const row of matched) Object.assign(row, payload)
        return matched
      }
      if (operation === 'insert') {
        const inserted = { id: `${tableName}-${Math.random().toString(36).slice(2, 8)}`, ...payload }
        ;(current() as any)[tableName].push(inserted)
        return [inserted]
      }
      if (operation === 'delete') {
        const table = (current() as any)[tableName] as Record<string, any>[]
        for (const row of matched) table.splice(table.indexOf(row), 1)
        return matched
      }
      return matched
    }

    const chain: any = {
      select: () => chain,
      order: () => chain,
      eq: (column: string, value: unknown) => {
        filters.push([column, value])
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
      delete: () => {
        operation = 'delete'
        return chain
      },
      maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
      single: async () => {
        const result = apply()
        return result[0]
          ? { data: result[0], error: null }
          : { data: null, error: { message: 'no rows' } }
      },
      then: (onFulfilled: (value: any) => unknown) =>
        Promise.resolve({ data: apply(), error: null }).then(onFulfilled),
    }
    return chain
  }

  return {
    schema: () => ({
      from: (table: string) => {
        current().touchedTables.push(table)
        return build(table)
      },
    }),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
      }),
    },
  }
}

const OPEN_TOKEN = 'a'.repeat(43)

function freshState(overrides: Partial<Record<string, any>> = {}): FakeState {
  return {
    invites: [
      {
        id: 'invite-1',
        client_id: null,
        token_hash: '',
        recipient_email: 'antonio@cantina.com.br',
        recipient_name: 'Antônio',
        trade_name: 'Cantina do Antônio',
        locale: 'pt',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        used_at: null,
        revoked_at: null,
        ...overrides,
      },
    ],
    submissions: [],
    documents: [],
    touchedTables: [],
  }
}

let GET: (req: any, ctx: any) => Promise<Response>
let POST: (req: any, ctx: any) => Promise<Response>
let hashInviteToken: (token: string) => string
let submitProposal: (
  inviteId: string,
  answers: any,
  options: { isPartial: boolean }
) => Promise<{ ok: boolean; reason?: string }>

before(async () => {
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseService: () => createFakeService(() => state),
      getSupabaseRouteHandler: () => ({}),
      getSupabaseClient: () => ({}),
    },
  })

  const proposalService = await import('@/lib/services/partner-proposal-service')
  hashInviteToken = proposalService.hashInviteToken
  submitProposal = proposalService.submitProposal as any

  const route = await import('@/app/api/partner-form/[token]/route')
  GET = route.GET as any
  POST = route.POST as any
})

function request(method: string, body?: unknown, ip = '10.0.0.1') {
  return new Request(`http://localhost/api/partner-form/${OPEN_TOKEN}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const context = { params: Promise.resolve({ token: OPEN_TOKEN }) }

test('BR-B2B-026: a reused link writes nothing — the card case', async () => {
  state = freshState()
  state.invites[0].token_hash = hashInviteToken(OPEN_TOKEN)

  const first = await POST(request('POST', { answers: completeAnswers() }, '10.0.0.2'), context)
  assert.equal(first.status, 200, 'the first submission is accepted')
  assert.equal(state.submissions.length, 1)
  assert.equal(state.submissions[0].status, 'submitted')

  const submittedAnswers = { ...state.submissions[0].answers }

  const replay = await POST(
    request('POST', { answers: { ...completeAnswers(), trade_name: 'Outro estabelecimento' } }, '10.0.0.2'),
    context
  )

  assert.equal(replay.status, 410, 'the consumed link is closed')
  assert.equal(state.submissions.length, 1, 'no second proposal was created')
  assert.deepEqual(state.submissions[0].answers, submittedAnswers, 'the stored answers did not change')
})

test('BR-B2B-026: two simultaneous submissions of the same link produce exactly one proposal', async () => {
  // The route refuses a replay because it reads the invite first, and that read is enough
  // for a person who taps twice. It is NOT enough for two requests in flight at the same
  // time: both would read an open invite. What decides is the consume-with-predicate
  // (`update ... where used_at is null`), and this is the test that proves it — dropping
  // the predicate turns this into two proposals.
  state = freshState()
  state.invites[0].token_hash = hashInviteToken(OPEN_TOKEN)

  const outcomes = await Promise.all([
    submitProposal('invite-1', completeAnswers(), { isPartial: true }),
    submitProposal('invite-1', completeAnswers(), { isPartial: true }),
  ])

  assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1, 'exactly one winner')
  assert.equal(
    outcomes.find((outcome) => !outcome.ok)?.reason,
    'already_used',
    'the loser is told the link was consumed, not that the write failed'
  )
  assert.equal(state.submissions.length, 1)
})

test('BR-B2B-026: the public route never touches core.clients', async () => {
  state = freshState()
  state.invites[0].token_hash = hashInviteToken(OPEN_TOKEN)

  await GET(request('GET', undefined, '10.0.0.3'), context)
  await POST(request('POST', { answers: completeAnswers() }, '10.0.0.3'), context)

  assert.equal(
    state.touchedTables.includes('clients'),
    false,
    'a public path must not reach the live client registration'
  )
})

test('a used link answers with the date and none of the submitted data', async () => {
  state = freshState({ used_at: new Date('2026-08-10T10:00:00Z').toISOString() })
  state.invites[0].token_hash = hashInviteToken(OPEN_TOKEN)
  state.submissions.push({
    id: 'submission-1',
    invite_id: 'invite-1',
    status: 'submitted',
    answers: completeAnswers(),
    is_partial: false,
  })

  const response = await GET(request('GET', undefined, '10.0.0.4'), context)
  const payload = await response.json()

  assert.equal(response.status, 410)
  assert.equal(payload.state, 'used')
  assert.ok(payload.usedAt, 'the date is what the person is told')
  assert.equal(JSON.stringify(payload).includes('12.ABC'), false, 'no CNPJ leaks to whoever has the URL')
  assert.equal(JSON.stringify(payload).includes('Antônio Ferreira'), false, 'no representative name leaks')
})

test('BR-B2B-022: a submission with no documents is accepted and comes back partial', async () => {
  state = freshState()
  state.invites[0].token_hash = hashInviteToken(OPEN_TOKEN)

  const response = await POST(request('POST', { answers: completeAnswers() }, '10.0.0.5'), context)
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.isPartial, true)
  assert.deepEqual(payload.missingDocuments, [...PARTNER_DOCUMENT_KINDS])
  assert.equal(state.submissions[0].is_partial, true)
})

test('an unknown token is refused without a write', async () => {
  state = freshState()
  state.invites[0].token_hash = hashInviteToken('some-other-token-entirely-different-value')

  const response = await POST(request('POST', { answers: completeAnswers() }, '10.0.0.6'), context)

  assert.equal(response.status, 404)
  assert.equal(state.submissions.length, 0)
})

test('a body with only forbidden keys is refused, and nothing is persisted', async () => {
  state = freshState()
  state.invites[0].token_hash = hashInviteToken(OPEN_TOKEN)

  const response = await POST(
    request('POST', { answers: { commission_rate: '0.9', iban: 'BR15', status: 'approved' } }, '10.0.0.7'),
    context
  )
  const payload = await response.json()

  assert.equal(response.status, 400)
  assert.equal(payload.error, 'invalid_answers')
  assert.equal(state.submissions.length, 0)
  assert.equal(state.invites[0].used_at, null, 'a refused submission does not consume the link')
})
