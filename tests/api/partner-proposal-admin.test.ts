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
  absenceClassOf,
  buildRegularityReport,
  daysUntil,
  type ConferenceRecord,
} from '@/lib/partner-form/regularity'
import {
  DISCARD_REASONS,
  REVIEW_MARKS,
  applySubstituteTest,
  describeConference,
  normalizeReviewNote,
  readReviewNote,
} from '@/lib/partner-form/proposal-review'
import {
  MATERIAL_KINDS,
  PARTNER_FIELD_IDS,
  fieldsOfStep,
  materialFieldId,
} from '@/lib/partner-form/fields'
import { CLIENT_ADMIN_ONLY_FIELDS } from '@/lib/services/client-editable-fields'
import type { PartnerAnswers } from '@/lib/partner-form/schema'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

const SUBMISSION_ID = '33333333-3333-3333-3333-333333333333'
const CLIENT_ID = '44444444-4444-4444-4444-444444444444'
const OTHER_CLIENT_ID = '55555555-5555-5555-5555-555555555555'
const OPERATOR_ID = 'cms-user-1'
const MATERIAL_ORDER_ID = '55555555-5555-5555-5555-555555555555'

/** What one operator wrote down after seeing the papers. The band's only input. */
function conference(overrides: Partial<ConferenceRecord> = {}): ConferenceRecord {
  return { documentsSeen: [], ...overrides }
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

/**
 * THE EXPIRY TESTS THAT USED TO BE HERE ARE GONE, AND THE ABSENCE IS THE POINT.
 *
 * Three of them proved `expired`, `expiring` and `undated`: an expired licence blocked the
 * contract, one about to expire warned, one with no date could not satisfy the gate. All three
 * read `licenseValidUntil`, which the conference stopped recording on 2026-08-21 by the
 * operator's decision (*"nao iremos pedir o numero do alvará, só dar um check no cms"*).
 *
 * Keeping them as `todo` would be a suite claiming to guard BR-B2B-022 item 4. Nothing guards
 * it now: the system cannot see an expiry it never stored, and that is written on
 * `ConferenceRecord` and on the migration for `produto` to resolve in the rule text.
 */
test('BR-B2B-022: the licence half of the gate is a tick, and the tick is the whole of it', () => {
  const seen = buildRegularityReport(answers(), conference({ documentsSeen: ['business_license'] }))
  assert.equal(seen.license.status, 'seen')
  assert.equal(seen.missing.indexOf('business_license') >= 0, false)

  const unseen = buildRegularityReport(answers(), conference({ documentsSeen: [] }))
  assert.equal(unseen.license.status, 'missing')
  assert.equal(unseen.missing.indexOf('business_license') >= 0, true)
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
    conference: { documentsSeen: ['business_license'] },
  })
  assert.deepEqual(note?.conference.documentsSeen, ['business_license'])

  // A third "document" would be a gate nobody wrote, applied to a contract.
  assert.equal(
    normalizeReviewNote({ marks: [], observation: '', conference: { documentsSeen: ['selfie'] } }),
    null
  )
})

/**
 * ONE TEST REPLACES FIVE, because there is one rule left where there were three fields.
 *
 * What stood here proved the licence number and the issuing municipality were trimmed, refused
 * when too long, and dropped together with the validity date when the tick was off. The three
 * fields left the record on 2026-08-21, so the behaviour they guarded has no code behind it.
 * What DOES need guarding is the compatibility below: `review_note` is shape-free JSON the
 * database never validated, and rows written before that date still carry the three keys.
 */
test('an annotation carrying the retired licence keys is READ, not refused', () => {
  const note = normalizeReviewNote({
    marks: ['dated'],
    observation: '',
    conference: {
      documentsSeen: ['business_license', 'incorporation_document'],
      licenseNumber: '1.234/2019',
      licenseIssuer: "Santa Bárbara d'Oeste",
      licenseValidUntil: '2027-01-31',
    },
  })

  // Refusing would make every proposal conferred before 2026-08-21 unreadable, and the screen
  // would report "nothing seen" about documents somebody did see.
  assert.deepEqual(note?.conference, {
    documentsSeen: ['business_license', 'incorporation_document'],
  })
  assert.equal(buildRegularityReport(answers(), note!.conference).ready, true)
})

test('a value that is not a document kind is still refused, whatever else the body carries', () => {
  assert.equal(
    normalizeReviewNote({ marks: [], observation: '', conference: { documentsSeen: [42] } }),
    null
  )
})

test('BR-B2B-030: the audit description is codes — never what the operator typed', () => {
  const note = normalizeReviewNote({
    marks: ['dated', 'named_person'],
    observation: 'O sócio Antônio trouxe o alvará em mãos.',
    conference: { documentsSeen: ['business_license'] },
  })

  const described = describeConference(note!)
  assert.equal(described.includes('Antônio'), false, 'no free text')
  assert.equal(described, 'documents=business_license; marks=dated+named_person')
})

