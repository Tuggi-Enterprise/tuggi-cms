/**
 * The two doors of the signed contract — #342, the ressalvas of the security gate.
 *
 * 1. THE PDF ROUTE AND THE PAGE ANSWER THE SAME LINK THE SAME WAY. The page refused an
 *    expired, superseded or terminated token in words while `/api/contract/[token]/pdf`
 *    handed over the whole instrument — CNPJ, address, legal representative, fee. One
 *    document with two rulers is not a rule.
 *
 * 2. THE ARCHIVE OF THE ACCEPTANCE IS ELECTED BY THE DATABASE. Two requests for the same
 *    acceptance render two different files (the PDF carries a creation timestamp), and
 *    under the old code both wrote the same path and both updated the trail: the bucket
 *    kept one render and the trail named the other, so `Conferir integridade` answered
 *    `mismatch` forever on a signature nobody tampered with — and the columns are
 *    write-once, so it could not be repaired.
 *
 * The fake here is stricter than the one in `partner-contract.test.ts` on purpose: it
 * enforces `core.tg_partner_contract_acceptance_guard` (TGB17, write-once) and it renders
 * DIFFERENT bytes on every call, which is what production does and what the permissive
 * fake could not show.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import { hashSingleUseToken } from '@/lib/security/single-use-token'

const TOKEN = 'a'.repeat(43)
const CLIENT_ID = 'client-1'

// ── The fake database, with the guard the migration installs ───────────────────────────

interface Row {
  [column: string]: any
}

let contracts: Row[]
let acceptances: Row[]
/** `core.clients`, read only by the internal surface of section 3. */
let clients: Row[]
let objects: Map<string, Uint8Array>
let emails: Record<string, unknown>[]
/** Every set of bytes the renderer produced, in order. */
let renders: Uint8Array[]

const WRITE_ONCE = ['signed_document_hash', 'signed_document_path']

/** `core.tg_partner_contract_acceptance_guard()` — the only UPDATE it allows. */
function acceptanceGuard(before: Row, patch: Row): void {
  for (const column of Object.keys(patch)) {
    if (!WRITE_ONCE.includes(column)) {
      throw new Error('TGB17: the audit trail is immutable')
    }
    if (before[column] !== null && before[column] !== undefined && before[column] !== patch[column]) {
      throw new Error(`TGB17: ${column} is write-once`)
    }
  }
}

const TABLES: Record<string, () => Row[]> = {
  partner_contracts: () => contracts,
  partner_contract_acceptances: () => acceptances,
  clients: () => clients,
  // No proposal was promoted into this client, which is a truthful answer and the one the
  // checklist already knows how to render.
  partner_form_submissions: () => [],
}

function createFakeService() {
  const build = (tableName: string) => {
    const rows = () => (TABLES[tableName] ?? (() => []))()
    const filters: [string, unknown][] = []
    let operation: 'select' | 'update' | 'upsert' = 'select'
    let payload: Row = {}
    let ignoreDuplicates = false
    let conflictColumn = ''

    const matches = () => rows().filter((row) => filters.every(([column, value]) => row[column] === value))

    const apply = () => {
      if (operation === 'update') {
        const affected = matches()
        for (const row of affected) {
          if (tableName === 'partner_contract_acceptances') acceptanceGuard(row, payload)
          Object.assign(row, payload)
        }
        return affected
      }
      if (operation === 'upsert') {
        if (ignoreDuplicates && rows().some((row) => row[conflictColumn] === payload[conflictColumn])) {
          return []
        }
        const inserted = {
          id: `${tableName}-${rows().length + 1}`,
          created_at: new Date().toISOString(),
          accepted_at: new Date().toISOString(),
          signed_document_hash: null,
          signed_document_path: null,
          ...payload,
        }
        rows().push(inserted)
        return [inserted]
      }
      return matches()
    }

    const chain: any = {
      select: () => chain,
      order: () => chain,
      limit: () => chain,
      eq: (column: string, value: unknown) => {
        filters.push([column, value])
        return chain
      },
      neq: () => chain,
      is: (column: string, value: unknown) => {
        filters.push([column, value])
        return chain
      },
      update: (next: Row) => {
        operation = 'update'
        payload = next
        return chain
      },
      insert: (next: Row) => {
        operation = 'upsert'
        payload = next
        return chain
      },
      upsert: (next: Row, options: any) => {
        operation = 'upsert'
        payload = next
        ignoreDuplicates = Boolean(options?.ignoreDuplicates)
        conflictColumn = options?.onConflict ?? 'id'
        return chain
      },
      maybeSingle: async () => {
        try {
          return { data: apply()[0] ?? null, error: null }
        } catch (error) {
          return { data: null, error: { code: 'TGB17', message: String(error) } }
        }
      },
      single: async () => {
        try {
          const found = apply()
          return found[0] ? { data: found[0], error: null } : { data: null, error: { message: 'no rows' } }
        } catch (error) {
          return { data: null, error: { code: 'TGB17', message: String(error) } }
        }
      },
      then: (onFulfilled: (value: any) => unknown) => {
        let answer: any
        try {
          answer = { data: apply(), error: null }
        } catch (error) {
          answer = { data: null, error: { code: 'TGB17', message: String(error) } }
        }
        return Promise.resolve(answer).then(onFulfilled)
      },
    }
    return chain
  }

  return {
    schema: () => ({ from: (table: string) => build(table) }),
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Uint8Array) => {
          objects.set(path, bytes)
          return { error: null }
        },
        download: async (path: string) => {
          const bytes = objects.get(path)
          return bytes
            ? {
                data: {
                  arrayBuffer: async () =>
                    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
                },
                error: null,
              }
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

/** An authenticated CMS admin — what the internal surface of section 3 requires. */
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
    auth: { getUser: async () => ({ data: { user: { id: 'auth-1', email: 'admin@tuggi.app' } }, error: null }) },
    schema: () => ({ from: () => chain }),
  }
}

