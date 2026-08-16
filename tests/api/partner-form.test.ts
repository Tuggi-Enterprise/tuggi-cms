/**
 * The external partner form — #341.
 *
 * The card names two obligatory cases and both are here, each written so that REMOVING THE
 * GUARD MAKES IT RED and not merely so that the happy path passes:
 *
 *  · a CNPJ already in `core.clients` is refused, and nothing is written;
 *  · the per-IP limit blocks, and the blocked request writes nothing.
 *
 * Around them, the guarantees this surface announces: BR-B2B-022 (the regularity gate belongs
 * to the contract, not to the form), BR-B2B-026 (the journey: proposal first, promotion is an
 * authenticated act), DS-COPY-015 and DS-LAYOUT-005 where they are verifiable without a
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
  PARTNER_FORM_STEP_COUNT,
  fieldsOfStep,
} from '@/lib/partner-form/fields'
import { validateAnswers, normalizeAnswers, storyNudge } from '@/lib/partner-form/schema'
import { CLIENT_ADMIN_ONLY_FIELDS } from '@/lib/services/client-editable-fields'
import {
  MIRROR_KEY,
  MIRROR_TTL_MS,
  clearMirror,
  readMirror,
  writeMirror,
} from '@/lib/partner-form/draft-mirror'
import { partnerFormPath } from '@/lib/partner-form/link'

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

test('#341: the form collects the contact of whoever fills it in', () => {
  // It used to come from the invite, which named the recipient. There is no invite: the
  // person who fills the form in is the person the contract goes to, and the confirmation
  // screen and the queue both read the address from here.
  const step2 = new Set(fieldsOfStep(2).map((field) => field.id as string))
  for (const id of ['representative_name', 'representative_email', 'representative_phone']) {
    assert.equal(step2.has(id), true, `${id} has to be asked — nothing else carries the contact`)
    assert.equal(
      PARTNER_FORM_FIELDS.find((field) => field.id === id)?.required,
      true,
      `${id} cannot be optional: it is the only way back to the establishment`
    )
  }
})

test('#341: the form asks for no document, and no step exists to upload one', () => {
  // The alvará and the contrato social are checked in person before the link is sent
  // (operator, 2026-08-16). BR-B2B-022 is unchanged — see the regularity tests — but
  // nothing on this surface asks for a file or a date off one.
  const asked = PARTNER_FORM_FIELDS.map((field) => field.id as string)
  assert.equal(asked.includes('business_license_valid_until'), false)
  assert.equal(
    asked.some((id) => /file|upload|document|alvara/i.test(id)),
    false,
    'a field that asks for a document is a step that has to receive one'
  )
  assert.equal(PARTNER_FORM_STEP_COUNT, 4, 'three subjects and the review')
  assert.equal(Math.max(...PARTNER_FORM_FIELDS.map((field) => field.step)), 3)
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

test('#341: the link is one address, with nothing secret in it', () => {
  // The same URL goes to every partner. If a segment ever comes back, the e-mail, the page
  // and the redirect all have to learn about it at once — and this is where that starts.
  assert.equal(partnerFormPath(), '/pt/parceria')
  assert.equal(partnerFormPath().split('/').filter(Boolean).length, 2)
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

test('BR-B2B-022: a complete form with no document at all is valid — the gate is on the contract', () => {
  assert.deepEqual(validateAnswers(completeAnswers()), [], 'no document is asked for here')
})

test('an invalid CNPJ produces the "does not check out" problem, not the incomplete one', () => {
  const answers = { ...completeAnswers(), tax_id: '12.ABC.345/01DE-36' }
  assert.deepEqual(validateAnswers(answers), [{ field: 'tax_id', code: 'cnpj_invalid' }])
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

test('a body that is not answers is refused, never normalised into an empty one', () => {
  assert.equal(normalizeAnswers({ trade_name: { nested: true } }), null)
  assert.equal(normalizeAnswers({ trade_name: 42 }), null)
  assert.equal(normalizeAnswers('not an object'), null)

  assert.deepEqual(normalizeAnswers({}), {})
  assert.deepEqual(normalizeAnswers(undefined), {})
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

test('DS-COMPONENTE-016: every field has its copy, and nothing promises an upload', () => {
  const messages = JSON.parse(readFileSync(resolve(REPO_ROOT, 'messages/pt.json'), 'utf8'))
  const copy = messages.PartnerForm

  for (const field of PARTNER_FORM_FIELDS) {
    assert.ok(copy.fields?.[field.id]?.label, `${field.id} has no label`)
    if (field.required) {
      assert.ok(copy.fields[field.id].requiredError, `${field.id} needs a required message naming it`)
    }
  }

  // The copy is what the person believes. A sentence about sending, attaching or
  // photographing a document survives the code that could receive it, and then the form
  // asks for something it cannot take.
  const text = JSON.stringify(copy).toLowerCase()
  for (const forbidden of ['anexar', 'anexe', 'enviar o alvará', 'escolher arquivo', 'pdf', 'jpg']) {
    assert.equal(text.includes(forbidden), false, `the form must not mention "${forbidden}"`)
  }
})

/**
 * DS-COPY-018 — copy only tells somebody to use a channel the system opens.
 *
 * THE MEASURED COST THIS EXISTS FOR: the simplified design of #341 removed the ONE e-mail the
 * Tuggi sent to the partner and left four keys telling them to answer it, on three screens,
 * with a green build and a green suite. Removing a channel has no natural `grep` — this is
 * the `grep`, and it is over the message files, not over a rendered screen.
 *
 * The one exception is declared, narrow and checked below: `PartnerProposals.outbound` is a
 * text an operator copies into THEIR OWN inbox and sends by hand. There the e-mail exists,
 * because a person sent it — and `outbound.manualNotice` is the screen saying so out loud.
 */