test('BR-B2B-022: an annotation written before the conference existed reads as "nothing seen"', () => {
  // The column is free-form JSON and rows written by the previous shape are still there. The
  // wrong answer is not a crash, it is a report that quietly claims the papers are in order.
  const note = readReviewNote({ marks: ['dated'], observation: 'O avô abriu em 1962.' })
  assert.deepEqual(note.conference.documentsSeen, [])
  assert.equal(buildRegularityReport(answers(), note.conference).ready, false)
})

// ── The routes ──

/** One statement the stand-in received, in the order it received it, with what it carried. */
interface FakeStatement {
  table: string
  operation: 'select' | 'insert' | 'update' | 'delete'
  payload: Record<string, any> | null
}

interface FakeState {
  submissions: Record<string, any>[]
  clients: Record<string, any>[]
  audit_logs: Record<string, any>[]
  touchedTables: string[]
  /** Every write the stand-in executed — what the promotion invariant is asserted against. */
  statements: FakeStatement[]
  /** Set to make the write against `partner.clients` fail, for the rollback case. */
  clientWriteFails: boolean
  /**
   * Set to make the CLAIM fail — the second statement, after the client is already written.
   * This is the residue the write order accepts, and the only case in which a record with
   * personal data on it exists with nothing pointing at where it came from.
   */
  claimFails: boolean
  /** Every RPC the promotion fired, in order. */
  rpcCalls: { fn: string; args: any }[]
  /** Set to make `partner.create_material_order` refuse, for the "order failed" case. */
  materialOrderFails: boolean
}

/**
 * `partner_form_submissions_promotion_ck`, as the database has it — decision 6 of
 * `20260814140000`, BR-B2B-026: promotion is an act WITH a destination.
 *
 * Written out here because the stand-in below is otherwise a table that accepts anything, and a
 * table that accepts anything cannot go red for the bug that took every promotion in production
 * down: the claim was written in one statement and `promoted_client_id` in the next, and the
 * intermediate state does not exist.
 */
function violatesPromotionCheck(row: Record<string, any>): boolean {
  return row.status === 'promoted' && (!row.promoted_at || !row.promoted_client_id)
}

/** The error Postgres actually returned in production, in the shape PostgREST hands over. */
function checkViolation() {
  return {
    code: '23514',
    message:
      'new row for relation "partner_form_submissions" violates check constraint "partner_form_submissions_promotion_ck"',
  }
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

      if (operation !== 'select') {
        current().statements.push({ table, operation, payload })
      }

      const matched = rows()
      if (operation === 'update') {
        // The statement travelled and the connection dropped: recorded above, refused here,
        // and no row mutated.
        if (key === 'submissions' && current().claimFails && payload?.status === 'promoted') {
          return { data: [], error: { code: '08006', message: 'connection lost' } }
        }
        if (key === 'submissions' && matched.some((row) => violatesPromotionCheck({ ...row, ...payload }))) {
          return { data: [], error: checkViolation() }
        }
        for (const row of matched) Object.assign(row, payload)
        return { data: matched, error: null }
      }
      if (operation === 'insert') {
        const inserted = {
          id: `${key}-${Math.random().toString(36).slice(2, 10)}`,
          created_at: new Date().toISOString(),
          ...payload,
        }
        if (key === 'submissions' && violatesPromotionCheck(inserted)) {
          return { data: [], error: checkViolation() }
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
      // The stand-in records the call instead of executing it: what this suite can prove about
      // `partner.create_material_order` is the ARGUMENTS the CMS sends. Idempotency by
      // submission and the refusal of an empty order are the database's, asserted by the
      // probes of migration 20260819140000, and a fake that reimplemented them here would be a
      // second declaration of a rule this side does not own.
      rpc: async (fn: string, args: any) => {
        current().rpcCalls.push({ fn, args })
        if (current().materialOrderFails) {
          return { data: null, error: { code: '23514', message: 'refused' } }
        }
        return { data: MATERIAL_ORDER_ID, error: null }
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
 * `partner.partner_form_submissions.tax_id_normalized` as the database computes it — GENERATED
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
    statements: [],
    clientWriteFails: false,
    claimFails: false,
    rpcCalls: [],
    materialOrderFails: false,
  }
}

let GET_PROPOSAL: (req: any, ctx: any) => Promise<Response>
let PROMOTE: (req: any, ctx: any) => Promise<Response>
let DISCARD: (req: any, ctx: any) => Promise<Response>
let SAVE_NOTE: (req: any, ctx: any) => Promise<Response>
/**
 * The service function itself, for the one case the route cannot reach: the claim losing the
 * race. The route re-reads the proposal before promoting, so a proposal that is already
 * `promoted` is answered by the route's own precheck and `promoteProposal` never runs.
 *
 * Imported here and not at the top of the file on purpose: `mock.module` below only reaches
 * modules loaded after it, and this one holds `getSupabaseService`.
 */
let PROMOTE_PROPOSAL: typeof import('@/lib/services/partner-proposal-admin-service').promoteProposal

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

  const admin = await import('@/lib/services/partner-proposal-admin-service')
  PROMOTE_PROPOSAL = admin.promoteProposal
})

