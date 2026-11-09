/**
 * #1144 — the moderation of public names in the CMS: the queue of reports, the reset and the lock
 * on the account record, and the lists the filter reads. BR-USUARIO-051 items 1, 2, 2.d, 5 and 6,
 * BR-USUARIO-050 item 7. Contract `docs/contracts/identidade-publica.md`, "CMS" and "Tabelas que o
 * CMS lê e escreve direto".
 *
 * The routes run for real; the gate, the service client and the audit are stand-ins. The tables and
 * RPCs answer what the contract says, and the suite pins what the CMS sends and what it makes of the
 * answer.
 *
 * Mutations that turn this suite red:
 *  · a decision, reset or lock sent without `p_actor`, or with an actor from the body;
 *  · the queue reading decided reports, or ordering other than by `last_reported_at`;
 *  · a route of this card opened to a non-admin role, or a read cached;
 *  · the reported value, the name or the term written to the audit trail or to the log;
 *  · `already_decided` audited as a decision, or a 23505 answered as a 503;
 *  · a delete that removed nothing answered as a success;
 *  · any write to `drive.text_filter_ldnoobw_terms`.
 *
 * Run with: npm run test:api
 */

import { before, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import type { NextRequest } from 'next/server'

const ROOT = resolve(import.meta.dirname, '../..')
const ACTOR = '99999999-9999-4999-8999-999999999999'
const ALICE = '11111111-1111-4111-8111-111111111111'
const BRUNO = '22222222-2222-4222-8222-222222222222'

type Answer = { data: unknown; error: { code: string; message?: string } | null; count?: number | null }

interface TableCall {
  schema: string
  table: string
  ops: [string, unknown[]][]
}

let rpcs: { schema: string; fn: string; args: unknown }[] = []
let tableCalls: TableCall[] = []
let rpcAnswers: Record<string, Answer> = {}
let tableAnswers: Record<string, (call: TableCall) => Answer> = {}
let audits: Record<string, unknown>[] = []
const policies: unknown[] = []
let logged: string[] = []

function builder(schema: string, table: string) {
  const call: TableCall = { schema, table, ops: [] }
  tableCalls.push(call)
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          const answer = tableAnswers[table]?.(call) ?? { data: null, error: { code: 'XX000' } }
          return (onOk: (v: Answer) => unknown, onFail: (e: unknown) => unknown) => Promise.resolve(answer).then(onOk, onFail)
        }
        return (...args: unknown[]) => {
          call.ops.push([String(prop), args])
          return proxy
        }
      },
    }
  )
  return proxy
}

const fakeService = {
  schema: (schema: string) => ({
    rpc: async (fn: string, args?: unknown) => {
      rpcs.push({ schema, fn, args })
      return rpcAnswers[fn] ?? { data: null, error: { code: 'XX000' } }
    },
    from: (table: string) => builder(schema, table),
  }),
}

const has = (call: TableCall, op: string) => call.ops.some(([name]) => name === op)
const argsOf = (call: TableCall, op: string) => call.ops.find(([name]) => name === op)?.[1]

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }, auth: unknown) => Promise<Response>
let reportsGET: Handler
let decidePOST: Handler
let identityGET: Handler
let identityPATCH: Handler
let resetPOST: Handler
let listsGET: Handler
let reservedPOST: Handler
let reservedDELETE: Handler
let termsPOST: Handler
let termsDELETE: Handler
let moderation: typeof import('@/lib/public-identity/moderation')
let IdentityReportsQueue: typeof import('@/components/admin/public-names/ReportsQueue')['IdentityReportsQueue']
let PublicIdentityPanel: typeof import('@/components/admin/PublicIdentityModeration')['PublicIdentityPanel']

