/**
 * The two internal screens of the partnership — #341, spec `spec-parceria-telas-internas-2026-08`.
 *
 * The obligatory case of the card is the one DS-COMPONENTE-018 exists for: a promotion does
 * not overwrite a divergent field without an explicit act. It is proved twice — once on the
 * pure decision and once end to end through the route — and both go red when the condition in
 * `resolvePromotionWrite` is removed, which is the mutation that was run.
 *
 * Run with: npm run test:api
 */

import { test, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  PROMOTION_MAP,
  PROMOTION_NEVER_WRITES,
  buildPromotionPlan,
  joinAddress,
  promotionAllowlistIsClosed,
  resolvePromotionWrite,
  summarizePromotion,
} from '@/lib/partner-form/promotion'
import {
  LICENSE_EXPIRY_WARNING_DAYS,
  absenceClassOf,
  buildRegularityReport,
  daysUntil,
  type ConferenceRecord,
} from '@/lib/partner-form/regularity'
import {
  DISCARD_REASONS,
  LICENSE_FIELD_MAX,
  REVIEW_MARKS,
  applySubstituteTest,
  describeConference,
  normalizeReviewNote,
  readReviewNote,
} from '@/lib/partner-form/proposal-review'
import { CLIENT_ADMIN_ONLY_FIELDS } from '@/lib/services/client-editable-fields'
import type { PartnerAnswers } from '@/lib/partner-form/schema'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

const SUBMISSION_ID = '33333333-3333-3333-3333-333333333333'
const CLIENT_ID = '44444444-4444-4444-4444-444444444444'
const OTHER_CLIENT_ID = '55555555-5555-5555-5555-555555555555'
const OPERATOR_ID = 'cms-user-1'

/** What one operator wrote down after seeing the papers. The band's only input. */
function conference(overrides: Partial<ConferenceRecord> = {}): ConferenceRecord {
  return {
    documentsSeen: [],
    licenseNumber: null,
    licenseIssuer: null,
    licenseValidUntil: null,
    ...overrides,
  }
}

function answers(overrides: PartnerAnswers = {}): PartnerAnswers {
  return {
    trade_name: 'Cantina do Zé',
    legal_name: 'Cantina do Zé Alimentos Ltda',
    tax_id: '12ABC34501DE35',
    category: 'restaurant',
    address: 'Rua das Pedras, 120',
    district: 'Centro',
    postal_code: '28950-000',
    city: 'São Vicente',
    state: 'SP',
    representative_name: 'Antônio Ferreira',
    representative_role: 'Sócio',
    representative_email: 'antonio@cantina.com.br',
    representative_phone: '+55 22 99999-0000',
    story_founder: 'Meu avô Aurélio abriu a cantina em 1962, no galpão do antigo mercado de peixe.',
    ...overrides,
  }
}

// ── DS-COMPONENTE-018 — the three rules, on the decision itself ──

test('DS-COMPONENTE-018: a divergent field is NOT written without an explicit act — the card case', () => {
  // The exact case of criterion 17: the record says Santos, the proposal says São Vicente,
  // and promoting without ticking leaves Santos alone.
  const plan = buildPromotionPlan(answers(), { id: CLIENT_ID, city: 'Santos' })
  const cityEntry = plan.entries.find((entry) => entry.column === 'city')

  assert.equal(cityEntry?.decision, 'conflict', 'a filled, different column is a conflict')
  assert.equal(cityEntry?.current, 'Santos')
  assert.equal(cityEntry?.proposed, 'São Vicente')

  const write = resolvePromotionWrite(plan, { approved: [] })
  assert.equal('city' in write.updates, false, 'nothing is written for city')
  assert.equal(write.kept.indexOf('city') >= 0, true, 'and the panel is told it was kept')
})

test('DS-COMPONENTE-018: the same field IS written once the operator ticks it', () => {
  const plan = buildPromotionPlan(answers(), { id: CLIENT_ID, city: 'Santos' })
  const write = resolvePromotionWrite(plan, { approved: ['city'] })

  assert.equal(write.updates.city, 'São Vicente')
})

test('DS-COMPONENTE-018: an empty column is filled with no act at all', () => {
  const plan = buildPromotionPlan(answers(), { id: CLIENT_ID, city: '' })
  const entry = plan.entries.find((candidate) => candidate.column === 'city')

  assert.equal(entry?.decision, 'fill')
  assert.equal(resolvePromotionWrite(plan, { approved: [] }).updates.city, 'São Vicente')
})

test('DS-COMPONENTE-018: an equal column is not a decision — it leaves the list and becomes a count', () => {
  const plan = buildPromotionPlan(answers(), { id: CLIENT_ID, city: 'São Vicente' })

  assert.equal(
    plan.entries.some((entry) => entry.column === 'city'),
    false,
    'no row for a column that already matches'
  )
  assert.equal(plan.unchanged.indexOf('city') >= 0, true)
})

test('DS-COMPONENTE-018: the column the proposal says nothing about is neither shown nor written', () => {
  const plan = buildPromotionPlan(answers({ website: '' }), { id: CLIENT_ID })
  assert.equal(plan.absent.indexOf('website') >= 0, true)
  assert.equal('website' in resolvePromotionWrite(plan, { approved: [] }).updates, false)
})

test('DS-COMPONENTE-018: money, lifecycle and the QR slug are unreachable by the promotion', () => {
  // Criterion 19, and asserted on the ROW that would be written and not on the body sent.
  assert.equal(promotionAllowlistIsClosed(), true)

  const plan = buildPromotionPlan(answers(), null)
  const write = resolvePromotionWrite(plan, {
    approved: PROMOTION_NEVER_WRITES.slice() as string[],
  })

  for (const column of PROMOTION_NEVER_WRITES) {
    assert.equal(column in write.updates, false, `${column} must never be written by a promotion`)
  }
})