/** Every write the promotion aimed at the queue table, in the order the stand-in got them. */
function submissionWrites(): FakeStatement[] {
  return state.statements.filter(
    (statement) => statement.table === 'partner_form_submissions' && statement.operation !== 'delete'
  )
}

/** The index of the first write against `partner.clients`, or -1 when there was none. */
function firstClientWriteIndex(): number {
  return state.statements.findIndex((statement) => statement.table === 'clients')
}

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

// ── BR-B2B-026 — promotion is an act WITH a destination, and the destination travels with it ──

test('BR-B2B-026: no statement ever writes `promoted` without the destination in the same payload', async () => {
  // THE BUG THIS EXISTS FOR, and it took every promotion in production down: the claim wrote
  // `status`, `promoted_at` and `promoted_by` in one statement and `promoted_client_id` in a
  // later one. `partner_form_submissions_promotion_ck` refuses that intermediate row with
  // 23514, so the PATCH came back 400 and the panel said nothing had been written.
  //
  // The assertion is on the PAYLOADS and not on the order of the calls: any future shape that
  // splits the trail across two statements is red here even if it splits it the other way round.
  state = freshState()

  const response = await PROMOTE(request('POST', { approved: [], industry: 'Restaurante' }), proposalContext)
  assert.equal(response.status, 200)

  const writes = submissionWrites()
  assert.equal(writes.length > 0, true, 'the promotion did write the queue row')

  for (const write of writes) {
    const payload = write.payload ?? {}
    if (payload.status === 'promoted') {
      assert.equal(
        Boolean(payload.promoted_client_id),
        true,
        'a statement made the row `promoted` without saying into which client'
      )
      assert.equal(Boolean(payload.promoted_at), true, 'and without saying when')
    }
    if ('promoted_client_id' in payload) {
      assert.equal(
        payload.status,
        'promoted',
        'the destination was written apart from the status — the same split, mirrored'
      )
    }
  }
})

test('BR-B2B-026: a promotion that CREATES the client writes it before the claim, and claims in one statement', async () => {
  state = freshState()

  const response = await PROMOTE(request('POST', { approved: [], industry: 'Restaurante' }), proposalContext)
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(state.clients.length, 1)

  const clientIndex = firstClientWriteIndex()
  const claimIndex = state.statements.findIndex(
    (statement) => statement.table === 'partner_form_submissions' && statement.payload?.status === 'promoted'
  )
  assert.equal(clientIndex >= 0 && claimIndex > clientIndex, true, 'the client id exists before it is claimed')

  const claim = state.statements[claimIndex].payload ?? {}
  assert.equal(claim.status, 'promoted')
  assert.equal(claim.promoted_client_id, state.clients[0].id)
  assert.equal(claim.promoted_by, OPERATOR_ID)
  assert.equal(Boolean(claim.promoted_at), true)

  // And the row the operator will reload says the same four things.
  assert.equal(state.submissions[0].status, 'promoted')
  assert.equal(state.submissions[0].promoted_client_id, payload.clientId)
})

test('BR-B2B-026: a promotion onto an EXISTING client claims in one statement too', async () => {
  state = freshState({
    client: {
      id: CLIENT_ID,
      name: 'Cantina do Zé',
      email: 'antonio@cantina.com.br',
      tax_id: '12ABC34501DE35',
      city: 'Santos',
    },
  })

  const response = await PROMOTE(request('POST', { approved: ['city'], industry: 'Restaurante' }), proposalContext)

  assert.equal(response.status, 200)
  assert.equal(state.clients[0].city, 'São Vicente', 'the ticked column was written')

  const claims = submissionWrites().filter((write) => write.payload?.status === 'promoted')
  assert.equal(claims.length, 1, 'one statement, not two')
  assert.equal(claims[0].payload?.promoted_client_id, CLIENT_ID)
  assert.equal(state.submissions[0].promoted_client_id, CLIENT_ID)
})

test('#341: a promotion that fails to write the client never claims the proposal', async () => {
  // The client write comes first now, so its failure is the cheap one: the queue row is not
  // touched at all and the proposal is still offered. `write_failed` is what the route turns
  // into 503.
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
  const payload = await response.json()

  assert.equal(response.status, 503)
  assert.equal(payload.error, 'write_failed')
  assert.equal(state.submissions[0].status, 'submitted', 'the proposal is still in the queue')
  assert.equal(state.submissions[0].promoted_at, null)
  assert.equal(state.submissions[0].promoted_client_id, null)
  assert.equal(submissionWrites().length, 0, 'no claim was ever attempted')
  assert.equal(state.clients[0].city, undefined, 'and the client record is untouched')
})