const CHANNEL_INSTRUCTION =
  /responda\s+(o|a|este|esta|esse|essa)?\s*(e-?mail|mensagem|whats)|use o link que (enviamos|mandamos)|(e-?mail) que (enviamos|mandamos|trouxe)/i

function collectStrings(node: unknown, path: string, into: { path: string; value: string }[]) {
  if (typeof node === 'string') {
    into.push({ path, value: node })
    return
  }
  if (!node || typeof node !== 'object') return
  for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
    collectStrings(child, path ? `${path}.${key}` : key, into)
  }
}

test('DS-COPY-018: no live message tells the partner to answer a channel nobody opens', () => {
  // The mutation: putting "responda o e-mail" back into any key outside the exception turns
  // this red. It is a static guard over the keys, in the spirit of the rule — not an
  // assertion about a rendered screen.
  const HUMAN_SENT = 'PartnerProposals.outbound.'

  for (const locale of ['pt', 'en', 'es']) {
    const messages = JSON.parse(readFileSync(resolve(REPO_ROOT, `messages/${locale}.json`), 'utf8'))
    const strings: { path: string; value: string }[] = []
    collectStrings(messages, '', strings)

    for (const entry of strings) {
      if (entry.path.startsWith(HUMAN_SENT)) continue
      assert.equal(
        CHANNEL_INSTRUCTION.test(entry.value),
        false,
        `${locale}.json · ${entry.path} points at a channel this system never opens: "${entry.value}"`
      )
    }
  }
})

test('DS-COPY-018: the one exception is a text a person sends, and the screen says so', () => {
  // If this ever stops being true, the exception above stops being justified and the four
  // outbound templates have to name a channel instead of an artefact.
  const messages = JSON.parse(readFileSync(resolve(REPO_ROOT, 'messages/pt.json'), 'utf8'))
  const notice = messages.PartnerProposals.outbound.manualNotice

  assert.ok(notice.includes('não envia'), 'the screen tells the operator it sends nothing')
  assert.ok(notice.includes('WhatsApp') || notice.includes('e-mail'))
})

test('DS-COPY-018: the form points at the person who handed the link over, never at an inbox', () => {
  const states = JSON.parse(readFileSync(resolve(REPO_ROOT, 'messages/pt.json'), 'utf8')).PartnerForm
    .states

  for (const key of ['taxIdRegisteredBody', 'submitErrorBody', 'tooManyBody']) {
    assert.ok(
      states[key].includes('pessoa da Tuggi que passou este link'),
      `states.${key} has to name the human channel BR-B2B-029 item 4 guarantees`
    )
  }
})