test('DS-COMPONENTE-018: the confirmation counts what it will write, split by why', () => {
  const plan = buildPromotionPlan(answers(), { id: CLIENT_ID, city: 'Santos', name: '' })
  const summary = summarizePromotion(plan, { approved: ['city'] })

  assert.equal(summary.replaced, 1, 'one field the operator asked to replace')
  assert.ok(summary.filled >= 1, 'and the ones that were empty')
  assert.equal(summary.total, summary.filled + summary.replaced)
})

test('#341: the three address answers become the one address column, and the panel shows the result', () => {
  assert.equal(
    joinAddress(answers({ address_complement: 'Loja 2' })),
    'Rua das Pedras, 120, Loja 2, Centro'
  )
})

test('#341: every column the promotion writes is a column an admin is allowed to write', () => {
  // The promotion is an authenticated act (BR-B2B-026, item 4) and reaches admin-only columns
  // on purpose; what must never happen is it reaching one that is not admin-writable at all.
  const adminWritable = new Set<string>([
    'name', 'email', 'phone', 'company_name', 'address', 'city', 'state', 'country',
    'postal_code', 'industry', 'website', 'client_type', 'avatar_url', 'social_handle',
    'bio_one_line',
    ...(CLIENT_ADMIN_ONLY_FIELDS as readonly string[]),
  ])

  for (const target of PROMOTION_MAP) {
    assert.equal(adminWritable.has(target.column), true, `${target.column} is not an editable column`)
  }
})

// ── BR-B2B-022 — the gate blocks the contract, never the proposal ──

test('BR-B2B-022: a proposal with no licence is missing it for the CONTRACT and stays promotable', () => {
  const report = buildRegularityReport(
    answers(),
    conference({ documentsSeen: ['incorporation_document'] })
  )

  assert.equal(report.missing.indexOf('business_license') >= 0, true)
  assert.equal(report.ready, false)

  // And the promotion does not consult it: the plan is complete either way (criterion 9).
  const plan = buildPromotionPlan(answers(), null)
  assert.ok(plan.entries.length > 0)
})

test('BR-B2B-022: an expired licence is an absent licence, and the days are already counted', () => {
  const now = new Date('2026-08-14T15:00:00Z')
  const report = buildRegularityReport(
    answers(),
    conference({ documentsSeen: ['business_license'], licenseValidUntil: '2026-08-02' }),
    now
  )

  assert.equal(report.license.status, 'expired')
  assert.equal(report.license.daysRemaining, -12, 'the screen never asks the operator to subtract')
  assert.equal(report.missing.indexOf('business_license') >= 0, true)
})

test('BR-B2B-022: a licence expiring inside the warning window is a warning, not an absence', () => {
  const now = new Date('2026-08-14T15:00:00Z')
  const report = buildRegularityReport(
    answers(),
    conference({ documentsSeen: ['business_license'], licenseValidUntil: '2026-09-01' }),
    now
  )

  assert.equal(report.license.status, 'expiring')
  assert.ok((report.license.daysRemaining ?? 0) <= LICENSE_EXPIRY_WARNING_DAYS)
  assert.equal(report.missing.indexOf('business_license') >= 0, false, 'it still counts for the contract')
})

test('BR-B2B-022: a licence seen with no validity date cannot satisfy the gate', () => {
  const report = buildRegularityReport(answers(), conference({ documentsSeen: ['business_license'] }))
  assert.equal(report.license.status, 'undated')
  assert.equal(report.missing.indexOf('business_license') >= 0, true)
})

test('BR-B2B-022: a licence valid until today is valid today, whatever the hour', () => {
  assert.equal(daysUntil('2026-08-14', new Date('2026-08-14T23:00:00Z')), 0)
})

test('#341: an empty field carries which of the three absences it is', () => {
  assert.equal(absenceClassOf('tax_id'), 'contract')
  assert.equal(absenceClassOf('representative_name'), 'contract')
  assert.equal(absenceClassOf('representative_role'), 'contract')
  assert.equal(absenceClassOf('story_before'), 'triage')
  assert.equal(absenceClassOf('instagram'), 'optional')
  assert.equal(absenceClassOf('website'), 'optional')
})

// ── BR-B2B-011 — the reviewer's tools decide nothing ──

test('BR-B2B-011: no discard reason is a triage gate', () => {
  const ids = DISCARD_REASONS.map((reason) => reason.id)
  assert.deepEqual(ids, ['duplicate', 'gave_up', 'data_mismatch', 'will_not_regularize'])
  for (const id of ids) {
    assert.equal(/gate|portao|portão|fit|triagem/i.test(id), false, `${id} names a triage gate`)
  }
})

test('BR-B2B-011: the substitute test replaces the names and changes nothing else', () => {
  const original = 'A Cantina do Zé é o melhor lugar da cidade, e a Cantina do Zé Alimentos Ltda existe desde 1962.'
  const swapped = applySubstituteTest(original, {
    names: ['Cantina do Zé', 'Cantina do Zé Alimentos Ltda'],
    replacement: 'outro restaurante em Búzios',
  })

  assert.equal(swapped.indexOf('Cantina') < 0, true, 'no trace of the establishment name is left')
  assert.equal(swapped.indexOf('desde 1962') >= 0, true, 'and the rest of the text is untouched')
  // Longest first: the legal name must not leave a dangling "Alimentos Ltda" behind.
  assert.equal(swapped.indexOf('Alimentos') < 0, true)
})

test('BR-B2B-011: the annotation accepts only the three marks of gate 2', () => {
  assert.deepEqual(REVIEW_MARKS.slice(), ['dated', 'named_person', 'observable'])
  assert.equal(normalizeReviewNote({ marks: ['dated'], observation: 'ok' })?.marks.length, 1)
  assert.equal(normalizeReviewNote({ marks: ['approved'], observation: '' }), null)
  assert.equal(normalizeReviewNote({ marks: [], observation: 'x'.repeat(5000) }), null)
  assert.equal(normalizeReviewNote('nope'), null)
})

// ── BR-B2B-022 — the evidence is now what the team registers by hand ──