before(async () => {
  mock.module('@/lib/auth-middleware', {
    namedExports: {
      withAuth: (policy: unknown, handler: unknown) => {
        policies.push(policy)
        return handler
      },
      withRateLimit: () => (handler: unknown) => handler,
    },
  })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseService: () => fakeService,
      getSupabase: () => fakeService,
      getSupabaseRouteHandler: () => fakeService,
      getSupabaseClient: () => ({}),
    },
  })
  mock.module('@/lib/services/audit-service', {
    namedExports: {
      logAuditEvent: async (input: Record<string, unknown>) => {
        audits.push(input)
        return true
      },
    },
  })
  // What the routes log is part of the proof: no reported value, name or term may reach it.
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(' '))
  }
  const load = async (path: string) => (await import(path)) as Record<string, Handler>
  ;({ GET: reportsGET } = await load('@/app/api/admin/public-identity/reports/route'))
  ;({ POST: decidePOST } = await load('@/app/api/admin/public-identity/reports/[reportId]/decide/route'))
  ;({ GET: identityGET, PATCH: identityPATCH } = await load('@/app/api/admin/users/[userId]/public-identity/route'))
  ;({ POST: resetPOST } = await load('@/app/api/admin/users/[userId]/public-identity/reset/route'))
  ;({ GET: listsGET } = await load('@/app/api/admin/public-identity/lists/route'))
  ;({ POST: reservedPOST, DELETE: reservedDELETE } = await load('@/app/api/admin/public-identity/reserved-names/route'))
  ;({ POST: termsPOST, DELETE: termsDELETE } = await load('@/app/api/admin/public-identity/own-terms/route'))
  moderation = await import('@/lib/public-identity/moderation')
  ;({ IdentityReportsQueue } = await import('@/components/admin/public-names/ReportsQueue'))
  ;({ PublicIdentityPanel } = await import('@/components/admin/PublicIdentityModeration'))
})

beforeEach(() => {
  rpcs = []
  tableCalls = []
  rpcAnswers = {}
  tableAnswers = {}
  audits = []
  logged = []
})

const AUTH = { user: { id: ACTOR, email: 'curadoria@tuggi.app' }, cmsUser: { role: 'admin', email: 'curadoria@tuggi.app' } }

function request(method: string, body?: unknown, url = 'http://cms.test/api'): NextRequest {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
}

const params = (values: Record<string, string> = {}) => ({ params: Promise.resolve(values) })

const REPORT_ROWS = [
  {
    id: 7,
    target_user_id: ALICE,
    field: 'nickname',
    reported_value: 'xingamento.feio',
    surface: 'scoreboard',
    reports_count: 3,
    created_at: '2026-11-08T10:00:00Z',
    last_reported_at: '2026-11-08T12:00:00Z',
  },
  {
    id: 9,
    target_user_id: BRUNO,
    field: 'bio',
    reported_value: 'Bio ofensiva',
    surface: 'profile_page',
    reports_count: 1,
    created_at: '2026-11-09T09:00:00Z',
    last_reported_at: '2026-11-09T09:00:00Z',
  },
]

function auditTrail(): string {
  return JSON.stringify(audits) + logged.join('\n')
}

// ── The gate ───────────────────────────────────────────────────────────────────────────────

test('#1144: every route of the moderation of public names is admin only', () => {
  assert.equal(policies.length, 10)
  for (const policy of policies) assert.deepEqual(policy, { roles: ['admin'] })
})

// ── The queue (item 5) ─────────────────────────────────────────────────────────────────────

test('BR-USUARIO-051 item 5: the queue reads only open reports, ordered by last_reported_at, never cached', async () => {
  tableAnswers.public_identity_reports = () => ({ data: REPORT_ROWS, error: null, count: 2 })
  tableAnswers.profiles = () => ({ data: [{ id: ALICE, nickname: 'Andarilho42' }], error: null })
  const res = await reportsGET(request('GET'), params(), AUTH)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Cache-Control'), 'no-store')

  const read = tableCalls.find((c) => c.table === 'public_identity_reports')!
  assert.equal(read.schema, 'drive')
  assert.deepEqual(argsOf(read, 'eq'), ['status', 'open'])
  assert.deepEqual(argsOf(read, 'order'), ['last_reported_at', { ascending: true }])
  assert.ok(!has(read, 'insert') && !has(read, 'update') && !has(read, 'delete'), 'the queue only reads; it decides by the RPC')

  const body = (await res.json()) as { reports: import('@/lib/public-identity/moderation').IdentityReportRow[]; total: number }
  assert.equal(body.total, 2)
  assert.deepEqual(body.reports.map((r) => [r.reportId, r.field, r.surface, r.reportsCount, r.nickname]), [
    [7, 'nickname', 'scoreboard', 3, 'Andarilho42'],
    [9, 'bio', 'profile_page', 1, null],
  ])
})