let service: typeof import('@/lib/services/partner-contract-service')
let GET: (req: Request, ctx: { params: Promise<{ token: string }> }) => Promise<Response>
let adminGET: (req: any, ctx: { params: Promise<{ clientId: string }> }) => Promise<Response>

before(async () => {
  mock.module('next/headers', {
    namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) },
  })

  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseService: () => createFakeService(),
      getSupabaseRouteHandler: () => createFakeAuthClient(),
      getSupabaseClient: () => ({}),
    },
  })

  // Rendering is NOT deterministic in production — the real renderer stamps a creation
  // time. Here every call is different by construction, which is the premise the archive
  // has to survive; the real pipeline is exercised in `partner-contract.test.ts`.
  mock.module('@/lib/contract/pdf', {
    namedExports: {
      renderContractPdf: async () => {
        const bytes = new TextEncoder().encode(`%PDF-fake-${renders.length}-${Math.random()}`)
        renders.push(bytes)
        return bytes
      },
    },
  })

  service = await import('@/lib/services/partner-contract-service')
  const route = await import('@/app/api/contract/[token]/pdf/route')
  GET = route.GET as any

  const adminRoute = await import('@/app/api/admin/clients/[clientId]/contract/route')
  adminGET = adminRoute.GET as any
})

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** A contract in the bucket and in the table, with the signing token pointing at it. */
function seedContract(overrides: Row = {}): Row {
  const bytes = new TextEncoder().encode('%PDF-generated')
  const documentHash = sha256(bytes)
  const path = `${CLIENT_ID}/${documentHash.slice(0, 16)}-contrato-v1-2026-08.pdf`
  objects.set(path, bytes)

  const contract: Row = {
    id: 'contract-1',
    client_id: CLIENT_ID,
    template_version: 'v1-2026-08',
    tier: 'paid',
    snapshot: { templateVersion: 'v1-2026-08', partner: { legalName: 'Cantina Ltda.' } },
    status: 'sent',
    token_hash: hashSingleUseToken(TOKEN),
    token_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    sent_at: new Date().toISOString(),
    sent_to_email: 'antonio@cantina.com.br',
    opened_at: null,
    document_path: path,
    document_hash: documentHash,
    signed_document_path: null,
    signed_document_hash: null,
    superseded_by: null,
    terminated_at: null,
    created_at: new Date().toISOString(),
    created_by: 'operator-1',
    ...overrides,
  }
  contracts.push(contract)
  return contract
}

beforeEach(() => {
  contracts = []
  acceptances = []
  clients = []
  objects = new Map()
  emails = []
  renders = []
})

let ipCounter = 0
function pdfRequest(token = TOKEN) {
  ipCounter += 1
  return {
    req: new Request(`http://localhost/api/contract/${token}/pdf`, {
      headers: { 'x-forwarded-for': `10.0.${ipCounter}.1` },
    }),
    ctx: { params: Promise.resolve({ token }) },
  }
}