test('BR-B2B-030: the conference fields exist only on the internal side', () => {
  // Item 5 of the rule: nothing in the trail is claimed on a public surface. The partner is
  // never asked for a licence number, and the form has no key that mentions one.
  const messages = JSON.parse(readFileSync(resolve(REPO_ROOT, 'messages/pt.json'), 'utf8'))
  const serialized = JSON.stringify(messages.PartnerForm).toLowerCase()

  for (const forbidden of ['número do alvará', 'município que emitiu', 'alvará']) {
    assert.equal(serialized.includes(forbidden), false, `the form must not mention "${forbidden}"`)
  }

  for (const file of ['app/[locale]/parceria/page.tsx', 'components/partner-form/PartnerForm.tsx']) {
    const source = readFileSync(resolve(REPO_ROOT, file), 'utf8')
    assert.equal(source.includes('licenseNumber'), false, `${file} touches the internal trail`)
    assert.equal(source.includes('licenseIssuer'), false, `${file} touches the internal trail`)
  }
})

test('#341: the privacy notice describes what is actually collected', () => {
  // BR-USUARIO-028 item 1 ties the field to the declared category. The notice used to say
  // the Tuggi keeps the documents the person sends; nothing is sent and nothing is kept, and
  // a notice that overstates what we hold is as wrong as one that understates it.
  const messages = JSON.parse(readFileSync(resolve(REPO_ROOT, 'messages/pt.json'), 'utf8'))
  const notice = messages.PartnerForm.privacy.notice.toLowerCase()

  assert.equal(notice.includes('documento'), false, 'no document is collected here any more')
  for (const collected of ['nome', 'cargo', 'e-mail', 'telefone']) {
    assert.ok(notice.includes(collected), `the notice has to name "${collected}"`)
  }
})

// ── The route ──

interface FakeState {
  submissions: Record<string, any>[]
  clients: Record<string, any>[]
  /** Every table the fake was pointed at, so a write to core.clients would be visible. */
  touchedTables: { table: string; operation: string }[]
  /** What the rate-limit RPC was asked, and what it answered. */
  rpc: { name: string; args: Record<string, unknown> }[]
  limitAllows: boolean
  /** The RPC does not exist until the `data` applies the migration. */
  limitUnavailable: boolean
  /** Set to make the CNPJ lookup fail, which must never read as "this CNPJ is free". */
  clientsLookupFails: boolean
}

let state: FakeState

const TABLE_KEYS: Record<string, keyof FakeState> = {
  partner_form_submissions: 'submissions',
  clients: 'clients',
}