test('BR-B2B-022: the conference record accepts only the two documents of the rule', () => {
  const note = normalizeReviewNote({
    marks: [],
    observation: '',
    conference: { documentsSeen: ['business_license'], licenseValidUntil: '2027-01-31' },
  })
  assert.deepEqual(note?.conference.documentsSeen, ['business_license'])
  assert.equal(note?.conference.licenseValidUntil, '2027-01-31')

  // A third "document" would be a gate nobody wrote, applied to a contract.
  assert.equal(
    normalizeReviewNote({ marks: [], observation: '', conference: { documentsSeen: ['selfie'] } }),
    null
  )
  assert.equal(
    normalizeReviewNote({
      marks: [],
      observation: '',
      conference: { documentsSeen: [], licenseValidUntil: 'ontem' },
    }),
    null
  )
})

test('BR-B2B-022: a validity date with no licence behind it is dropped, not stored', () => {
  // Otherwise the band shows `Vence em 31/01/2027` for a document nobody says they saw, and
  // the gate reads as satisfied by a date somebody typed and then unticked.
  const note = normalizeReviewNote({
    marks: [],
    observation: '',
    conference: { documentsSeen: [], licenseValidUntil: '2027-01-31' },
  })
  assert.equal(note?.conference.licenseValidUntil, null)
})

test('BR-B2B-030: the licence number and the issuing municipality are stored as registered', () => {
  const note = normalizeReviewNote({
    marks: [],
    observation: '',
    conference: {
      documentsSeen: ['business_license'],
      licenseNumber: '  1.234/2019  ',
      licenseIssuer: "Santa Bárbara d'Oeste",
      licenseValidUntil: '2027-01-31',
    },
  })

  assert.equal(note?.conference.licenseNumber, '1.234/2019', 'trimmed, never reformatted')
  assert.equal(note?.conference.licenseIssuer, "Santa Bárbara d'Oeste")
})

test('BR-B2B-030: number and municipality fall with the tick, like the date already did', () => {
  // One rule for the three fields of one document. Kept, the band would publish
  // `Alvará 1.234/2019 · Búzios` for a licence nobody says they saw.
  const note = normalizeReviewNote({
    marks: [],
    observation: '',
    conference: {
      documentsSeen: [],
      licenseNumber: '1.234/2019',
      licenseIssuer: 'Armação dos Búzios',
      licenseValidUntil: '2027-01-31',
    },
  })

  assert.equal(note?.conference.licenseNumber, null)
  assert.equal(note?.conference.licenseIssuer, null)
  assert.equal(note?.conference.licenseValidUntil, null)
})

test('BR-B2B-030: a licence field that is not a short string is refused, not truncated', () => {
  const withValue = (value: unknown) =>
    normalizeReviewNote({
      marks: [],
      observation: '',
      conference: { documentsSeen: ['business_license'], licenseNumber: value },
    })

  assert.equal(withValue(42), null)
  assert.equal(withValue({ nested: true }), null)
  assert.equal(withValue('x'.repeat(LICENSE_FIELD_MAX + 1)), null)
  assert.equal(withValue('x'.repeat(LICENSE_FIELD_MAX))?.conference.licenseNumber?.length, LICENSE_FIELD_MAX)
})

test('BR-B2B-030: the two new fields are NOT in the contract gate — only the validity is', () => {
  // The operator's decision of 2026-08-16, and the 1st edge case of BR-B2B-030: an absent
  // date is an absence, a blank number is an incomplete trail. Putting them in the gate would
  // refuse a contract to a conference that is correct.
  const registered = conference({
    documentsSeen: ['business_license', 'incorporation_document'],
    licenseValidUntil: '2027-01-31',
  })

  const report = buildRegularityReport(answers(), registered, new Date('2026-08-16T12:00:00Z'))
  assert.equal(report.ready, true, 'no number and no municipality, and the contract is not blocked')
  assert.equal(report.license.identityComplete, false, 'and the band still says the trail is short')

  const complete = buildRegularityReport(
    answers(),
    { ...registered, licenseNumber: '1.234/2019', licenseIssuer: 'Armação dos Búzios' },
    new Date('2026-08-16T12:00:00Z')
  )
  assert.equal(complete.license.identityComplete, true)
  assert.equal(complete.license.number, '1.234/2019')
})

test('BR-B2B-030: the audit description is codes and dates — never what the operator typed', () => {
  const note = normalizeReviewNote({
    marks: ['dated', 'named_person'],
    observation: 'O sócio Antônio trouxe o alvará em mãos.',
    conference: {
      documentsSeen: ['business_license'],
      licenseNumber: '1.234/2019',
      licenseIssuer: 'Armação dos Búzios',
      licenseValidUntil: '2027-03-31',
    },
  })

  const described = describeConference(note!)
  assert.equal(described.includes('Antônio'), false, 'no free text')
  assert.equal(described.includes('1.234/2019'), false, 'and no transcription of the document')
  assert.equal(described.includes('Búzios'), false)
  assert.equal(
    described,
    'documents=business_license; license_valid_until=2027-03-31; license_identity=number+issuer; marks=dated+named_person'
  )
})

test('BR-B2B-030: half a trail is not a trail — one field alone does not complete it', () => {
  const report = buildRegularityReport(
    answers(),
    conference({
      documentsSeen: ['business_license'],
      licenseNumber: '1.234/2019',
      licenseValidUntil: '2027-01-31',
    }),
    new Date('2026-08-16T12:00:00Z')
  )
  assert.equal(report.license.identityComplete, false)
})

test('BR-B2B-022: an annotation written before the conference existed reads as "nothing seen"', () => {
  // The column is free-form JSON and rows written by the previous shape are still there. The
  // wrong answer is not a crash, it is a report that quietly claims the papers are in order.
  const note = readReviewNote({ marks: ['dated'], observation: 'O avô abriu em 1962.' })
  assert.deepEqual(note.conference.documentsSeen, [])
  assert.equal(buildRegularityReport(answers(), note.conference).ready, false)
})

// ── The routes ──

interface FakeState {
  submissions: Record<string, any>[]
  clients: Record<string, any>[]
  audit_logs: Record<string, any>[]
  touchedTables: string[]
  /** Set to make the write against `core.clients` fail, for the rollback case. */
  clientWriteFails: boolean
}