test('a failed queue read is a 503 with the code only in the log, never an empty queue', async () => {
  tableAnswers.public_identity_reports = () => ({ data: null, error: { code: '42501', message: 'xingamento.feio' } })
  const res = await reportsGET(request('GET'), params(), AUTH)
  assert.equal(res.status, 503)
  assert.ok(!auditTrail().includes('xingamento'), 'the message of a failed read stays out of the log')
})

test('a malformed report row is dropped instead of drawn', () => {
  const rows = moderation.parseReportRows([
    { ...REPORT_ROWS[0], field: 'email' },
    { ...REPORT_ROWS[0], surface: 'push' },
    { ...REPORT_ROWS[0], target_user_id: 'not-a-uuid' },
    REPORT_ROWS[1],
  ])
  assert.deepEqual(rows?.map((r) => r.reportId), [9])
  assert.equal(moderation.parseReportRows({}), null)
})

test('BR-USUARIO-051 item 5.b: removing a reported @ calls the RPC with the curator as actor, and the value stays out of the trail', async () => {
  rpcAnswers.decide_public_identity_report_as = {
    data: { report_id: 7, status: 'removed', changed: true, value: 'AndarilhoErrante88' },
    error: null,
  }
  const res = await decidePOST(request('POST', { decision: 'remove', actor: BRUNO }), params({ reportId: '7' }), AUTH)
  assert.equal(res.status, 200)
  assert.deepEqual(rpcs, [
    { schema: 'drive', fn: 'decide_public_identity_report_as', args: { p_report_id: 7, p_decision: 'remove', p_actor: ACTOR } },
  ])
  assert.deepEqual(((await res.json()) as { outcome: unknown }).outcome, { kind: 'removed', value: 'AndarilhoErrante88' })
  assert.equal(audits.length, 1)
  assert.equal(audits[0].action, 'DECIDE_PUBLIC_IDENTITY_REPORT')
  assert.ok(!auditTrail().includes('xingamento') && !auditTrail().includes('AndarilhoErrante88'))
})

test('BR-USUARIO-051 item 5: keeping closes the report and changes nothing', async () => {
  rpcAnswers.decide_public_identity_report_as = { data: { report_id: 9, status: 'dismissed', changed: true }, error: null }
  const res = await decidePOST(request('POST', { decision: 'dismiss' }), params({ reportId: '9' }), AUTH)
  assert.equal(res.status, 200)
  assert.equal((rpcs[0].args as { p_decision: string }).p_decision, 'dismiss')
  assert.deepEqual(((await res.json()) as { outcome: unknown }).outcome, { kind: 'dismissed' })
})

test('BR-USUARIO-051 item 5: a report decided by someone else is an answer (200), not audited again', async () => {
  rpcAnswers.decide_public_identity_report_as = { data: { report_id: 7, status: 'removed', changed: false }, error: null }
  const res = await decidePOST(request('POST', { decision: 'dismiss' }), params({ reportId: '7' }), AUTH)
  assert.equal(res.status, 200)
  assert.deepEqual(((await res.json()) as { outcome: unknown }).outcome, { kind: 'already_decided', status: 'removed' })
  assert.equal(audits.length, 0)
})

test('a decision outside remove and dismiss, or a bad id, never reaches the database', async () => {
  for (const [body, id] of [
    [{ decision: 'delete' }, '7'],
    [{}, '7'],
    [{ decision: 'remove' }, '0'],
    [{ decision: 'remove' }, '7; drop'],
  ] as const) {
    const res = await decidePOST(request('POST', body), params({ reportId: id }), AUTH)
    assert.equal(res.status, 400, JSON.stringify(body) + id)
  }
  assert.equal(rpcs.length, 0)
})

