/**
 * The gate of the Studio pipeline (#872) — BR-B2B-057, item 3.
 *
 * The facts come from `partner.client_acceptance_gate` (contract `aceite-por-link.md` §6); here
 * the RPC is a stand-in, so the suite proves what the CMS does with each answer: which items it
 * names as missing, in which order, that a failed read refuses (fails closed), and that the card,
 * the drag and the server's refusal print one sentence.
 *
 * Also here, because they are the same card: the client approval reused by the portal (#872 item
 * 2, `ClientService.approveClient` retry-safe) and the delete that hits a foreign key (item 4).
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createTranslator } from 'next-intl'

import ptMessages from '@/messages/pt.json'
import { GATE_ITEMS, missingGateItems, readGateMissing } from '@/lib/partnerships/acceptance-gate'
import { gateLine } from '@/components/admin/clients/board/row-text'

const ROOT = resolve(__dirname, '../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

const CLIENT = '33333333-3333-4333-8333-333333333333'

// ── The stand-in of the database ─────────────────────────────────────────────────────────────

interface World {
  gateRows: Record<string, unknown>[]
  gateError: { code: string } | null
  rpcCalls: { name: string; args: Record<string, unknown> }[]
  client: Record<string, unknown>
  cmsUsers: { id: string; email: string; role: string }[]
  inserts: { table: string; values: Record<string, unknown> }[]
  updates: { table: string; values: Record<string, unknown> }[]
  ownerLinkError: { code: string } | null
}
let w: World

function reset(over: Partial<World> = {}) {
  w = {
    gateRows: [],
    gateError: null,
    rpcCalls: [],
    client: { id: CLIENT, status: 'pending', cms_user_id: null },
    cmsUsers: [],
    inserts: [],
    updates: [],
    ownerLinkError: null,
    ...over,
  }
}

function table(name: string) {
  let pendingInsert: Record<string, unknown> | null = null
  let pendingUpdate: Record<string, unknown> | null = null
  const filters: Record<string, unknown> = {}
  const q: any = {
    select: () => q,
    eq: (column: string, value: unknown) => ((filters[column] = value), q),
    insert: (rows: Record<string, unknown>[]) => {
      pendingInsert = rows[0]
      w.inserts.push({ table: name, values: rows[0] })
      return q
    },
    update: (values: Record<string, unknown>) => {
      pendingUpdate = values
      w.updates.push({ table: name, values })
      return q
    },
    single: async () => {
      if (name === 'clients') {
        if (pendingUpdate) Object.assign(w.client, pendingUpdate)
        return { data: { ...w.client }, error: null }
      }
      if (name === 'cms_users' && pendingInsert) {
        const email = pendingInsert.email as string
        if (w.cmsUsers.some((user) => user.email === email)) {
          return { data: null, error: { code: '23505', message: 'duplicate key' } }
        }
        const created = { id: `cms-${w.cmsUsers.length + 1}`, email, role: pendingInsert.role as string }
        w.cmsUsers.push(created)
        return { data: { id: created.id }, error: null }
      }
      if (name === 'cms_users') {
        const found = w.cmsUsers.find((user) => user.email === filters.email)
        return found ? { data: found, error: null } : { data: null, error: { code: 'PGRST116', message: 'none' } }
      }
      return { data: null, error: null }
    },
    then: (resolve: (value: unknown) => unknown) =>
      resolve(name === 'client_cms_users' ? { data: null, error: w.ownerLinkError } : { data: null, error: null }),
  }
  return q
}

const service = {
  schema: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      w.rpcCalls.push({ name, args })
      return w.gateError ? { data: null, error: w.gateError } : { data: w.gateRows, error: null }
    },
    from: (name: string) => table(name),
  }),
}

let gate: typeof import('@/lib/services/acceptance-gate-service')
let clients: typeof import('@/lib/services/client-service')

before(async () => {
  mock.module('@/lib/core/supabase-client', { namedExports: { getSupabaseService: () => service } })
  gate = await import('@/lib/services/acceptance-gate-service')
  clients = await import('@/lib/services/client-service')
})

beforeEach(() => reset())

// ── What is missing ──────────────────────────────────────────────────────────────────────────

test('BR-B2B-057 item 3: the missing items come in copy order — acceptance, partner code, slug', () => {
  assert.deepEqual(GATE_ITEMS, ['acceptance', 'partner_code', 'slug'])
  assert.deepEqual(
    missingGateItems({ slug: null, partnerCode: null, acceptedAt: null, acceptanceSource: null }),
    ['acceptance', 'partner_code', 'slug']
  )
  assert.deepEqual(
    missingGateItems({ slug: 'bar-do-ze', partnerCode: 'ZE4K', acceptedAt: null, acceptanceSource: null }),
    ['acceptance']
  )
  // BR-B2B-056, 1st edge case: a legacy contract already signed IS an acceptance.
  assert.deepEqual(
    missingGateItems({
      slug: 'bar-do-ze',
      partnerCode: 'ZE4K',
      acceptedAt: '2026-08-15T10:00:00Z',
      acceptanceSource: 'signed_contract',
    }),
    []
  )
  // A client the read did not return is closed (fails closed), never open.
  assert.deepEqual(missingGateItems(undefined), ['acceptance', 'partner_code', 'slug'])
  // A refusal body is read back keeping only the items this module knows.
  assert.deepEqual(readGateMissing(['slug', 'acceptance', 'other']), ['acceptance', 'slug'])
  assert.deepEqual(readGateMissing('acceptance'), [])
})

test('BR-B2B-057 item 3: one sentence for the card, the drag and the server refusal (spec #872 §2)', () => {
  const p = createTranslator({ locale: 'pt', messages: ptMessages, namespace: 'Partnerships' }) as never
  assert.equal(gateLine(['acceptance'], p), 'Falta o aceite.')
  assert.equal(gateLine(['acceptance', 'partner_code'], p), 'Faltam o aceite e o código do parceiro.')
  assert.equal(gateLine(['acceptance', 'partner_code', 'slug'], p), 'Faltam o aceite, o código do parceiro e o slug.')
})

// ── The read, with the RPC stood in ──────────────────────────────────────────────────────────

test('BR-B2B-057: the gate is ONE read of `client_acceptance_gate`, keyed by the clients asked', async () => {
  reset({
    gateRows: [
      { client_id: CLIENT, slug: 'bar-do-ze', partner_code: 'ZE4K', accepted_at: null, acceptance_source: null },
    ],
  })
  const facts = await gate.loadAcceptanceGate([CLIENT])
  assert.deepEqual(w.rpcCalls, [{ name: 'client_acceptance_gate', args: { p_client_ids: [CLIENT] } }])
  assert.deepEqual(facts?.get(CLIENT), { slug: 'bar-do-ze', partnerCode: 'ZE4K', acceptedAt: null, acceptanceSource: null })

  // Nobody asked, nobody read.
  w.rpcCalls = []
  assert.equal((await gate.loadAcceptanceGate([]))?.size, 0)
  assert.equal(w.rpcCalls.length, 0)
})

test('BR-B2B-057 item 3: the server check passes only with the three, and refuses with the list', async () => {
  reset({
    gateRows: [
      {
        client_id: CLIENT,
        slug: 'bar-do-ze',
        partner_code: 'ZE4K',
        accepted_at: '2026-10-06T12:00:00Z',
        acceptance_source: 'link',
      },
    ],
  })
  assert.deepEqual(await gate.checkAcceptanceGate(CLIENT), { ok: true })

  reset({
    gateRows: [{ client_id: CLIENT, slug: 'bar-do-ze', partner_code: null, accepted_at: null, acceptance_source: null }],
  })
  const refused = await gate.checkAcceptanceGate(CLIENT)
  assert.deepEqual(refused, { ok: false, httpStatus: 409, error: 'gate_missing', missing: ['acceptance', 'partner_code'] })
  assert.deepEqual(gate.gateRefusalBody(refused as never), { error: 'gate_missing', missing: ['acceptance', 'partner_code'] })
})

test('BR-B2B-057 item 3: a gate that cannot be read refuses — it never passes on an error', async () => {
  reset({ gateError: { code: '42883' } })
  assert.equal(await gate.loadAcceptanceGate([CLIENT]), null)
  assert.deepEqual(await gate.checkAcceptanceGate(CLIENT), { ok: false, httpStatus: 503, error: 'gate_lookup_failed' })

  // An unknown source is not an acceptance.
  reset({
    gateRows: [{ client_id: CLIENT, slug: 's', partner_code: 'C', accepted_at: '2026-10-06', acceptance_source: 'fax' }],
  })
  assert.equal((await gate.checkAcceptanceGate(CLIENT)).ok, false)
})

test('BR-B2B-057 item 3: creating and publishing a place ask the gate BEFORE writing; unpublishing does not', () => {
  const create = read('app/api/admin/partnerships/clients/[clientId]/places/route.ts')
  assert.ok(create.indexOf('checkAcceptanceGate(clientId)') > 0)
  assert.ok(create.indexOf('checkAcceptanceGate(clientId)') < create.indexOf('provisionPartnerPlace(clientId'))

  const publish = read('app/api/admin/partnerships/clients/[clientId]/places/[attractionId]/publish/route.ts')
  assert.match(publish, /if \(approved\) \{\s*const gate = await checkAcceptanceGate\(clientId\)/)
  assert.ok(publish.indexOf('checkAcceptanceGate(clientId)') < publish.indexOf('placeService.setApproved('))
})

// ── #872 item 2: the approval, reused and retry-safe ─────────────────────────────────────────

test('#872 · BR-MONETIZACAO-027: approving writes `approved`, creates the CMS user and links it as owner', async () => {
  const client = await clients.ClientService.approveClient(CLIENT, 'cms-op', 'dono@bardoze.com.br', 'Bar do Zé')
  assert.equal(client.status, 'approved')
  assert.deepEqual(w.cmsUsers, [{ id: 'cms-1', email: 'dono@bardoze.com.br', role: 'client' }])
  assert.equal(w.client.cms_user_id, 'cms-1')
  assert.equal(w.client.approved_by, 'cms-op')
  assert.deepEqual(
    w.inserts.filter((insert) => insert.table === 'client_cms_users').map((insert) => insert.values.client_role),
    ['owner']
  )
})

test('#872: an approved client is left as it is — a retry writes nothing', async () => {
  reset({ client: { id: CLIENT, status: 'approved', cms_user_id: 'cms-9' } })
  await clients.ClientService.approveClient(CLIENT, 'cms-op', 'dono@bardoze.com.br', 'Bar do Zé')
  assert.equal(w.inserts.length, 0)
  assert.equal(w.updates.length, 0)
})

test('#872: a retry after the CMS user was created reuses it; an owner link already there is the same state', async () => {
  reset({
    cmsUsers: [{ id: 'cms-7', email: 'dono@bardoze.com.br', role: 'client' }],
    ownerLinkError: { code: '23505' },
  })
  const client = await clients.ClientService.approveClient(CLIENT, 'cms-op', 'dono@bardoze.com.br', 'Bar do Zé')
  assert.equal(client.status, 'approved')
  assert.equal(w.client.cms_user_id, 'cms-7')
  assert.equal(w.cmsUsers.length, 1)
})

test('#872 security: an e-mail that belongs to staff is never linked to a partner', async () => {
  reset({ cmsUsers: [{ id: 'cms-admin', email: 'suporte@tuggi.app', role: 'admin' }] })
  await assert.rejects(
    clients.ClientService.approveClient(CLIENT, 'cms-op', 'suporte@tuggi.app', 'Bar do Zé'),
    /staff/
  )
  assert.equal(w.client.status, 'pending')
  assert.equal(w.client.cms_user_id, null)
})

// ── #872 item 4: the delete that hits a foreign key ──────────────────────────────────────────

test('#872: deleting a client something still points at answers 409 with one sentence, not the constraint', () => {
  const route = read('app/api/admin/clients/[clientId]/route.ts')
  assert.match(route, /if \(deleteError\.code === '23503'\) \{\s*return NextResponse\.json\(\{ error: CLIENT_IN_USE \}, \{ status: 409 \}\)/)
  assert.match(route, /const CLIENT_IN_USE =\s*'[^']+\.'/)
})