let state: FakeState

const TABLE_KEYS: Record<string, keyof FakeState> = {
  partner_form_submissions: 'submissions',
  clients: 'clients',
  audit_logs: 'audit_logs',
}

/** Minimal PostgREST stand-in: filters (`eq`, `is`, `in`), then one operation. */
function createFakeService(current: () => FakeState) {
  const build = (table: string) => {
    const key = TABLE_KEYS[table] ?? table
    const filters: ((row: Record<string, any>) => boolean)[] = []
    let operation: 'select' | 'insert' | 'update' | 'delete' = 'select'
    let payload: any = null
    let sort: { column: string; ascending: boolean } | null = null
    let take = Infinity

    const rows = () => {
      const all = ((current() as any)[key] ?? []) as Record<string, any>[]
      return all.filter((row) => filters.every((predicate) => predicate(row)))
    }

    const apply = (): { data: Record<string, any>[]; error: any } => {
      if (key === 'clients' && current().clientWriteFails && operation !== 'select') {
        return { data: [], error: { code: '08006', message: 'connection lost' } }
      }

      const matched = rows()
      if (operation === 'update') {
        for (const row of matched) Object.assign(row, payload)
        return { data: matched, error: null }
      }
      if (operation === 'insert') {
        const inserted = {
          id: `${key}-${Math.random().toString(36).slice(2, 10)}`,
          created_at: new Date().toISOString(),
          ...payload,
        }
        ;(current() as any)[key].push(inserted)
        return { data: [inserted], error: null }
      }
      if (operation === 'delete') {
        const all = (current() as any)[key] as Record<string, any>[]
        for (const row of matched) all.splice(all.indexOf(row), 1)
        return { data: matched, error: null }
      }

      const ordered = sort
        ? [...matched].sort(
            (a, b) =>
              String(a[sort!.column] ?? '').localeCompare(String(b[sort!.column] ?? '')) *
              (sort!.ascending ? 1 : -1)
          )
        : matched
      return { data: ordered.slice(0, take), error: null }
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
        filters.push((row) => row[column] === value)
        return chain
      },
      is: (column: string, value: unknown) => {
        filters.push((row) => (row[column] ?? null) === value)
        return chain
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.indexOf(row[column]) >= 0)
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
        return { data: result.data[0] ?? null, error: result.error }
      },
      single: async () => {
        const result = apply()
        if (result.error) return { data: null, error: result.error }
        return result.data[0]
          ? { data: result.data[0], error: null }
          : { data: null, error: { message: 'no rows' } }
      },
      then: (onFulfilled: (value: any) => unknown) => Promise.resolve(apply()).then(onFulfilled),
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
        createSignedUrl: async (path: string, seconds: number) => ({
          data: { signedUrl: `https://storage.test/${path}?expires=${seconds}` },
          error: null,
        }),
      }),
    },
    functions: { invoke: async () => ({ data: { ok: true }, error: null }) },
  }
}

function createFakeAuthClient() {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({
      data: { email: 'admin@tuggi.app', role: 'admin', is_active: true },
      error: null,
    }),
  }
  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: OPERATOR_ID, email: 'admin@tuggi.app' } },
        error: null,
      }),
    },
    schema: () => ({ from: () => chain }),
  }
}

/**
 * `core.partner_form_submissions.tax_id_normalized` as the database computes it — GENERATED
 * ALWAYS in `20260814140000`: strip everything outside `[0-9A-Za-z]`, and ONLY THEN upper-case.
 *
 * Written out here on purpose instead of importing `normalizedTaxId`: the production function
 * is a MIRROR of this expression, and a mirror compared against itself proves nothing. With the
 * contract on this side, a mutation on the other one stops matching rows and the suite is red.
 */
function generatedTaxIdNormalized(answers: Record<string, any> | undefined): string {
  return String(answers?.tax_id ?? '')
    .replace(/[^0-9A-Za-z]/g, '')
    .toUpperCase()
}

/** One row of the queue, with the generated column filled the way an INSERT would leave it. */
function submissionRow(overrides: Record<string, any> = {}): Record<string, any> {
  const row = {
    id: SUBMISSION_ID,
    status: 'submitted',
    answers: answers(),
    submitted_at: '2026-08-12T12:00:00Z',
    created_at: '2026-08-10T09:00:00Z',
    updated_at: '2026-08-12T12:00:00Z',
    promoted_at: null,
    promoted_by: null,
    promoted_client_id: null,
    review_note: null,
    reviewed_at: null,
    reviewed_by: null,
    ...overrides,
  }
  return { ...row, tax_id_normalized: generatedTaxIdNormalized(row.answers) }
}

function freshState(
  overrides: { submission?: Record<string, any>; client?: Record<string, any> } = {}
): FakeState {
  return {
    submissions: [submissionRow(overrides.submission)],
    clients: overrides.client ? [overrides.client] : [],
    audit_logs: [],
    touchedTables: [],
    clientWriteFails: false,
  }
}

let GET_PROPOSAL: (req: any, ctx: any) => Promise<Response>
let PROMOTE: (req: any, ctx: any) => Promise<Response>
let DISCARD: (req: any, ctx: any) => Promise<Response>
let SAVE_NOTE: (req: any, ctx: any) => Promise<Response>

before(async () => {
  process.env.NEXT_PUBLIC_APP_URL ??= 'https://cms.tuggi.app'

  mock.module('next/headers', {
    namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) },
  })

  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseService: () => createFakeService(() => state),
      getSupabase: () => createFakeService(() => state),
      getSupabaseRouteHandler: () => createFakeAuthClient(),
      getSupabaseClient: () => ({}),
    },
  })

  const proposal = await import('@/app/api/admin/partner-proposals/[submissionId]/route')
  GET_PROPOSAL = proposal.GET as any

  const promote = await import('@/app/api/admin/partner-proposals/[submissionId]/promote/route')
  PROMOTE = promote.POST as any

  const discard = await import('@/app/api/admin/partner-proposals/[submissionId]/discard/route')
  DISCARD = discard.POST as any

  const note = await import('@/app/api/admin/partner-proposals/[submissionId]/review-note/route')
  SAVE_NOTE = note.PUT as any
})