test('an unknown report is a 404', async () => {
  rpcAnswers.decide_public_identity_report_as = { data: null, error: { code: 'P0002' } }
  const res = await decidePOST(request('POST', { decision: 'remove' }), params({ reportId: '404' }), AUTH)
  assert.equal(res.status, 404)
})

// ── The record: reset (item 5) and lock (item 6) ───────────────────────────────────────────

test('BR-USUARIO-051 item 6: the record reads the identity and the lock of the account, never cached', async () => {
  tableAnswers.profiles = () => ({
    data: { display_name: 'Ana', nickname: 'ana.souza', bio: null, display_name_reset_at: null, nickname_reset_at: '2026-11-08T12:00:00Z', bio_reset_at: null },
    error: null,
  })
  tableAnswers.public_identity_locks = () => ({ data: { locked_at: '2026-11-09T10:00:00Z' }, error: null })
  const res = await identityGET(request('GET'), params({ userId: ALICE }), AUTH)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Cache-Control'), 'no-store')
  const { identity } = (await res.json()) as { identity: import('@/lib/public-identity/moderation').AccountIdentity }
  assert.equal(identity.locked, true)
  assert.equal(identity.resetAt.nickname, '2026-11-08T12:00:00Z')
  assert.equal(identity.nickname, 'ana.souza')
  for (const call of tableCalls) assert.deepEqual(argsOf(call, 'eq'), [call.table === 'profiles' ? 'id' : 'user_id', ALICE])
})

test('an account without a profile is a 404 on the record', async () => {
  tableAnswers.profiles = () => ({ data: null, error: null })
  tableAnswers.public_identity_locks = () => ({ data: null, error: null })
  const res = await identityGET(request('GET'), params({ userId: ALICE }), AUTH)
  assert.equal(res.status, 404)
})

test('BR-USUARIO-051 item 6: locking and unlocking call the RPC with the curator as actor', async () => {
  for (const locked of [true, false]) {
    rpcs = []
    rpcAnswers.set_public_identity_lock_as = { data: { user_id: ALICE, locked }, error: null }
    const res = await identityPATCH(request('PATCH', { locked }), params({ userId: ALICE }), AUTH)
    assert.equal(res.status, 200)
    assert.deepEqual(rpcs, [{ schema: 'drive', fn: 'set_public_identity_lock_as', args: { p_user_id: ALICE, p_locked: locked, p_actor: ACTOR } }])
    assert.deepEqual(await res.json(), { locked })
  }
  assert.deepEqual(audits.map((a) => a.action), ['SET_PUBLIC_IDENTITY_LOCK', 'SET_PUBLIC_IDENTITY_LOCK'])
})

test('a lock without a boolean, or on a malformed account id, never reaches the database', async () => {
  assert.equal((await identityPATCH(request('PATCH', { locked: 'yes' }), params({ userId: ALICE }), AUTH)).status, 400)
  assert.equal((await identityPATCH(request('PATCH', { locked: true }), params({ userId: 'ana' }), AUTH)).status, 400)
  assert.equal(rpcs.length, 0)
})

test('BR-USUARIO-051 item 5: resetting a field calls the RPC with the curator, and neither value reaches the trail', async () => {
  rpcAnswers.reset_public_identity_as = { data: { field: 'display_name', value: 'ViajanteCurioso12', reports_closed: 2 }, error: null }
  const res = await resetPOST(request('POST', { field: 'display_name' }), params({ userId: ALICE }), AUTH)
  assert.equal(res.status, 200)
  assert.deepEqual(rpcs, [
    { schema: 'drive', fn: 'reset_public_identity_as', args: { p_user_id: ALICE, p_field: 'display_name', p_actor: ACTOR } },
  ])
  assert.deepEqual(((await res.json()) as { outcome: unknown }).outcome, { field: 'display_name', value: 'ViajanteCurioso12', reportsClosed: 2 })
  assert.equal(audits[0].action, 'RESET_PUBLIC_IDENTITY')
  assert.ok(!auditTrail().includes('ViajanteCurioso12'))
})