// ── 1. The PDF route obeys the ruler the page obeys ────────────────────────────────────

test('canServeDocument is an allow-list: only an open or a signed link sees the document', () => {
  const states = ['invalid', 'expired', 'signed', 'superseded', 'terminated', 'open'] as const
  const served = states.filter((state) => service.canServeDocument(state))
  assert.deepEqual(served, ['signed', 'open'], 'a state added later must start closed')
})

test('an EXPIRED link downloads nothing — it used to hand over CNPJ, address and fee', async () => {
  seedContract({ token_expires_at: new Date(Date.now() - 1000).toISOString() })

  const { req, ctx } = pdfRequest()
  const res = await GET(req, ctx)

  assert.equal(res.status, 404)
  assert.equal(res.headers.get('content-type')?.includes('application/pdf'), false)
  assert.deepEqual(await res.json(), { state: 'expired' })
})

test('a SUPERSEDED link downloads nothing', async () => {
  seedContract({ status: 'superseded', superseded_by: 'contract-2' })

  const res = await GET(pdfRequest().req, pdfRequest().ctx)
  assert.equal(res.status, 404)
  assert.deepEqual(await res.json(), { state: 'superseded' })
})

test('a TERMINATED link downloads nothing — the worst of the three, the deal is over', async () => {
  seedContract({ status: 'terminated', terminated_at: new Date().toISOString() })

  const res = await GET(pdfRequest().req, pdfRequest().ctx)
  assert.equal(res.status, 404)
  assert.deepEqual(await res.json(), { state: 'terminated' })
})

test('a token that resolves to nothing is refused, and says only that', async () => {
  seedContract()

  const other = 'b'.repeat(43)
  const res = await GET(pdfRequest(other).req, pdfRequest(other).ctx)
  assert.equal(res.status, 404)
  assert.deepEqual(await res.json(), { state: 'invalid' })
})

test('an OPEN link still downloads the document it is being asked to accept', async () => {
  const contract = seedContract()

  const res = await GET(pdfRequest().req, pdfRequest().ctx)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/pdf')
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="contrato-tuggi.pdf"')
  assert.equal(sha256(new Uint8Array(await res.arrayBuffer())), contract.document_hash)
})

test('a SIGNED link downloads the archived copy, not the unsigned one', async () => {
  const contract = seedContract()
  const outcome = await service.acceptContract({
    contract: contract as any,
    signingToken: TOKEN,
    signerName: 'Antônio Silva',
    signerRole: 'Sócio',
    ipAddress: '203.0.113.7',
    userAgent: 'Mozilla/5.0 (iPhone)',
  })
  assert.equal(outcome.ok, true)

  const res = await GET(pdfRequest().req, pdfRequest().ctx)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="contrato-tuggi-assinado.pdf"')
  assert.equal(
    sha256(new Uint8Array(await res.arrayBuffer())),
    acceptances[0].signed_document_hash,
    'the bytes served are the ones the trail names'
  )
})

// ── 1b. BR-B2B-026 · #390 — the clock is read BEFORE the state, in every state ──────────
//
// The defect: `resolveSigningToken` answered `signed` before it ever looked at
// `token_expires_at`, so the link to an already-signed contract served the page and the PDF
// forever. The raw token lives in two e-mails for good, a commercial mailbox is shared and
// inherited, and the database guard (TGB17) refuses a new `token_hash` on a signed contract
// — the expiry is the ONLY thing that can ever close that link.

const EXPIRED = () => new Date(Date.now() - 1000).toISOString()

const SIGNATURE = {
  signingToken: TOKEN,
  signerName: 'Antônio Silva',
  signerRole: 'Sócio',
  ipAddress: '203.0.113.7',
  userAgent: 'Mozilla/5.0 (iPhone)',
}

test('BR-B2B-026 · #390: an expired token on a SIGNED contract is refused — the bug this suite missed', async () => {
  const contract = seedContract()
  await service.acceptContract({ contract: contract as any, ...SIGNATURE })
  assert.equal(contracts[0].status, 'signed', 'the contract really is signed')

  // The 14 days of SIGNING_TTL_DAYS run out on a link that has already been used.
  contracts[0].token_expires_at = EXPIRED()

  const resolved = await service.resolveSigningToken(TOKEN)
  assert.equal(resolved.state, 'expired', 'a signed link is not exempt from its own deadline')
  assert.equal(service.canServeDocument(resolved.state), false)

  const res = await GET(pdfRequest().req, pdfRequest().ctx)
  assert.equal(res.status, 404, 'and the PDF route says the same thing the page does')
  assert.equal(res.headers.get('content-type')?.includes('application/pdf'), false)
  assert.deepEqual(await res.json(), { state: 'expired' })
})