/**
 * A fresh caller each time. `withRateLimit` keys by IP and these routes allow 20 acts a
 * minute; reusing one address would make a test fail because of the test before it.
 */
let callerSequence = 0

function request(
  method: string,
  body?: unknown,
  ip = `10.0.1.${(callerSequence += 1) % 250}`,
  url = 'http://localhost/api/admin/x'
) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const proposalContext = { params: Promise.resolve({ submissionId: SUBMISSION_ID }) }

test('DS-COMPONENTE-018: promoting without ticking leaves the divergent column alone — end to end', async () => {
  // The mutation this test exists for: removing the `approved` condition from
  // `resolvePromotionWrite` makes `city` become "São Vicente" here and turns this red.
  state = freshState({
    client: {
      id: CLIENT_ID,
      name: 'Cantina do Zé',
      email: 'antonio@cantina.com.br',
      tax_id: '12ABC34501DE35',
      city: 'Santos',
    },
  })

  const response = await PROMOTE(request('POST', { approved: [], industry: 'Restaurante' }), proposalContext)
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(state.clients[0].city, 'Santos', 'the record the team wrote was not overwritten')
  assert.equal(payload.kept.indexOf('city') >= 0, true)
  assert.equal(state.submissions[0].status, 'promoted')
  assert.equal(state.submissions[0].promoted_client_id, CLIENT_ID)
})

test('DS-COMPONENTE-018: ticking the column is what writes it — end to end', async () => {
  state = freshState({
    client: {
      id: CLIENT_ID,
      name: 'Cantina do Zé',
      email: 'antonio@cantina.com.br',
      tax_id: '12ABC34501DE35',
      city: 'Santos',
    },
  })

  const response = await PROMOTE(
    request('POST', { approved: ['city'], industry: 'Restaurante' }),
    proposalContext
  )

  assert.equal(response.status, 200)
  assert.equal(state.clients[0].city, 'São Vicente')
})

test('DS-COMPONENTE-018: the body cannot name a column the plan did not produce', async () => {
  state = freshState({
    client: {
      id: CLIENT_ID,
      name: 'Cantina do Zé',
      email: 'antonio@cantina.com.br',
      tax_id: '12ABC34501DE35',
    },
  })

  await PROMOTE(
    request('POST', {
      approved: ['commission_rate', 'status', 'slug', 'iban'],
      industry: 'Restaurante',
      commission_rate: 99,
      slug: 'roubado',
    }),
    proposalContext
  )

  for (const column of PROMOTION_NEVER_WRITES) {
    assert.equal(column in state.clients[0], false, `${column} reached the row`)
  }
})

test('#341: a promotion that fails to write the client hands the proposal back — nothing was written', async () => {
  state = freshState({
    client: {
      id: CLIENT_ID,
      name: 'Cantina do Zé',
      email: 'antonio@cantina.com.br',
      tax_id: '12ABC34501DE35',
    },
  })
  state.clientWriteFails = true

  const response = await PROMOTE(request('POST', { approved: [], industry: 'Restaurante' }), proposalContext)

  assert.equal(response.status, 503)
  assert.equal(state.submissions[0].status, 'submitted', 'the proposal is back in the queue')
  assert.equal(state.submissions[0].promoted_at, null)
  assert.equal(state.clients[0].city, undefined, 'and the client record is untouched')
})

test('BR-B2B-026: a proposal somebody already promoted cannot be promoted again', async () => {
  // There is no `draft` row to test any more — the CHECK of `20260814140000` accepts
  // `submitted`, `promoted` and `discarded`, and the copy and the branch that described a
  // draft went with it. What remains is the claim: `status = 'submitted'` is a predicate of
  // the UPDATE, so a second click matches no row.
  state = freshState({ submission: { status: 'promoted' } })

  const response = await PROMOTE(request('POST', { approved: [], industry: 'Restaurante' }), proposalContext)
  const payload = await response.json()

  assert.equal(response.status, 409)
  assert.equal(payload.error, 'not_promotable')
  assert.equal(state.clients.length, 0)
})

test('BR-B2B-020: a promotion that creates a record creates a `venue` — end to end', async () => {
  // Item 5, declared by the operator on 2026-08-14 (*"será tipo locais"*): the establishment
  // is a type of its own. This used to write `partner`, a generic that names no public — and
  // the public form is the merchant's channel (BR-B2B-026, items 1 to 3), so every record it
  // creates is one. The mutation: put `'partner'` back in `writeClient` and this is red.
  state = freshState()

  const response = await PROMOTE(request('POST', { approved: [], industry: 'Restaurante' }), proposalContext)

  assert.equal(response.status, 200)
  assert.equal(state.clients.length, 1)
  assert.equal(state.clients[0].client_type, 'venue')
})

test('BR-B2B-020: a promotion onto a record that already exists does not re-classify it', async () => {
  // The type of a client the team registered is the team's. `client_type` is not in
  // `PROMOTION_MAP`, so an UPDATE cannot reach it however the body is written — the same
  // reasoning as DS-COMPONENTE-018, applied to a column the panel never shows.
  state = freshState({
    client: {
      id: CLIENT_ID,
      name: 'Cantina do Zé',
      tax_id: '12ABC34501DE35',
      client_type: 'business',
    },
  })

  await PROMOTE(
    request('POST', { approved: ['name'], industry: 'Restaurante', client_type: 'venue' }),
    proposalContext
  )

  assert.equal(state.clients[0].client_type, 'business')
})