test('BR-B2B-026: a claim that matches no row answers `not_promotable` — the loser of the race', async () => {
  // Two operators clicking together: the predicate `status = 'submitted'` still elects exactly
  // one winner, and the second UPDATE matches nothing. The reason has to stay `not_promotable`
  // — it is what the route maps to 409 — even though the client write already happened, which
  // is the residue this order accepts and the block comment on `promoteProposal` names.
  state = freshState({ submission: { status: 'promoted' }, client: { id: CLIENT_ID, name: 'Cantina do Zé' } })
  state.submissions[0].promoted_at = '2026-08-17T10:00:00Z'
  state.submissions[0].promoted_client_id = OTHER_CLIENT_ID

  const outcome = await PROMOTE_PROPOSAL({
    submissionId: SUBMISSION_ID,
    clientId: CLIENT_ID,
    updates: { name: 'Cantina do Zé' },
    written: ['name'],
    answers: {},
    promotedBy: OPERATOR_ID,
  })

  // The id travels out of the failure branch: the client write already happened, and the route
  // is what turns that into the trail the record would otherwise not have.
  assert.deepEqual(outcome, { ok: false, reason: 'not_promotable', clientId: CLIENT_ID })
  assert.equal(
    state.submissions[0].promoted_client_id,
    OTHER_CLIENT_ID,
    'the winner kept the destination it wrote'
  )
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
      conference: { documentsSeen: ['business_license', 'incorporation_document'] },
    }),
    proposalContext
  )
  assert.equal(saved.status, 200)

  const detail = await (await GET_PROPOSAL(request('GET'), proposalContext)).json()
  assert.deepEqual(detail.conference.documentsSeen, [
    'business_license',
    'incorporation_document',
  ])
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
    conference: { documentsSeen: [] },
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
      conference: { documentsSeen: ['business_license'] },
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
  // `documents=business_license` is a document CODE, not a transcription. What must be gone is
  // the trail of the three fields that left the record on 2026-08-21.
  assert.equal(row?.description.includes('license_valid_until'), false)
  assert.equal(row?.description.includes('license_identity'), false)
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
      conference: { documentsSeen: ['business_license', 'incorporation_document'] },
    }),
    proposalContext
  )

  const detail = await (await GET_PROPOSAL(request('GET'), proposalContext)).json()
  assert.deepEqual(detail.conference.documentsSeen, [
    'business_license',
    'incorporation_document',
  ])
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

test('BR-B2B-026: a claim that fails after the client was written leaves a row naming the residue', async () => {
  // The order of the promotion is the client first (the claim needs its destination in the same
  // statement), so this is the failure that COSTS something: `partner.clients` holds a record with
  // the representative's name, e-mail, phone and role, the CNPJ and the address, and the table
  // has no authorship column, no audit trigger and no unique `tax_id` to find it by later.
  // Without this row, that record exists and nothing anywhere says who made it or from what.
  state = freshState()
  state.claimFails = true

  const response = await PROMOTE(request('POST', { approved: [], industry: 'Restaurante' }), proposalContext)
  const payload = await response.json()

  assert.equal(response.status, 503, 'the operator is still told the promotion did not happen')
  assert.equal(payload.error, 'write_failed')
  assert.equal(state.clients.length, 1, 'and the client the write created is still there')
  assert.equal(state.submissions[0].status, 'submitted', 'with the proposal back in the queue')

  const row = state.audit_logs.find((entry) => entry.action === 'PROMOTE_PARTNER_PROPOSAL_UNCLAIMED')
  assert.ok(row, 'the residue left a trail')
  assert.equal(row?.entity, 'CLIENT')
  assert.equal(row?.entity_id, state.clients[0].id, 'pointing at the record that was written')
  assert.equal(row?.user_id, OPERATOR_ID, 'and naming who wrote it')
  assert.equal(row?.user_email, 'admin@tuggi.app')
  assert.ok(row?.description.includes(SUBMISSION_ID), 'and the proposal it came from')
  assert.ok(row?.description.includes(String(state.clients[0].id)), 'and the client id')
  assert.equal(
    state.audit_logs.some((entry) => entry.action === 'PROMOTE_PARTNER_PROPOSAL'),
    false,
    'nothing in the trail claims the promotion happened'
  )
})

test('BR-B2B-026: a promotion whose client write failed leaves NO audit row — there is nothing to trace', async () => {
  // The mirror case, and the reason the event is conditional instead of unconditional: nothing
  // was written, so a row here would name a client id that does not exist and send whoever
  // reads the trail looking for a record nobody created.
  state = freshState()
  state.clientWriteFails = true

  const response = await PROMOTE(request('POST', { approved: [], industry: 'Restaurante' }), proposalContext)

  assert.equal(response.status, 503)
  assert.equal(state.clients.length, 0)
  assert.equal(state.audit_logs.length, 0, 'no act happened, so no act is recorded')
})

test('BR-B2B-026: a promotion that goes through records the promotion and nothing else', async () => {
  state = freshState({
    client: {
      id: CLIENT_ID,
      name: 'Cantina do Zé',
      email: 'antonio@cantina.com.br',
      tax_id: '12ABC34501DE35',
    },
  })

  const response = await PROMOTE(request('POST', { approved: [], industry: 'Restaurante' }), proposalContext)
  assert.equal(response.status, 200)

  assert.ok(state.audit_logs.find((row) => row.action === 'PROMOTE_PARTNER_PROPOSAL'))
  assert.equal(
    state.audit_logs.some((row) => row.action === 'PROMOTE_PARTNER_PROPOSAL_UNCLAIMED'),
    false,
    'a promotion that landed is not a residue'
  )
})