test('BR-USUARIO-051 item 5.c: a reset bio comes back empty', async () => {
  rpcAnswers.reset_public_identity_as = { data: { field: 'bio', value: null, reports_closed: 0 }, error: null }
  const res = await resetPOST(request('POST', { field: 'bio' }), params({ userId: ALICE }), AUTH)
  assert.deepEqual(((await res.json()) as { outcome: unknown }).outcome, { field: 'bio', value: null, reportsClosed: 0 })
})

test('a reset of a field outside the three never reaches the database; a missing profile is a 404', async () => {
  assert.equal((await resetPOST(request('POST', { field: 'email' }), params({ userId: ALICE }), AUTH)).status, 400)
  assert.equal(rpcs.length, 0)
  rpcAnswers.reset_public_identity_as = { data: null, error: { code: 'TGW19' } }
  assert.equal((await resetPOST(request('POST', { field: 'nickname' }), params({ userId: ALICE }), AUTH)).status, 404)
})

// ── The lists (BR-USUARIO-050 item 7, BR-USUARIO-051 items 1, 2 and 2.d) ───────────────────

test('BR-USUARIO-051 item 2: the lists come together, and the LDNOOBW arrives grouped by language with its commit', async () => {
  tableAnswers.reserved_public_names = () => ({
    data: [{ name: 'tuggi', name_key: 'tuggi', match: 'contains', applies_to_display_name: true }],
    error: null,
  })
  tableAnswers.text_filter_own_terms = () => ({
    data: [
      { id: 1, kind: 'blocked', term: 'Fuckboy', normalized: 'fuckboy' },
      { id: 2, kind: 'allowed', term: 'Cazzola', normalized: 'cazzola' },
    ],
    error: null,
  })
  const commit = '5faf2ba42d7b1c0977169ec3611df25a3c08eb13'
  tableAnswers.text_filter_ldnoobw_terms = () => ({
    data: [
      { language: 'en', term: 'aaa', source_commit: commit },
      { language: 'en', term: 'bbb', source_commit: commit },
      { language: 'pt', term: 'ccc', source_commit: commit },
    ],
    error: null,
    count: 3,
  })
  const res = await listsGET(request('GET'), params(), AUTH)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Cache-Control'), 'no-store')
  const lists = (await res.json()) as import('@/lib/public-identity/moderation').FilterLists
  assert.deepEqual(lists.reserved, [{ name: 'tuggi', nameKey: 'tuggi', match: 'contains', appliesToDisplayName: true }])
  assert.deepEqual(lists.own.map((t) => [t.kind, t.term]), [['blocked', 'Fuckboy'], ['allowed', 'Cazzola']])
  assert.deepEqual(lists.ldnoobw, { languages: [{ language: 'en', terms: ['aaa', 'bbb'] }, { language: 'pt', terms: ['ccc'] }], commits: [commit], total: 3 })
})