test('#341: a proposal whose CNPJ is already a client promotes into that record, not a second one', async () => {
  // The form refuses a CNPJ that is already a client, so the ordinary promotion CREATES. This
  // is the case that survives it: the proposal was sitting in the queue while somebody
  // registered the company by hand. Without the lookup the promotion writes a twin, which is
  // exactly what the CNPJ is the key against — and DS-COMPONENTE-018 would never apply,
  // because there would never be a record to diverge from.
  state = freshState({
    client: { id: CLIENT_ID, name: 'Cantina do Zé', tax_id: '12ABC34501DE35', city: 'Santos' },
  })

  const detail = await (await GET_PROPOSAL(request('GET'), proposalContext)).json()
  assert.equal(detail.client?.id, CLIENT_ID, 'the panel compares against the record that exists')

  const response = await PROMOTE(
    request('POST', { approved: [], industry: 'Restaurante' }),
    proposalContext
  )

  assert.equal(response.status, 200)
  assert.equal(state.clients.length, 1, 'no second record for the same company')
  assert.equal(state.clients[0].city, 'Santos', 'and the divergent column was not overwritten')
})

test('#341: the same CNPJ counts as the same company with the mask and without it', async () => {
  state = freshState({
    client: { id: CLIENT_ID, name: 'Cantina do Zé', tax_id: '12.ABC.345/01DE-35' },
  })

  const detail = await (await GET_PROPOSAL(request('GET'), proposalContext)).json()
  assert.equal(detail.client?.id, CLIENT_ID, 'the stored value was masked and the answer was not')
})

test('#341: two proposals with the same CNPJ are shown to a person, never merged', async () => {
  state = freshState()
  state.submissions.push({
    ...state.submissions[0],
    id: '99999999-9999-9999-9999-999999999999',
    submitted_at: '2026-08-13T12:00:00Z',
  })

  const detail = await (await GET_PROPOSAL(request('GET'), proposalContext)).json()

  assert.equal(detail.duplicates.length, 1)
  assert.equal(detail.duplicates[0].id, '99999999-9999-9999-9999-999999999999')
  assert.equal(state.submissions.length, 2, 'nothing was merged and nothing was discarded')
})

test('#341: the duplicate is the same company in another shape — and never a different company', async () => {
  // The whole reason `tax_id_normalized` exists, in one screen. The twin typed the CNPJ with
  // no mask and in lower case; the stranger is `12.AAD.345/01CN-35`, a DIFFERENT valid company
  // whose digits and check digits are identical to ours. Both mutations of the key are red
  // here: matching the typed string loses the twin, and keying on `[^0-9]` gains the stranger
  // — and gaining it means an operator is shown somebody else's proposal as a duplicate of
  // this one, with `duplicate` on the closed list of discard reasons.
  state = freshState()
  const twin = submissionRow({
    id: '99999999-9999-9999-9999-999999999999',
    answers: { ...answers(), tax_id: '12abc34501de35' },
    submitted_at: '2026-08-13T12:00:00Z',
  })
  const stranger = submissionRow({
    id: '88888888-8888-8888-8888-888888888888',
    answers: { ...answers(), tax_id: '12.AAD.345/01CN-35' },
    submitted_at: '2026-08-13T13:00:00Z',
  })
  state.submissions.push(twin, stranger)

  const detail = await (await GET_PROPOSAL(request('GET'), proposalContext)).json()

  assert.deepEqual(
    detail.duplicates.map((duplicate: { id: string }) => duplicate.id),
    [twin.id]
  )
})

test('BR-B2B-022: the conference the operator registers is what the screen reads back', async () => {
  state = freshState()

  const saved = await SAVE_NOTE(
    request('PUT', {
      marks: ['dated'],
      observation: 'Alvará conferido no balcão.',
      conference: { documentsSeen: ['business_license'], licenseValidUntil: '2027-03-31' },
    }),
    proposalContext
  )
  assert.equal(saved.status, 200)

  const detail = await (await GET_PROPOSAL(request('GET'), proposalContext)).json()
  assert.deepEqual(detail.conference.documentsSeen, ['business_license'])
  assert.equal(detail.conference.licenseValidUntil, '2027-03-31')
  assert.equal(detail.submission.status, 'submitted', 'registering a document decides nothing')
  assert.equal(state.clients.length, 0, 'and reaches no client record')
})

test('BR-B2B-011: the annotation changes no status and reaches no client record', async () => {
  state = freshState()

  const response = await SAVE_NOTE(
    request('PUT', { marks: ['dated'], observation: 'O avô abriu em 1962.' }),
    proposalContext
  )

  assert.equal(response.status, 200)
  assert.equal(state.submissions[0].status, 'submitted', 'still exactly as promotable as before')
  assert.deepEqual(state.submissions[0].review_note, {
    marks: ['dated'],
    observation: 'O avô abriu em 1962.',
    conference: {
      documentsSeen: [],
      licenseNumber: null,
      licenseIssuer: null,
      licenseValidUntil: null,
    },
  })
  assert.equal(state.touchedTables.indexOf('clients') < 0, true)
})

test('BR-B2B-011: discarding files the proposal away and does not touch the establishment', async () => {
  state = freshState()

  const response = await DISCARD(request('POST', { reason: 'duplicate' }), proposalContext)

  assert.equal(response.status, 200)
  assert.equal(state.submissions[0].status, 'discarded')
  assert.equal(state.submissions[0].discard_reason, 'duplicate')
  assert.equal(state.touchedTables.indexOf('clients') < 0, true)
})

test('BR-B2B-011: a discard reason outside the closed list is refused', async () => {
  state = freshState()

  const response = await DISCARD(request('POST', { reason: 'no_fit' }), proposalContext)

  assert.equal(response.status, 400)
  assert.equal(state.submissions[0].status, 'submitted')
})