/** Minimal PostgREST stand-in: filters, then one of select/insert/update/delete. */
function createFakeService(current: () => FakeState) {
  const build = (table: string) => {
    const tableName = TABLE_KEYS[table] ?? table
    const filters: [string, unknown][] = []
    const inFilters: [string, unknown[]][] = []
    let operation: 'select' | 'insert' | 'update' | 'delete' = 'select'
    let payload: any = null
    let sort: { column: string; ascending: boolean } | null = null
    let take = Infinity

    const rows = () => {
      const all = (current() as any)[tableName] as Record<string, any>[]
      return all
        .filter((row) => filters.every(([column, value]) => row[column] === value))
        .filter((row) => inFilters.every(([column, values]) => values.indexOf(row[column]) >= 0))
    }

    const apply = (): { rows: Record<string, any>[]; error: unknown } => {
      current().touchedTables.push({ table, operation })

      if (tableName === 'clients' && operation === 'select' && current().clientsLookupFails) {
        return { rows: [], error: { code: '57014', message: 'statement timeout' } }
      }

      const matched = rows()
      if (operation === 'update') {
        for (const row of matched) Object.assign(row, payload)
        return { rows: matched, error: null }
      }
      if (operation === 'insert') {
        const inserted = {
          id: `${tableName}-${Math.random().toString(36).slice(2, 8)}`,
          created_at: new Date().toISOString(),
          ...payload,
        }
        ;(current() as any)[tableName].push(inserted)
        return { rows: [inserted], error: null }
      }
      if (operation === 'delete') {
        const all = (current() as any)[tableName] as Record<string, any>[]
        for (const row of matched) all.splice(all.indexOf(row), 1)
        return { rows: matched, error: null }
      }

      const ordered = sort
        ? [...matched].sort(
            (a, b) =>
              String(a[sort!.column] ?? '').localeCompare(String(b[sort!.column] ?? '')) *
              (sort!.ascending ? 1 : -1)
          )
        : matched
      return { rows: ordered.slice(0, take), error: null }
    }

    const chain: any = {
      select: () => chain,
      order: (column: string, options?: { ascending?: boolean }) => {
        sort = { column, ascending: options?.ascending !== false }
        return chain
      },
      limit: (count: number) => {
        take = count
        return chain
      },
      eq: (column: string, value: unknown) => {
        filters.push([column, value])
        return chain
      },
      in: (column: string, values: unknown[]) => {
        inFilters.push([column, values])
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
      maybeSingle: async () => {
        const result = apply()
        return { data: result.rows[0] ?? null, error: result.error }
      },
      single: async () => {
        const result = apply()
        if (result.error) return { data: null, error: result.error }
        return result.rows[0]
          ? { data: result.rows[0], error: null }
          : { data: null, error: { message: 'no rows' } }
      },
      then: (onFulfilled: (value: any) => unknown) => {
        const result = apply()
        return Promise.resolve({ data: result.rows, error: result.error }).then(onFulfilled)
      },
    }
    return chain
  }

  return {
    schema: () => ({
      from: (table: string) => build(table),
      /** The durable limit lives in the database; here it is a switch the test flips. */
      rpc: async (name: string, args: Record<string, unknown>) => {
        current().rpc.push({ name, args })
        if (current().limitUnavailable) {
          return { data: null, error: { code: 'PGRST202', message: 'function not found' } }
        }
        return {
          data: [
            {
              allowed: current().limitAllows,
              attempts: 1,
              retry_after_seconds: current().limitAllows ? 0 : 900,
            },
          ],
          error: null,
        }
      },
    }),
  }
}

function freshState(): FakeState {
  return {
    submissions: [],
    clients: [],
    touchedTables: [],
    rpc: [],
    limitAllows: true,
    limitUnavailable: false,
    clientsLookupFails: false,
  }
}

let POST: (req: any, ctx?: any) => Promise<Response>

before(async () => {
  mock.module('next/headers', {
    namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) },
  })

  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseService: () => createFakeService(() => state),
      getSupabaseRouteHandler: () => ({}),
      getSupabaseClient: () => ({}),
    },
  })

  const route = await import('@/app/api/partner-form/route')
  POST = route.POST as any
})

/**
 * A distinct IP per test on purpose: `withRateLimit` keeps a per-process window, and two
 * tests sharing an address make the second one fail for a reason that has nothing to do with
 * what it is asserting.
 */
