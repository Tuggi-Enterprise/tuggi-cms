/**
 * "Parceria aprovada em {date} por {person}" — #909.
 *
 * THE DEFECT. The name came only from the proposal's promoter, so a client created directly in
 * the CMS (Reserve ON, 2026-10-07) read `Parceria aprovada em 07/10/2026.` although
 * `approveClient` had written `partner.clients.approved_by`. And the trail never named anybody,
 * even on the form path: two sentences for one act.
 *
 * Mutations that turn this suite red:
 *  · dropping the `clients.approved_by` fallback in `loadPartnershipDetail`;
 *  · preferring `approved_by` over the promoter when the client came from the form;
 *  · going back to a literal `t('detail.clientApproved…')` in band 3 or in the trail.
 *
 * Run with: npm run test:api
 */

import { before, test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CLIENT_ID = '90990990-9099-4099-8099-909909909909'
const PROMOTER = '11111111-1111-4111-8111-111111111111'
const APPROVER = '22222222-2222-4222-8222-222222222222'
const EMAILS: Record<string, string> = {
  [PROMOTER]: 'promotor@tuggi.app',
  [APPROVER]: 'aprovador@tuggi.app',
}

let tables: Record<string, Record<string, any>[]> = {}

/** Every table the detail reads answers from `tables`; an absent one is an empty read. */
function fakeDb() {
  function build(table: string) {
    const filters: [string, any][] = []
    const rows = () =>
      (tables[table] ?? []).filter((row) =>
        filters.every(([column, value]) =>
          Array.isArray(value) ? value.includes(row[column]) : row[column] === value
        )
      )
    const chain: any = {
      select: () => chain,
      eq: (column: string, value: any) => (filters.push([column, value]), chain),
      in: (column: string, value: any[]) => (filters.push([column, value]), chain),
      is: () => chain,
      not: () => chain,
      or: () => chain,
      order: () => chain,
      limit: () => chain,
      range: () => chain,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (value: any) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
    }
    return chain
  }
  const db: any = {
    schema: () => db,
    from: build,
    rpc: async () => ({ data: [], error: null }),
    auth: {
      admin: {
        getUserById: async (id: string) =>
          EMAILS[id]
            ? { data: { user: { email: EMAILS[id] } }, error: null }
            : { data: { user: null }, error: { message: 'not found' } },
      },
    },
  }
  return db
}

let loadPartnershipDetail: typeof import('@/lib/services/partnership-service')['loadPartnershipDetail']
let clientApprovedText: typeof import('@/components/admin/partnerships/approval-text')['clientApprovedText']

before(async () => {
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseService: () => fakeDb(),
      getSupabase: () => fakeDb(),
      getSupabaseClient: () => fakeDb(),
    },
  })
  ;({ loadPartnershipDetail } = await import('@/lib/services/partnership-service'))
  ;({ clientApprovedText } = await import('@/components/admin/partnerships/approval-text'))
})

function client(approvedBy: string | null) {
  return {
    id: CLIENT_ID,
    name: 'Reserve ON',
    status: 'approved',
    approved_at: '2026-10-07T13:00:00.000Z',
    approved_by: approvedBy,
    created_at: '2026-10-07T12:00:00.000Z',
  }
}

test('#909 · client created directly: the approver comes from `clients.approved_by`', async () => {
  tables = { clients: [client(APPROVER)] }
  const detail = await loadPartnershipDetail(CLIENT_ID, fakeDb())
  assert.equal(detail?.approvedByLabel, 'aprovador@tuggi.app')
})

test('#909 · client from the form: the promoter of the proposal names the approval', async () => {
  tables = {
    clients: [client(APPROVER)],
    partner_form_submissions: [
      { id: 'sub-1', status: 'promoted', promoted_client_id: CLIENT_ID, promoted_by: PROMOTER },
    ],
  }
  const detail = await loadPartnershipDetail(CLIENT_ID, fakeDb())
  assert.equal(detail?.approvedByLabel, 'promotor@tuggi.app')
})

test('#909 · no resolvable approver keeps the sentence, without a name', async () => {
  tables = { clients: [client(null)] }
  const detail = await loadPartnershipDetail(CLIENT_ID, fakeDb())
  assert.equal(detail?.approvedByLabel, null)
})

test('#909 · one sentence: with a name it is `clientApprovedBy`, without it `clientApproved`', () => {
  const t = ((key: string, values: Record<string, string>) => `${key}|${values.date}|${values.person ?? ''}`) as any
  assert.equal(
    clientApprovedText('2026-10-07T13:00:00.000Z', 'aprovador@tuggi.app', t),
    'detail.clientApprovedBy|07/10/2026|aprovador@tuggi.app'
  )
  assert.equal(clientApprovedText('2026-10-07T13:00:00.000Z', null, t), 'detail.clientApproved|07/10/2026|')
})

test('#909 · band 3 and the trail both print the approval through `clientApprovedText`', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../../components/admin/partnerships/PartnershipDetail.tsx'),
    'utf8'
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  assert.equal(source.match(/clientApprovedText\(/g)?.length, 2)
  assert.equal(source.indexOf("'detail.clientApproved"), -1)
})