test('BR-B2B-030: the annotation that opens the contract door says who wrote it', async () => {
  // The mutation this test exists for: removing `logAuditEvent` from
  // `app/api/admin/partner-proposals/[submissionId]/review-note/route.ts` turns it red.
  //
  // Why it is not covered by `reviewed_by` on the row: `review_note` is an UPDATE that
  // OVERWRITES. A second operator rewrites the conference, `reviewed_by` moves to them, and
  // the earlier assertion of regularity disappears with no trace. This row is where it
  // survives (security review, 2026-08-16, M-2).
  state = freshState()

  const response = await SAVE_NOTE(
    request('PUT', {
      marks: ['dated'],
      observation: 'Alvará conferido no balcão, com o sócio presente.',
      conference: {
        documentsSeen: ['business_license'],
        licenseNumber: '1.234/2019',
        licenseIssuer: 'Armação dos Búzios',
        licenseValidUntil: '2027-03-31',
      },
    }),
    proposalContext
  )
  assert.equal(response.status, 200)

  const row = state.audit_logs.find((entry) => entry.action === 'REVIEW_PARTNER_PROPOSAL')
  assert.ok(row, 'the write that decides whether a contract can be produced is audited')
  assert.equal(row?.entity, 'PARTNER_PROPOSAL')
  assert.equal(row?.entity_id, SUBMISSION_ID)
  assert.equal(row?.user_id, OPERATOR_ID, 'the trail names who asserted it')
  assert.equal(row?.user_email, 'admin@tuggi.app')

  // Codes, never the annotation: the observation is free text about somebody's business.
  assert.equal(row?.description.includes('balcão'), false, 'no free text in the trail')
  assert.ok(row?.description.includes('documents=business_license'))
  assert.ok(row?.description.includes('license_identity=number+issuer'))
  assert.ok(row?.description.includes('license_valid_until=2027-03-31'))
})

test('BR-B2B-030: an annotation that could not be saved leaves no trail claiming it was', async () => {
  state = freshState()
  state.submissions = []

  const response = await SAVE_NOTE(request('PUT', { marks: [], observation: '' }), proposalContext)

  assert.equal(response.status, 503)
  assert.equal(
    state.audit_logs.some((entry) => entry.action === 'REVIEW_PARTNER_PROPOSAL'),
    false
  )
})

test('BR-B2B-030: the conference survives the save and comes back whole', async () => {
  state = freshState()

  await SAVE_NOTE(
    request('PUT', {
      marks: [],
      observation: '',
      conference: {
        documentsSeen: ['business_license'],
        licenseNumber: '1.234/2019',
        licenseIssuer: "Santa Bárbara d'Oeste",
        licenseValidUntil: '2027-03-31',
      },
    }),
    proposalContext
  )

  const detail = await (await GET_PROPOSAL(request('GET'), proposalContext)).json()
  assert.equal(detail.conference.licenseNumber, '1.234/2019')
  assert.equal(detail.conference.licenseIssuer, "Santa Bárbara d'Oeste")
  assert.ok(detail.submission.reviewedAt, 'and the screen can say when it was registered')
})

test('#341: promoting and discarding each leave a row in the trail', async () => {
  state = freshState({
    client: {
      id: CLIENT_ID,
      name: 'Cantina do Zé',
      email: 'antonio@cantina.com.br',
      tax_id: '12ABC34501DE35',
    },
  })
  await PROMOTE(request('POST', { approved: [], industry: 'Restaurante' }), proposalContext)

  const promotion = state.audit_logs.find((row) => row.action === 'PROMOTE_PARTNER_PROPOSAL')
  assert.ok(promotion, 'the promotion is audited')
  assert.equal(promotion?.entity, 'CLIENT')
  assert.equal(promotion?.entity_id, CLIENT_ID)
  assert.equal(promotion?.user_id, OPERATOR_ID)

  state = freshState()
  await DISCARD(request('POST', { reason: 'gave_up' }), proposalContext)
  assert.ok(state.audit_logs.find((row) => row.action === 'DISCARD_PARTNER_PROPOSAL'))
})

// ── The copy ──

const copy = JSON.parse(readFileSync(resolve(REPO_ROOT, 'messages/pt.json'), 'utf8')).PartnerProposals

test('DS-COPY-014: no confirmation button is called `Confirmar` — the control names the effect', () => {
  const serialized = JSON.stringify(copy)
  assert.equal(/"Confirmar"/.test(serialized), false)
  assert.ok(copy.promotion.commit.indexOf('{count') >= 0, 'the button carries the count')
  assert.ok(copy.promotion.commit.indexOf('{name}') >= 0, 'and the target')
})

test('DS-COPY-017: nothing the Tuggi writes to the partner names a deadline, an approval or an audit', () => {
  const outbound = JSON.stringify(copy.outbound)
  for (const forbidden of [
    'em até',
    'dias úteis',
    'prazo',
    'aprovad',
    'verificamos',
    'auditamos',
    'certifica',
    'fiscaliza',
    'R$',
    'mensal',
    'assinatura',
  ]) {
    assert.equal(
      outbound.toLowerCase().indexOf(forbidden.toLowerCase()) < 0,
      true,
      `"${forbidden}" must not appear in what we write to the partner`
    )
  }
})

test('DS-COPY-017: gate 3 has no ready-made message, and the screen says why', () => {
  assert.equal('gate3' in copy.outbound, false, 'there is no gate-3 template to send')
  assert.ok(copy.outbound.gate3NoTemplate)
  assert.ok(copy.outbound.gate3Body.indexOf('BR-B2B-011') >= 0)
})

test('DS-COPY-017: every refusal says coming back is possible', () => {
  assert.ok(copy.outbound.regularity.body.indexOf('não é definitivo') >= 0)
  assert.ok(copy.outbound.gate1.body.indexOf('olhamos de novo') >= 0)
  assert.ok(copy.outbound.gate2.body.indexOf('mandar de novo') >= 0)
})

test('BR-B2B-011: the discard block says out loud that it is not a triage rejection', () => {
  assert.ok(copy.discard.notTriage.indexOf('não reprova') >= 0)
  assert.ok(copy.discard.notTriage.indexOf('BR-B2B-011') >= 0)
  assert.ok(copy.story.footer.indexOf('continua parceiro') >= 0)
})

test('#341: the copy of the queue mentions no invite, no link and no upload', () => {
  // The three things that left with the invite. Copy outlives the code that made it true, and
  // an operator reading "reenviar o link" for a feature that has none loses the screen.
  const text = JSON.stringify(copy).toLowerCase()
  for (const forbidden of ['convite', 'reenviar', 'revogar', 'anexar', 'baixar o arquivo']) {
    assert.equal(text.includes(forbidden), false, `the screen must not say "${forbidden}"`)
  }
})