test('BR-B2B-026: no promotion trail carries a value the partner typed — uuids and the reason only', async () => {
  // The audit table is read by more people than the client record is, so a description carrying
  // the answers would copy the personal data into a SECOND place while claiming to protect it.
  // The needles are the fixture's own values: whatever the description is rewritten into, it
  // goes red the moment an answer reaches it.
  const typed = answers()
  const needles = [
    typed.representative_name!,
    typed.representative_email!,
    typed.representative_phone!,
    typed.representative_role!,
    typed.tax_id!,
    typed.address!,
    typed.legal_name!,
  ]

  const scenarios: (() => void)[] = [
    () => {
      state = freshState()
    },
    () => {
      state = freshState()
      state.claimFails = true
    },
    () => {
      state = freshState()
      state.clientWriteFails = true
    },
  ]

  for (const scenario of scenarios) {
    scenario()
    await PROMOTE(request('POST', { approved: [], industry: 'Restaurante' }), proposalContext)

    for (const row of state.audit_logs) {
      for (const needle of needles) {
        assert.equal(
          String(row.description ?? '').includes(needle),
          false,
          `"${needle}" reached the audit trail of ${row.action}`
        )
      }
    }
  }
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
  // The line says what the record holds, and the record is a tick. It said `Vigente até {date}`
  // until 2026-08-21, which was the copy promising a validity check nothing performs any more.
  assert.equal(copy.regularity.licenseOk.includes('{date}'), false)
  assert.equal(copy.regularity.licenseOk.includes('Vigente'), false)
})

test('BR-B2B-030: the band says who registered the conference, before saying what it is not', () => {
  // Item 2 of the rule asks the trail to name the person and the date. `source` then carries
  // the limit of BR-B2B-022 item 7 — and carries its own scope, because the old text opened
  // with `Estas duas linhas` while the band has four.
  assert.ok(copy.regularity.checkedBy.includes('{person}'))
  assert.ok(copy.regularity.checkedBy.includes('{date}'))
  assert.equal(copy.regularity.source.includes('duas linhas'), false)
  assert.ok(copy.regularity.source.includes('alvará'), 'the limit names what it is about')

  // `licenseIdentity` and `licenseIdentityMissing` are gone with the fields they printed. A key
  // that outlives its screen is copy nobody maintains and every translator still translates.
  assert.equal('licenseIdentity' in copy.regularity, false)
  assert.equal('licenseIdentityMissing' in copy.regularity, false)
})

/**
 * The inverse of what stood here. It asserted that the conference block carried a label, a hint
 * and a disabled-reason for each of the three licence fields; now it asserts the nine keys are
 * GONE, for the same reason the old test existed — copy that outlives its control is a promise
 * the screen no longer keeps, and every translator still pays for it.
 */