test('BR-USUARIO-051 item 2: the CMS never writes the LDNOOBW, only migrations do', () => {
  const service = readFileSync(resolve(ROOT, 'lib/services/public-identity-moderation-service.ts'), 'utf8')
  const uses = service.split("from('text_filter_ldnoobw_terms')").slice(1)
  assert.equal(uses.length, 1)
  assert.match(uses[0], /^\s*\.select\(/)
})

test('BR-USUARIO-050 item 7: a reserved name is added with the curator as author', async () => {
  tableAnswers.reserved_public_names = (call) => ({
    data: { name: 'concierge', name_key: 'concierge', match: 'exact', applies_to_display_name: false, ...((argsOf(call, 'insert')?.[0] as object) ?? {}) },
    error: null,
  })
  const res = await reservedPOST(request('POST', { name: ' concierge ' }), params(), AUTH)
  assert.equal(res.status, 201)
  const insert = tableCalls[0]
  assert.equal(insert.schema, 'drive')
  assert.deepEqual(argsOf(insert, 'insert'), [{ name: 'concierge', match: 'exact', applies_to_display_name: false, created_by: ACTOR }])
  assert.equal(audits[0].action, 'ADD_RESERVED_PUBLIC_NAME')
})

test('BR-USUARIO-050 item 7: a name outside the characters of an @ never reaches the database', async () => {
  for (const name of ['são.paulo', 'two words', 'x'.repeat(31), '...', '']) {
    const res = await reservedPOST(request('POST', { name }), params(), AUTH)
    assert.equal(res.status, 400, name)
  }
  assert.equal((await reservedPOST(request('POST', { name: 'ok', match: 'starts' }), params(), AUTH)).status, 400)
  assert.equal(tableCalls.length, 0)
})

test('BR-USUARIO-050 item 7: a name whose key is already reserved answers 409, not 503', async () => {
  tableAnswers.reserved_public_names = () => ({ data: null, error: { code: '23505' } })
  const res = await reservedPOST(request('POST', { name: 'Tug.gi' }), params(), AUTH)
  assert.equal(res.status, 409)
  assert.equal(audits.length, 0)
})

test('BR-USUARIO-050 item 7: removing a reserved name deletes by its key, and nothing deleted is a 404', async () => {
  tableAnswers.reserved_public_names = () => ({
    data: [{ name: 'studio', name_key: 'studio', match: 'exact', applies_to_display_name: false }],
    error: null,
  })
  const res = await reservedDELETE(request('DELETE', undefined, 'http://cms.test/api?key=studio'), params(), AUTH)
  assert.equal(res.status, 200)
  assert.ok(has(tableCalls[0], 'delete'))
  assert.deepEqual(argsOf(tableCalls[0], 'eq'), ['name_key', 'studio'])

  tableAnswers.reserved_public_names = () => ({ data: [], error: null })
  assert.equal((await reservedDELETE(request('DELETE', undefined, 'http://cms.test/api?key=studio'), params(), AUTH)).status, 404)
  assert.equal((await reservedDELETE(request('DELETE', undefined, 'http://cms.test/api?key=Stu.dio'), params(), AUTH)).status, 400)
  assert.equal(audits.length, 1)
})

test('BR-USUARIO-051 items 2 and 2.d: blocked and allowed terms are added trimmed, and the term stays out of the trail', async () => {
  for (const kind of ['blocked', 'allowed'] as const) {
    tableCalls = []
    tableAnswers.text_filter_own_terms = (call) => ({
      data: { id: 5, normalized: 'sobrenomex', ...((argsOf(call, 'insert')?.[0] as object) ?? {}) },
      error: null,
    })
    const res = await termsPOST(request('POST', { kind, term: '  Sobrenome X ' }), params(), AUTH)
    assert.equal(res.status, 201)
    assert.deepEqual(argsOf(tableCalls[0], 'insert'), [{ kind, term: 'Sobrenome X', created_by: ACTOR }])
  }
  assert.deepEqual(audits.map((a) => a.action), ['ADD_TEXT_FILTER_TERM', 'ADD_TEXT_FILTER_TERM'])
  assert.ok(!auditTrail().includes('Sobrenome'))
})

test('BR-USUARIO-051 item 2.a: a term the database normalizes to nothing is a 400, and one already there a 409', async () => {
  tableAnswers.text_filter_own_terms = () => ({ data: null, error: { code: '23514' } })
  assert.equal((await termsPOST(request('POST', { kind: 'blocked', term: '...' }), params(), AUTH)).status, 400)
  tableAnswers.text_filter_own_terms = () => ({ data: null, error: { code: '23505' } })
  assert.equal((await termsPOST(request('POST', { kind: 'blocked', term: 'F.u.c.k.b.o.y' }), params(), AUTH)).status, 409)
  assert.equal(audits.length, 0)
})

test('an own term outside the two kinds or the bounds never reaches the database', async () => {
  for (const body of [{ kind: 'reserved', term: 'x' }, { kind: 'blocked', term: '   ' }, { kind: 'allowed', term: 'x'.repeat(151) }]) {
    assert.equal((await termsPOST(request('POST', body), params(), AUTH)).status, 400, JSON.stringify(body))
  }
  assert.equal(tableCalls.length, 0)
})

test('removing an own term deletes by id, and nothing deleted is a 404', async () => {
  tableAnswers.text_filter_own_terms = () => ({ data: [{ id: 5, kind: 'allowed', term: 'Cazzola', normalized: 'cazzola' }], error: null })
  const res = await termsDELETE(request('DELETE', undefined, 'http://cms.test/api?id=5'), params(), AUTH)
  assert.equal(res.status, 200)
  assert.deepEqual(argsOf(tableCalls[0], 'eq'), ['id', 5])
  assert.ok(!auditTrail().includes('Cazzola'))

  tableAnswers.text_filter_own_terms = () => ({ data: [], error: null })
  assert.equal((await termsDELETE(request('DELETE', undefined, 'http://cms.test/api?id=5'), params(), AUTH)).status, 404)
  assert.equal((await termsDELETE(request('DELETE', undefined, 'http://cms.test/api?id=abc'), params(), AUTH)).status, 400)
})

test('publicNameKey is the key core.public_name_key computes: lower case, without . _ -', () => {
  assert.equal(moderation.publicNameKey('Joao_Silva.-'), 'joaosilva')
})

// ── What the curator reads ─────────────────────────────────────────────────────────────────

const pt = JSON.parse(readFileSync(resolve(ROOT, 'messages/pt.json'), 'utf8'))

function render(element: ReturnType<typeof createElement>, messages: Record<string, unknown>): string {
  return renderToStaticMarkup(
    // eslint-disable-next-line react/no-children-prop
    createElement(NextIntlClientProvider, { locale: 'pt', timeZone: 'America/Sao_Paulo', messages, children: element })
  )
}

test('BR-USUARIO-051 item 5: the queue shows the value, the field, where it was reported and how many times', () => {
  const reports = moderation.parseReportRows(REPORT_ROWS, { [ALICE]: 'Andarilho42' })!
  const html = render(
    createElement(IdentityReportsQueue, {
      reports,
      total: 2,
      status: 'ready',
      busyId: null,
      notice: null,
      onDecide: () => {},
      onRetry: () => {},
    }),
    { Pages: { PublicNames: { reports: pt.Pages.PublicNames.reports } } }
  )
  for (const text of ['xingamento.feio', 'Placar', 'Página do criador', '3 vezes', 'Andarilho42', 'Remover', 'Manter', '2 abertas']) {
    assert.ok(html.includes(text), text)
  }
})

test('BR-USUARIO-051 item 5.b: the confirmation of a removed @ says it is blocked forever', () => {
  assert.match(pt.Pages.PublicNames.reports.removeHint.nickname, /bloqueado para sempre/)
  assert.match(pt.Pages.AppUsers.public_identity.reset_hint.nickname, /bloqueado para sempre/)
})

test('BR-USUARIO-051 item 6: the record shows the lock checked and the date the moderation reset the @', () => {
  const html = render(
    createElement(PublicIdentityPanel, {
      userId: ALICE,
      identity: {
        displayName: 'Ana',
        nickname: 'ViajanteCurioso12',
        bio: null,
        resetAt: { display_name: null, nickname: '2026-11-08T12:00:00Z', bio: null },
        locked: true,
        lockedAt: '2026-11-09T10:00:00Z',
      },
      busy: false,
      error: null,
      done: null,
      onReset: () => {},
      onLock: () => {},
    }),
    { Pages: { AppUsers: { public_identity: pt.Pages.AppUsers.public_identity } } }
  )
  assert.match(html, /type="checkbox"[^>]*checked/)
  assert.ok(html.includes('Redefinido pela moderação em 08/11/2026'))
  assert.ok(html.includes('Travada desde 09/11/2026'))
  assert.ok(html.includes('ViajanteCurioso12'))
})

test('#1144: the new keys exist in the three CMS languages', () => {
  for (const locale of ['pt', 'en', 'es']) {
    const messages = JSON.parse(readFileSync(resolve(ROOT, `messages/${locale}.json`), 'utf8'))
    assert.ok(messages.Navigation.public_names, locale)
    assert.deepEqual(Object.keys(messages.Pages.PublicNames).sort(), Object.keys(pt.Pages.PublicNames).sort(), locale)
    assert.deepEqual(Object.keys(messages.Pages.AppUsers.public_identity).sort(), Object.keys(pt.Pages.AppUsers.public_identity).sort(), locale)
  }
})