function request(body?: unknown, ip = '10.0.0.1') {
  return new Request('http://localhost/api/partner-form', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const context = { params: Promise.resolve({}) }

test('#341: a CNPJ already registered as a client is refused, and nothing is written', async () => {
  // OBLIGATORY CASE 1. Written to fail if the `lookupTaxId` check is taken out of the route:
  // without it this body inserts a proposal and answers 200.
  state = freshState()
  state.clients.push({ id: 'client-1', tax_id: '12ABC34501DE35', name: 'Cantina do Antônio' })

  const response = await POST(request({ answers: completeAnswers() }, '10.0.0.2'), context)
  const payload = await response.json()

  assert.equal(response.status, 409)
  assert.equal(payload.error, 'tax_id_registered')
  assert.equal(payload.field, 'tax_id', 'the form puts the message beside the CNPJ')
  assert.equal(state.submissions.length, 0, 'a refused submission creates no proposal')
})

test('#341: the CNPJ is matched with the mask and without it', async () => {
  // Records typed by hand carry the printed mask; everything this feature writes is
  // normalised. Matching only one shape lets the same company in twice, which is exactly
  // what the refusal exists to stop.
  state = freshState()
  state.clients.push({ id: 'client-1', tax_id: '12.ABC.345/01DE-35' })

  const masked = await POST(request({ answers: completeAnswers() }, '10.0.0.3'), context)
  assert.equal(masked.status, 409, 'the stored value was masked and the answer was not')
  assert.equal(state.submissions.length, 0)
})

test('#341: a CNPJ nobody has registered is accepted and becomes a proposal', async () => {
  state = freshState()
  state.clients.push({ id: 'client-1', tax_id: '11222333000181' })

  const response = await POST(request({ answers: completeAnswers() }, '10.0.0.4'), context)
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.state, 'submitted')
  assert.equal(payload.contactEmail, 'antonio@cantina.com.br', 'the screen names where we answer')
  assert.equal(state.submissions.length, 1)
  assert.equal(state.submissions[0].status, 'submitted')
  assert.ok(state.submissions[0].submitted_at, 'a proposal is born sent — there is no draft row')
})

test('#341: a CNPJ that only has a pending proposal sends another one', async () => {
  // Deliberate, and the opposite of the case above. Refusing here would answer a question
  // anybody can ask with a public number: is this company talking to the Tuggi? The
  // duplicate is resolved by a person on the conference screen.
  state = freshState()

  const first = await POST(request({ answers: completeAnswers() }, '10.0.0.5'), context)
  const second = await POST(request({ answers: completeAnswers() }, '10.0.0.5'), context)

  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.equal(state.submissions.length, 2, 'two proposals, and nothing merged them')
})

test('#341: the per-IP limit blocks, and the blocked request writes nothing', async () => {
  // OBLIGATORY CASE 2. Written to fail if the `registerSubmissionAttempt` call is taken out
  // of the route: without it the body below is accepted and a proposal is created.
  state = freshState()
  state.limitAllows = false

  const response = await POST(request({ answers: completeAnswers() }, '10.0.0.6'), context)
  const payload = await response.json()

  assert.equal(response.status, 429)
  assert.equal(payload.error, 'too_many_submissions')
  assert.equal(response.headers.get('retry-after'), '900', 'the client is told how long to wait')
  assert.equal(state.submissions.length, 0, 'a blocked submission creates no proposal')
  assert.equal(state.rpc.length, 1, 'the verdict came from the database, not from this process')
})

test('#341: the limit is consulted before the body is even parsed', async () => {
  // Order matters: counting only the well-formed requests lets a flood of garbage through
  // for free, and garbage is what a script sends.
  state = freshState()
  state.limitAllows = false

  const response = await POST(request('not json at all', '10.0.0.7'), context)

  assert.equal(response.status, 429)
  assert.equal(state.rpc.length, 1)
})

test('#341: a limit that cannot be consulted refuses — it does not wave the request through', async () => {
  // The RPC does not exist until the `data` applies the migration, and a network can drop it
  // afterwards. An unavailable counter means nobody counted, and an uncounted write to a
  // service_role table from an anonymous caller is the thing the limit exists to prevent —
  // so it fails CLOSED. Flip that to `allowed: true` and the door opens with no barrier.
  state = freshState()
  state.limitUnavailable = true

  const response = await POST(request({ answers: completeAnswers() }, '10.0.0.8'), context)

  assert.equal(response.status, 429)
  assert.equal(state.submissions.length, 0, 'a write nobody counted must not happen')
})

test('#341: a CNPJ lookup that fails refuses the submission instead of registering a twin', async () => {
  state = freshState()
  state.clientsLookupFails = true

  const response = await POST(request({ answers: completeAnswers() }, '10.0.0.9'), context)

  assert.equal(response.status, 503)
  assert.equal(state.submissions.length, 0, 'an unanswered lookup must not become a second client')
})

test('BR-B2B-026: the public route never writes core.clients', async () => {
  // The read of `clients` is the deduplication key and returns no column; the WRITE is what
  // must not exist here. A promotion is an authenticated act of the team (item 4).
  state = freshState()

  await POST(request({ answers: completeAnswers() }, '10.0.0.10'), context)

  const clientWrites = state.touchedTables.filter(
    (touch) => touch.table === 'clients' && touch.operation !== 'select'
  )
  assert.deepEqual(clientWrites, [], 'a public path must not write the live client registration')
  assert.equal(state.clients.length, 0)
})

test('a body with only forbidden keys is refused, and nothing is persisted', async () => {
  state = freshState()

  const response = await POST(
    request({ answers: { commission_rate: '0.9', iban: 'BR15', status: 'approved' } }, '10.0.0.11'),
    context
  )
  const payload = await response.json()

  assert.equal(response.status, 400)
  assert.equal(payload.error, 'invalid_answers')
  assert.equal(state.submissions.length, 0)
})

test('a body that is not answers is refused before any write', async () => {
  state = freshState()

  const response = await POST(
    request({ answers: { trade_name: { toString: 'no' } } }, '10.0.0.12'),
    context
  )

  assert.equal(response.status, 400)
  assert.equal((await response.json()).error, 'invalid_body')
  assert.equal(state.submissions.length, 0)
})

test('#341: only the allowlisted answers reach the row', async () => {
  state = freshState()

  await POST(
    request(
      { answers: { ...completeAnswers(), commission_rate: '0.9', status: 'approved' } },
      '10.0.0.13'
    ),
    context
  )

  const stored = state.submissions[0].answers
  assert.equal('commission_rate' in stored, false)
  assert.equal('status' in stored, false)
  assert.equal(stored.trade_name, 'Cantina do Antônio')
})

// ── The copy on the device: personal data with a deadline ──

/** Enough of the Storage interface for the mirror, backed by a Map. */
function fakeStorage(): Storage & { size: () => number } {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    },
    size: () => values.size,
  } as Storage & { size: () => number }
}