test('BR-B2B-026 · #390: the deadline outranks every state, not just `sent`', async () => {
  // `sent` is the only state that ever checked the clock; the other three answered their
  // state and returned. Each is seeded expired, and each has to answer `expired`.
  const cases: [string, Row][] = [
    ['sent', { status: 'sent' }],
    ['draft', { status: 'draft' }],
    ['superseded', { status: 'superseded', superseded_by: 'contract-2' }],
    ['terminated', { status: 'terminated', terminated_at: new Date().toISOString() }],
  ]

  for (const [label, overrides] of cases) {
    contracts = []
    acceptances = []
    seedContract({ ...overrides, token_expires_at: EXPIRED() })

    const resolved = await service.resolveSigningToken(TOKEN)
    assert.equal(resolved.state, 'expired', `a ${label} contract with a dead token answers expired`)
    assert.equal(service.canServeDocument(resolved.state), false, `and ${label} serves nothing`)
  }
})

test('BR-B2B-026 · #390: a LIVE token on a signed contract still serves the receipt', async () => {
  // The other half of the fix. Closing the expired link may not close the open one: the
  // signer is entitled to the copy of what they signed, inside the TTL.
  const contract = seedContract()
  await service.acceptContract({ contract: contract as any, ...SIGNATURE })

  const resolved = await service.resolveSigningToken(TOKEN)
  assert.equal(resolved.state, 'signed')
  assert.ok(resolved.acceptance, 'and the receipt comes with it')

  const res = await GET(pdfRequest().req, pdfRequest().ctx)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/pdf')
  assert.equal(
    sha256(new Uint8Array(await res.arrayBuffer())),
    acceptances[0].signed_document_hash,
    'the archived copy, still reachable by the person who signed it'
  )
})

test('BR-B2B-026 · #390: a contract that was never sent has no deadline to miss', async () => {
  // `token_expires_at` is null on a draft — no link was ever minted. The clock must not turn
  // that into `expired`; the state ladder refuses it, as it always did.
  seedContract({ status: 'draft', token_expires_at: null })

  const resolved = await service.resolveSigningToken(TOKEN)
  assert.equal(resolved.state, 'invalid')
})

// ── 2. The archive survives two people signing at the same time ────────────────────────

test('two simultaneous acceptances leave ONE acceptance whose file and hash are the same pair', async () => {
  const contract = seedContract()

  const [first, second] = await Promise.all([
    service.acceptContract({ contract: contract as any, ...SIGNATURE }),
    service.acceptContract({ contract: contract as any, ...SIGNATURE, ipAddress: '198.51.100.9' }),
  ])

  // Nobody who signed for real is told the write failed. Under the old code the loser of
  // the race hit the write-once guard and answered 503 `accept_failed`.
  assert.equal(first.ok, true, 'the first request answers the signer')
  assert.equal(second.ok, true, 'and so does the second — both are the same signature')

  assert.equal(acceptances.length, 1, 'one acceptance, as `contract_id` UNIQUE requires')
  const trail = acceptances[0]

  assert.ok(renders.length >= 2, 'both requests really did render, which is the whole hazard')
  assert.notEqual(sha256(renders[0]), sha256(renders[1]), 'and the two renders really are different files')

  const stored = objects.get(trail.signed_document_path)
  assert.ok(stored, 'the trail names a file that exists')
  assert.equal(
    sha256(stored!),
    trail.signed_document_hash,
    'the archived bytes and the recorded hash have to be the same pair, forever'
  )

  const integrity = await service.verifyStoredDocument(trail.signed_document_path, trail.signed_document_hash)
  assert.equal(integrity.state, 'match', '`Conferir integridade` may never accuse a legitimate acceptance')
})