test('BR-B2B-022: the conference block says whose word it is, and claims no verification', () => {
  // Item 7 of the rule: the Tuggi does not verify, audit or certify anybody's legality. A tick
  // by an operator is that operator's assertion, and the screen has to say so — otherwise the
  // band reads as a document check the Tuggi performed.
  assert.ok(copy.conference.intro.length > 40, 'the block explains what is being registered')
  // Whose word it is now lives in the two places that carry it: the first-person tick the
  // operator reads while registering, and the band line that names them afterwards. `source`
  // was split in two (spec `design` §2.4) and keeps only the limit.
  assert.match(copy.conference.seen.business_license, /^Vi /)
  assert.match(copy.regularity.incorporationOk, /pessoalmente/)
  assert.ok(copy.regularity.checkedBy.includes('{person}'))
  assert.match(copy.regularity.source, /não atesta a autenticidade/)
  for (const forbidden of ['auditamos', 'verificamos', 'certificamos', 'validamos']) {
    assert.equal(
      JSON.stringify(copy).toLowerCase().includes(forbidden),
      false,
      `the screen must not claim to "${forbidden}"`
    )
  }
})

test('BR-B2B-022: the band claims no attachment — there is no file anywhere in this product', () => {
  // The screen whose whole job is to stop a tick being read as a guarantee was publishing
  // `Anexado ·` for a document that exists on nobody's disk. The existing guard missed it
  // because it forbade `anexar` and the copy said `Anexado`.
  const serialized = JSON.stringify(copy).toLowerCase()
  for (const forbidden of ['anexad', 'arquivo enviado', 'baixar']) {
    assert.equal(serialized.includes(forbidden), false, `the band must not say "${forbidden}"`)
  }
  assert.equal(copy.regularity.licenseOk.indexOf('Vigente até'), 0)
})

test('BR-B2B-030: the band says who registered the conference, before saying what it is not', () => {
  // Item 2 of the rule asks the trail to name the person and the date. `source` then carries
  // the limit of BR-B2B-022 item 7 — and carries its own scope, because the old text opened
  // with `Estas duas linhas` while the band has four.
  assert.ok(copy.regularity.checkedBy.includes('{person}'))
  assert.ok(copy.regularity.checkedBy.includes('{date}'))
  assert.equal(copy.regularity.source.includes('duas linhas'), false)
  assert.ok(copy.regularity.source.includes('alvará'), 'the limit names what it is about')
  assert.ok(copy.regularity.licenseIdentity.includes('{number}'))
  assert.ok(copy.regularity.licenseIdentity.includes('{issuer}'))
  assert.ok(copy.regularity.licenseIdentityMissing.length > 0)
})

test('BR-B2B-030: the conference block names the three licence fields and the reason each is off', () => {
  for (const key of [
    'licenseNumberLabel',
    'licenseNumberHint',
    'licenseNumberDisabled',
    'licenseIssuerLabel',
    'licenseIssuerHint',
    'licenseIssuerDisabled',
  ]) {
    assert.ok(copy.conference[key], `conference.${key} is missing`)
  }
  // DS-A11Y-003: the reason beside the disabled control, never the grey alone.
  assert.ok(copy.conference.licenseNumberDisabled.includes('Marque o alvará'))
  assert.ok(copy.conference.licenseIssuerDisabled.includes('Marque o alvará'))
})

test('#341: the screen describes no `draft` proposal — the CHECK does not accept one', () => {
  // Three keys and a whole branch described a state `20260814140000` refuses. An orphan i18n
  // key lies about what the product does, and it lies with a green build.
  for (const dead of ['draftTitle', 'draftBody', 'draftActionReason']) {
    assert.equal(dead in copy.review, false, `review.${dead} describes a state that cannot exist`)
  }
  const source = readFileSync(
    resolve(REPO_ROOT, 'components/admin/partner-proposals/ProposalReview.tsx'),
    'utf8'
  )
  assert.equal(source.includes("'draft'"), false, 'and no branch is left reading for it')
})

test('#341: the promotion panel lists what it never writes, and the list is the code one', () => {
  for (const column of PROMOTION_NEVER_WRITES) {
    assert.ok(
      copy.promotion.neverFields.indexOf(column) >= 0,
      `${column} is missing from what the panel promises never to write`
    )
  }
})

test('#341: the screens read the field labels from PartnerForm and do not redeclare them', () => {
  // A reviewer reading a different question from the one the partner answered is exactly the
  // defect duplicating the labels produces, so the labels must NOT exist under this namespace.
  const serialized = JSON.stringify(copy)
  const form = JSON.parse(readFileSync(resolve(REPO_ROOT, 'messages/pt.json'), 'utf8')).PartnerForm
  for (const id of ['trade_name', 'representative_name', 'story_founder']) {
    assert.equal(
      serialized.indexOf(form.fields[id].label) < 0,
      true,
      `${id} label is duplicated into PartnerProposals`
    )
  }
})

test('#341: the two pages hand the Portuguese messages to their children', () => {
  // Criterion 28. The copy lives only in `pt.json` by decision, and an absent key in next-intl
  // renders THE KEY NAME — so `/en/` and `/es/` are only safe because the pages supply them.
  for (const page of [
    'app/[locale]/admin/partner-proposals/page.tsx',
    'app/[locale]/admin/partner-proposals/[submissionId]/page.tsx',
  ]) {
    const source = readFileSync(resolve(REPO_ROOT, page), 'utf8')
    assert.ok(source.indexOf('NextIntlClientProvider') >= 0, `${page} does not provide messages`)
    assert.ok(source.indexOf("ptMessages.PartnerProposals") >= 0, `${page} does not provide the namespace`)
    assert.ok(source.indexOf("ptMessages.PartnerForm") >= 0, `${page} does not provide the labels`)
  }
})