test('#341: the local draft expires, and reading it after the deadline erases it', () => {
  // The scenario: a form abandoned on the tablet at the counter of a restaurant. This is now
  // the ONLY copy of what was typed — there is no server-side draft — so the deadline is the
  // only thing that takes the CNPJ and the representative's contact off a shared device.
  const store = fakeStorage()
  ;(globalThis as { localStorage?: Storage }).localStorage = store

  writeMirror({ tax_id: '12ABC34501DE35', representative_name: 'Antônio Ferreira' })
  assert.equal(readMirror().answers.tax_id, '12ABC34501DE35', 'within the window it is there')
  assert.ok(readMirror().savedAt, 'and it carries when, for the "continue where you left off"')

  const stale = JSON.parse(store.getItem(MIRROR_KEY) as string)
  stale.savedAt = Date.now() - MIRROR_TTL_MS - 1
  store.setItem(MIRROR_KEY, JSON.stringify(stale))

  assert.deepEqual(readMirror().answers, {}, 'past the deadline it must not come back')
  assert.equal(store.size(), 0, 'and it must not be left on the device either')
})

test('#341: a mirror with no deadline stamp is dropped, not trusted', () => {
  const store = fakeStorage()
  ;(globalThis as { localStorage?: Storage }).localStorage = store

  store.setItem(MIRROR_KEY, JSON.stringify({ tax_id: '12ABC34501DE35' }))
  assert.deepEqual(readMirror().answers, {})
  assert.equal(store.size(), 0)

  store.setItem(MIRROR_KEY, 'not json')
  assert.deepEqual(readMirror().answers, {})
  assert.equal(store.size(), 0)
})

test('#341: an empty draft is not something to resume', () => {
  // The banner says "a gente guardou o que você preencheu". Showing it to somebody who has
  // typed nothing offers them a `Recomeçar do zero` for a form with nothing in it.
  const store = fakeStorage()
  ;(globalThis as { localStorage?: Storage }).localStorage = store

  writeMirror({})
  assert.equal(readMirror().savedAt, null)
})

test('#341: the draft key carries no CNPJ and no token', () => {
  // Keying the mirror by CNPJ was the obvious way to resume without a link, and it is the
  // one thing this must never do: a CNPJ is public, so it would hand whoever types a number
  // the answers somebody else filled in on that device.
  assert.equal(MIRROR_KEY, 'partner-form:draft')
  assert.equal(/\$\{|cnpj|tax/i.test(MIRROR_KEY), false)
})

test('#341: the deadline is a day, and clearing it is what submission does', () => {
  assert.equal(MIRROR_TTL_MS, 24 * 60 * 60 * 1000)

  const store = fakeStorage()
  ;(globalThis as { localStorage?: Storage }).localStorage = store

  writeMirror({ tax_id: '12ABC34501DE35' })
  clearMirror()
  assert.equal(store.size(), 0)
})