test('the loser of the race cannot overwrite the archive — the path carries the hash', async () => {
  const contract = seedContract()

  await Promise.all([
    service.acceptContract({ contract: contract as any, ...SIGNATURE }),
    service.acceptContract({ contract: contract as any, ...SIGNATURE }),
  ])

  const trail = acceptances[0]
  assert.match(trail.signed_document_path, new RegExp(`^${CLIENT_ID}/${contract.id}-assinado-[0-9a-f]{16}\\.pdf$`))
  assert.ok(
    trail.signed_document_path.includes(trail.signed_document_hash.slice(0, 16)),
    'the name of the archive is derived from its own hash, so no second render shares it'
  )

  // The loser's bytes stay in the bucket, unnamed by any row — declared residue, and the
  // reason it is acceptable is that the alternative is a trail that lies.
  const named = new Set([contract.document_path, trail.signed_document_path])
  const orphans = [...objects.keys()].filter((key) => !named.has(key))
  assert.equal(orphans.length, 1)
  assert.notEqual(sha256(objects.get(orphans[0])!), trail.signed_document_hash)
})

test('two simultaneous acceptances send ONE signed copy, and the trail keeps the first signer', async () => {
  const contract = seedContract()

  await Promise.all([
    service.acceptContract({ contract: contract as any, ...SIGNATURE }),
    service.acceptContract({ contract: contract as any, ...SIGNATURE, signerName: 'Outra Pessoa' }),
  ])

  assert.equal(emails.filter((body) => body.type === 'partner_contract_signed').length, 1)
  assert.equal(acceptances[0].signer_name, 'Antônio Silva')
})

test('the contract is closed once, and it names the same file the trail does', async () => {
  const contract = seedContract()

  await Promise.all([
    service.acceptContract({ contract: contract as any, ...SIGNATURE }),
    service.acceptContract({ contract: contract as any, ...SIGNATURE }),
  ])

  assert.equal(contracts[0].status, 'signed')
  assert.equal(contracts[0].signed_document_path, acceptances[0].signed_document_path)
  assert.equal(contracts[0].signed_document_hash, acceptances[0].signed_document_hash)
})

// ── 3. #390 — what left the partner's PDF did NOT leave the operator's surface ──────────
//
// The other half of taking the IP and the user agent out of `lib/contract/pdf.tsx`. If they
// vanished from the internal route too, the fix would have deleted the trail instead of
// narrowing its audience, and nothing would be left to answer "who accepted this, from
// where" — the acceptance row exists precisely to be read.

function adminRequest(clientId: string) {
  const url = `http://localhost/api/admin/clients/${clientId}/contract`
  const base = new Request(url, { headers: { 'x-forwarded-for': '10.9.9.9' } })
  // `withAuth` hands the handler a NextRequest; the only member this route reaches for
  // beyond the standard Request is `nextUrl`.
  return Object.assign(base, { nextUrl: new URL(url) }) as any
}

test('#390: the operator surface still answers with the IP and the user agent of the signer', async () => {
  clients.push({
    id: CLIENT_ID,
    name: 'Cantina do Zé',
    company_name: 'Cantina Ltda.',
    email: 'antonio@cantina.com.br',
    billing_email: null,
    tax_id: '11222333000181',
    tax_id_type: 'cnpj',
    legal_representative_name: 'Antônio Silva',
    legal_representative_role: 'Sócio',
    monthly_fee_cents: 19900,
    is_courtesy: false,
    is_platform_owner: false,
  })

  const contract = seedContract()
  const accepted = await service.acceptContract({ contract: contract as any, ...SIGNATURE })
  assert.equal(accepted.ok, true)

  const res = await adminGET(adminRequest(CLIENT_ID), { params: Promise.resolve({ clientId: CLIENT_ID }) })
  assert.equal(res.status, 200)

  const payload = (await res.json()) as any
  assert.equal(payload.acceptance.ipAddress, SIGNATURE.ipAddress, 'the trail the operator reads still has the IP')
  assert.equal(payload.acceptance.userAgent, SIGNATURE.userAgent, 'and the user agent')
  assert.equal(payload.acceptance.signerName, SIGNATURE.signerName)
  assert.equal(payload.acceptance.documentHash, contract.document_hash)
})

test('a retry after the archive landed re-renders nothing and re-uploads nothing', async () => {
  const contract = seedContract()

  await service.acceptContract({ contract: contract as any, ...SIGNATURE })
  const rendersAfterFirst = renders.length
  const objectsAfterFirst = objects.size

  const retry = await service.acceptContract({ contract: contract as any, ...SIGNATURE })

  assert.equal(retry.ok, true)
  assert.equal(retry.ok && retry.alreadyAccepted, true)
  assert.equal(renders.length, rendersAfterFirst, 'the archive exists; there is nothing to render')
  assert.equal(objects.size, objectsAfterFirst)
})