test('the licence transcription keys left the conference block with the fields', () => {
  for (const key of [
    'licenseNumberLabel',
    'licenseNumberHint',
    'licenseNumberDisabled',
    'licenseIssuerLabel',
    'licenseIssuerHint',
    'licenseIssuerDisabled',
    'validUntilLabel',
    'validUntilHint',
    'validUntilDisabled',
  ]) {
    assert.equal(key in copy.conference, false, `conference.${key} outlived its control`)
  }

  // What the block still has to say: the two ticks, and that a tick is somebody's word.
  assert.ok(copy.conference.seen.business_license)
  assert.ok(copy.conference.seen.incorporation_document)
  assert.ok(copy.conference.savedWithNote.length > 0)
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

test('#341: the conference page hands the Portuguese messages to its children', () => {
  // Criterion 28. The copy lives only in `pt.json` by decision, and an absent key in next-intl
  // renders THE KEY NAME — so `/en/` and `/es/` are only safe because the page supplies them.
  //
  // IT USED TO BE TWO PAGES. The LIST was absorbed by the partnership pipeline in #359 and the
  // conference screen MOVED to `/admin/partnerships/proposals/{id}` — the guarantee is
  // unchanged, and the pipeline's own half of it is criterion 29 of
  // `tests/api/partnerships-pipeline.test.ts`.
  for (const page of ['app/[locale]/admin/partnerships/proposals/[submissionId]/page.tsx']) {
    const source = readFileSync(resolve(REPO_ROOT, page), 'utf8')
    assert.ok(source.indexOf('NextIntlClientProvider') >= 0, `${page} does not provide messages`)
    assert.ok(source.indexOf("ptMessages.PartnerProposals") >= 0, `${page} does not provide the namespace`)
    assert.ok(source.indexOf("ptMessages.PartnerForm") >= 0, `${page} does not provide the labels`)
  }
})


/* -------------------------------------------------------------------------- */
/* O pedido de material que a promoção materializa                            */
/* -------------------------------------------------------------------------- */

test('BR-B2B-021: promoting turns the material asked for into ONE order, with a line per kind', async () => {
  state = freshState()
  state.submissions[0].answers = {
    ...state.submissions[0].answers,
    material_sticker_qty: '30',
    material_table_display_qty: '12',
  }

  const response = await PROMOTE(request('POST', { approved: [] }), proposalContext)
  assert.equal(response.status, 200)

  const calls = state.rpcCalls.filter((call) => call.fn === 'create_material_order')
  assert.equal(calls.length, 1, 'one promotion, one order')

  const args = calls[0].args
  // The quantities travel as NUMBERS, not as the strings `answers` stores: the column is
  // `smallint`, and `"30"` reaching a smallint depends on a cast nobody wrote down.
  assert.deepEqual(args.p_items, { sticker: 30, table_display: 12 })
  assert.equal(args.p_source, 'proposal')
  assert.equal(args.p_submission_id, SUBMISSION_ID)
  assert.equal(args.p_created_by, OPERATOR_ID)
  assert.ok(args.p_client_id, 'the order points at the client the promotion produced')
})

test('a kind left blank is a kind with no line — never a line with zero', async () => {
  state = freshState()
  state.submissions[0].answers = {
    ...state.submissions[0].answers,
    material_sticker_qty: '30',
    material_table_display_qty: '',
    material_counter_display_qty: '0',
  }

  await PROMOTE(request('POST', { approved: [] }), proposalContext)

  const args = state.rpcCalls.find((call) => call.fn === 'create_material_order')?.args
  // `partner.material_order_items` has `CHECK (quantity > 0)`. Sending a zero would be the CMS
  // asking the database to refuse something it could have not sent — and "não quero" and
  // "quero zero" would become two spellings of one fact.
  assert.deepEqual(args.p_items, { sticker: 30 })
})

test('a proposal that asked for no material promotes anyway, and fires no order', async () => {
  // Rows written before the material question existed carry none of the three. Refusing to
  // promote them would strand a partner over a question they were never asked — the rule that
  // requires at least one lives on the WRITING side, and it cannot reach backwards.
  state = freshState()

  const response = await PROMOTE(request('POST', { approved: [] }), proposalContext)
  assert.equal(response.status, 200)
  assert.equal(
    state.rpcCalls.filter((call) => call.fn === 'create_material_order').length,
    0,
    'no material asked for, no order'
  )
})

test('an order that fails does not undo the promotion, and does not pass as "asked for nothing"', async () => {
  state = freshState()
  state.materialOrderFails = true
  state.submissions[0].answers = {
    ...state.submissions[0].answers,
    material_counter_display_qty: '2',
  }

  const outcome = await PROMOTE_PROPOSAL({
    submissionId: SUBMISSION_ID,
    clientId: null,
    updates: { name: 'Cantina do Zé' },
    written: ['name'],
    answers: { material_counter_display_qty: '2' },
    promotedBy: OPERATOR_ID,
  })

  // The client is written and the submission is claimed by the time the order is attempted.
  // Failing the whole promotion here would report "nothing happened" about an act that already
  // happened; a silent `null` would say the partner asked for no material, which is a
  // different fact and the one somebody would act on.
  assert.equal(outcome.ok, true)
  assert.equal(outcome.ok && outcome.materialOrder, 'failed')
})

/* -------------------------------------------------------------------------- */
/* A tela de conferência reorganizada — 2026-08-25                             */
/* -------------------------------------------------------------------------- */

/**
 * The screen was arranged by FORM and not by DECISION, and the three defects the reordering
 * closed are the three cases below. They are source assertions for the same reason the rest of
 * this block is: what broke was a rendering choice, and a rendering choice has no return value.
 */

const SUMMARY_SOURCE = resolve(REPO_ROOT, 'components/admin/partner-proposals/ProposalSummary.tsx')
const ANSWERS_SOURCE = resolve(REPO_ROOT, 'components/admin/partner-proposals/ProposalAnswers.tsx')
const REVIEW_SOURCE = resolve(REPO_ROOT, 'components/admin/partner-proposals/ProposalReview.tsx')
const PROPOSAL_PAGE = 'app/[locale]/admin/partnerships/proposals/[submissionId]/page.tsx'

test('nenhuma resposta do formulário fica invisível na tela de conferência', () => {
  /**
   * THE DEFECT THIS CLOSES, and it survived a green build for four days: the answers grid
   * renders `fieldsOfStep(1)` and `fieldsOfStep(2)`, the story card renders the four
   * `story_*`, and the material block renders `MATERIAL_KINDS` — which left `plan_choice`,
   * added to step 3 on 2026-08-21, on NO part of the page. It is the answer that says whether
   * the partner is asking for the free faixa or the paid one (BR-B2B-016), and the operator
   * deciding about the proposal could not read it without opening the database.
   *
   * The test is the complement and not the field: any 27th question added to step 3 fails here
   * until somebody puts it in front of a person.
   */
  const loops = new Set<string>()
  for (const step of [1, 2] as const) {
    for (const field of fieldsOfStep(step)) loops.add(field.id)
  }
  for (const kind of MATERIAL_KINDS) loops.add(materialFieldId(kind))
  // The four the story card walks, declared there as `STORY_FIELDS`.
  for (const id of ['story_founder', 'story_before', 'story_unique', 'story_event']) loops.add(id)

  const surfaces = [SUMMARY_SOURCE, ANSWERS_SOURCE, REVIEW_SOURCE]
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')

  const invisible = PARTNER_FIELD_IDS.filter(
    (id) => !loops.has(id) && surfaces.indexOf(id) < 0
  )
  assert.deepEqual(invisible, [], 'estas respostas não aparecem em lugar nenhum da tela')

  // And the one the complement was written for is read by name, in the digest, first.
  assert.match(readFileSync(SUMMARY_SOURCE, 'utf8'), /plan_choice/)
})

test('o cabeçalho lê o estado e o próximo passo do mesmo módulo que a esteira', () => {
  // DS-COPY-020 separates the two fields and DS-COMPONENTE-020, point 4, forbids the detail
  // and the list from wording the same row differently. One module, one set of message keys.
  const review = readFileSync(REVIEW_SOURCE, 'utf8')
  assert.match(review, /derivePipelineState/, 'o estado é derivado à mão nesta tela')
  assert.match(review, /states\.\$\{shownState\}/, 'o rótulo do estado não vem de `Partnerships`')
  assert.match(review, /nextSteps\.\$\{shownState\}/, 'o próximo passo não vem de `Partnerships`')
  assert.match(review, /IN_PROGRESS_STATES/, 'estado terminal ganharia um próximo passo vazio')

  // Sem o namespace na página, next-intl imprime o NOME DA CHAVE no lugar do rótulo.
  const page = readFileSync(resolve(REPO_ROOT, PROPOSAL_PAGE), 'utf8')
  assert.ok(
    page.indexOf('ptMessages.Partnerships') >= 0,
    `${PROPOSAL_PAGE} não entrega o vocabulário da esteira aos filhos`
  )

  // E o vocabulário existe onde os dois o procuram.
  const partnerships = JSON.parse(readFileSync(resolve(REPO_ROOT, 'messages/pt.json'), 'utf8'))
    .Partnerships
  for (const state of ['proposal_received', 'in_conference', 'client_created']) {
    assert.ok(partnerships.states[state], `states.${state} não existe`)
    assert.ok(partnerships.nextSteps[state], `nextSteps.${state} não existe`)
  }
})

test('promovida, a tela oferece o próximo ato — e ele abre a aba da parceria', () => {
  /**
   * The round trip this closes: promoting ended in a stripe whose only link opened the
   * paginated client list on the profile tab, so the operator went BACK to the board and
   * FORWARD again to do the next act. DS-LAYOUT-006, points 1 and 2 — open the tool ON the
   * object, and declare the way back.
   */
  const review = readFileSync(REVIEW_SOURCE, 'utf8')
  assert.match(review, /tab: 'partnership'/, 'o link não abre a aba da parceria')
  assert.match(review, /returnParams\(/, 'o link não declara o caminho de volta')
  assert.ok(copy.review.continueAction.indexOf('{name}') >= 0, 'o ato não nomeia o alvo')
  assert.ok(copy.review.continueHeading.length > 0)
  assert.ok(copy.review.continueHint.length > 0)
  // O estado exibido depois da promoção é LIDO, nunca derivado do que uma submissão sabe: o
  // contrato e os locais não estão nesta tela, e `Cliente criado` ao lado de um contrato
  // assinado ontem é a discordância que o módulo único existe para impedir.
  assert.match(review, /api\/admin\/partnerships\/clients\//)
  assert.ok(copy.review.continueUnknown.length > 0, 'sem estado lido, a tela precisa dizer isso')
})

test('a conferência se guarda do cartão onde ela é marcada', () => {
  // O tique ficava num trilho estreito do outro lado da página e era gravado por um botão de um
  // TERCEIRO cartão. Um controle cuja gravação mora noutro bloco é um controle que o operador
  // acha que não fez nada.
  const review = readFileSync(REVIEW_SOURCE, 'utf8')
  assert.match(review, /saveNote\('conference'\)/)
  assert.match(review, /saveNote\('note'\)/)
  for (const key of ['save', 'saving', 'saved', 'saveFailed']) {
    assert.ok(copy.conference[key], `conference.${key} não existe`)
  }
  // A âncora que a faixa aponta continua existindo na tela que a desenha.
  assert.match(review, /id="conference-heading"/)
})

test('os dois tokens de superfície das telas de parceria são declarados uma vez', () => {
  // CLAUDE.md §6, DRY: quatro cópias verbatim da mesma decisão de estilo, cada uma com o
  // comentário que a explicava. O dia em que alguém corrigir a borda do tema escuro numa delas,
  // as outras ficam com a antiga e nada quebra.
  const folder = [
    'ProposalReview.tsx',
    'ProposalSummary.tsx',
    'ProposalAnswers.tsx',
    'RegularityBand.tsx',
    'PromotionPanel.tsx',
    'OutboundMessage.tsx',
  ]
  for (const file of folder) {
    const source = readFileSync(
      resolve(REPO_ROOT, 'components/admin/partner-proposals', file),
      'utf8'
    )
    assert.equal(
      /^const (CARD|FIELD) =/m.test(source),
      false,
      `${file} redeclara um token que mora em surface.ts`
    )
  }
})

test('a promoção só pede ato onde existe divergência', () => {
  /**
   * THE DEAD STEP THIS CLOSES. The panel drew a four-column comparison table over every column
   * of the plan, and for the ordinary case — a proposal with no client behind it — all fifteen
   * rows read `vazio` on one side and `Estava vazio — vai ser preenchido` on the other. None of
   * them was a decision: `resolvePromotionWrite` writes a `fill` with no act, by design. The
   * operator learns to click through a wall, and the tick that DOES matter is on the same wall.
   */
  const answers: PartnerAnswers = {
    trade_name: 'Mar. Restaurante',
    tax_id: '42947907000102',
    category: 'restaurant',
    city: 'Cabo Frio',
    state: 'RJ',
    representative_name: 'Paulo Cesar Fernandes Costa',
    representative_email: 'paulo@exemplo.com',
  }

  // Sem cliente atrás dela, a proposta não tem uma única decisão para tomar.
  const fresh = buildPromotionPlan(answers, null, { categoryLabel: 'Restaurante' })
  assert.ok(fresh.entries.length > 0)
  assert.deepEqual(
    fresh.entries.filter((entry) => entry.decision === 'conflict'),
    [],
    'uma proposta sem cliente não pode ter campo divergente'
  )

  // E os dois números que a tela mostra saem da MESMA lista: a frase dos vazios e o botão que
  // grava. Eles discordaram uma vez — `14 campos vão ser preenchidos` sobre `Gravar 15 campos` —
  // porque a coluna editável tinha sido tirada de uma contagem e não da outra.
  const summary = summarizePromotion(fresh, { approved: [] })
  assert.equal(
    summary.total,
    fresh.entries.filter((entry) => entry.decision === 'fill').length,
    'a frase dos vazios e o botão contam listas diferentes'
  )

  const panel = readFileSync(
    resolve(REPO_ROOT, 'components/admin/partner-proposals/PromotionPanel.tsx'),
    'utf8'
  )
  // A tabela é dos divergentes e de mais ninguém.
  assert.match(panel, /conflicts\.map\(/)
  assert.equal(
    /plan\.entries\.map\(/.test(panel),
    false,
    'o painel voltou a desenhar uma linha de tabela por coluna do plano'
  )
  // Os vazios são uma frase com a contagem, e a lista fica a um clique — a gravação não desfaz.
  assert.match(panel, /promotion\.fillsSummary/)
  assert.match(panel, /aria-expanded=\{fillsOpen\}/)
  // E a legenda que repetia a mesma frase quinze vezes não existe mais em lugar nenhum.
  assert.equal('fillBadge' in copy.promotion, false, 'fillBadge sobreviveu ao controle que a exibia')
  assert.equal(panel.indexOf('fillBadge') >= 0, false)
})

test('BR-B2B-011 item 2.2: a faixa gratuita não tem história para o portão 2 medir', () => {
  /**
   * The rule is already written, and this only applies it. The input of a `map_only` partner IS
   * the minimal registration BY DESIGN (BR-B2B-016, item 1 — the app says the name of the place
   * and nothing beyond it), and what gate 2 measures without qualification is WHAT WILL BE
   * NARRATED. For this tier that is nothing, so the four story questions, the three reading
   * marks and the substitute test are a block about a description that will never exist —
   * rendered anyway, they report four absences about questions nobody asked.
   */
  const review = readFileSync(
    resolve(REPO_ROOT, 'components/admin/partner-proposals/ProposalReview.tsx'),
    'utf8'
  )

  // ABSENCE IS NOT THE FREE TIER. Proposals submitted before `plan_choice` existed carry no
  // tier at all, and a negated test against the paid value would hide the gate-2 input on
  // exactly the rows that still have one.
  assert.match(review, /const mapOnly = answers\.plan_choice === 'map_only'/)
  assert.equal(
    /plan_choice !== 'map_and_description'/.test(review),
    false,
    'a supressão passou a tratar tier ausente como faixa gratuita'
  )

  // O bloco inteiro do portão 2 — respostas, marcas e teste do substituto — fica atrás da mesma
  // condição, e a anotação da triagem NÃO: os portões 1 e 3 continuam valendo nas duas faixas.
  assert.match(review, /\{!mapOnly && \(/)
  assert.match(review, /story\.mapOnlyBody/)
  const afterGuard = review.slice(review.indexOf('{!mapOnly && ('))
  assert.ok(
    afterGuard.indexOf('review-observation') > afterGuard.indexOf('</>'),
    'a observação da triagem ficou dentro da supressão'
  )

  // E a copy diz POR QUE o bloco não está ali, com o ID que decide.
  assert.match(copy.story.mapOnlyBody, /BR-B2B-011/)
  assert.ok(copy.story.mapOnlyHeading.length > 0)
})
