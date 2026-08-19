/**
 * Two vocabularies for `partner.clients.client_type` — #357.
 *
 * The database ACCEPTS seven values; BR-B2B-020, item 8, OFFERS four to a registration that is
 * being born. Everything here is red when the two are collapsed back into one, in either
 * direction, and each direction is a defect that shipped or would ship:
 *  · a value the database accepts that the CMS type does not know (`driver`, written by the
 *    published app, which has no OTA);
 *  · the merchant type not existing at all (`venue`, BR-B2B-020, item 5);
 *  · a registration born with a type the rule no longer offers (`business`, the default until
 *    2026-08-16);
 *  · a legacy value refused on READING, which breaks the screen of the 10 `business` rows and
 *    of every `hotel` row the published app keeps writing (item 9);
 *  · a type with no label, which is how a `<select>` renders a raw identifier at an operator;
 *  · the default declared in more than one place, which is how two of them drift.
 *
 * Run with: npm run test:api
 */

import { test, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  CLIENT_TYPES,
  DEFAULT_CLIENT_TYPE,
  REGISTRABLE_CLIENT_TYPES,
  isClientType,
  isRegistrableClientType,
} from '@/types/clients'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

/**
 * `clients_client_type_check` as measured on the live database on 2026-08-16, after the
 * migration `20260816150000_issue357_client_type_aceita_venue`:
 *
 *   CHECK ((client_type = ANY (ARRAY['business','influencer','hotel','partner','creator',
 *                                    'driver','venue'])))
 *
 * Written out here instead of imported from the production module on purpose: a mirror
 * compared against itself proves nothing. With the constraint on this side, dropping a value
 * from `CLIENT_TYPES` — or adding one the CHECK does not accept — is red.
 */
const CHECK_CONSTRAINT_VALUES = [
  'business',
  'influencer',
  'hotel',
  'partner',
  'creator',
  'driver',
  'venue',
]

/** BR-B2B-020, item 8: out of the offer, still accepted by the database, never reclassified. */
const LEGACY_CLIENT_TYPES = ['business', 'partner', 'hotel']

test('BR-B2B-020: the CMS vocabulary is exactly the CHECK the database enforces', () => {
  assert.deepEqual([...CLIENT_TYPES], CHECK_CONSTRAINT_VALUES)
})

test('BR-B2B-020: `venue`, the merchant type, exists', () => {
  // Item 5, declared by the operator on 2026-08-14 — *"será tipo locais"*. The establishment
  // enters as a type of its own and NOT as `business`, `partner` or `hotel`.
  assert.equal(isClientType('venue'), true)
  assert.equal(isClientType('locais'), false, 'the label is Portuguese, the identifier is not')
})

test('#357: `driver` is known, because the published app already writes it', () => {
  // `drive.register_partner_v1` stores it, and the app has no OTA: a type that refuses a value
  // in the database is the type that is wrong. The badge screens render the raw column.
  assert.equal(isClientType('driver'), true)
})

test('#357: a value outside the CHECK is refused before it reaches the database', () => {
  for (const value of ['', 'venues', 'Business', 'restaurant', null, undefined, 7, {}]) {
    assert.equal(isClientType(value), false, `${String(value)} should not be a client type`)
  }
})

// ── Direction 1: what a registration being born may choose (BR-B2B-020, item 8) ──────────────

test('BR-B2B-020: a new registration is offered exactly four types', () => {
  assert.deepEqual([...REGISTRABLE_CLIENT_TYPES], ['venue', 'driver', 'influencer', 'creator'])
})

test('BR-B2B-020: every offered type is one the database accepts', () => {
  // The offer is a SUBSET of the CHECK. A value offered that the CHECK refuses is a 500 with a
  // constraint name in front of the operator.
  for (const type of REGISTRABLE_CLIENT_TYPES) {
    assert.equal(isClientType(type), true, `${type} is offered but the CHECK does not accept it`)
  }
})

test('BR-B2B-020: no new registration can be born `business`, `partner` or `hotel`', () => {
  // There is no "other" value: whoever does not fit the four is a NEW value, decided and
  // written into the rule before being stored — never one of these three as an escape hatch.
  for (const type of LEGACY_CLIENT_TYPES) {
    assert.equal(isRegistrableClientType(type), false, `${type} left the offer on 2026-08-16`)
  }
})

test('BR-B2B-020: the default of a new registration is a type the rule still offers', () => {
  // It was `business` until 2026-08-16 — a registration born with a type nobody may choose.
  // `venue` is what the promotion (`PROMOTED_CLIENT_TYPE`) and the manual registration both
  // mean by "merchant with an address".
  assert.equal(DEFAULT_CLIENT_TYPE, 'venue')
  assert.equal(isRegistrableClientType(DEFAULT_CLIENT_TYPE), true)
})

// ── Direction 2: what goes on being read, displayed and badged (BR-B2B-020, itens 8 e 9) ─────

test('BR-B2B-020: the three types out of the offer stay valid for reading', () => {
  // The 10 `business` rows are not a defect, do not migrate, and nobody deduces what their
  // "right" type would be. Refusing them on the reading side breaks the screen that shows them.
  for (const type of LEGACY_CLIENT_TYPES) {
    assert.equal(isClientType(type), true, `${type} is still accepted by clients_client_type_check`)
  }
})

test('BR-B2B-020: `hotel` from the published app is valid, not an error', () => {
  // Item 9: `PartnerRegistrationScreen` (`PARTNER_TYPES`) offers `driver | hotel | influencer |
  // creator`, and there is no OTA (BR-OPERACAO-002). A row born there means the same as `venue`
  // and is never reclassified — the CMS reads it, shows it, and does not call it invalid.
  assert.equal(isClientType('hotel'), true)
  assert.equal(isRegistrableClientType('hotel'), false, 'valid in the database, out of the offer')
})

test('BR-B2B-020: every client type has a label in the three locales', () => {
  // The `<select>` and the read-only field of `ProfileTab` render `clientTypes.<value>` for
  // whatever the client IS, not for what is offered — a legacy row with no label puts the raw
  // identifier in front of the operator, and that is exactly what `driver` did before #357.
  for (const locale of ['pt', 'en', 'es']) {
    const messages = JSON.parse(
      readFileSync(join(REPO_ROOT, 'messages', `${locale}.json`), 'utf8')
    )
    const labels = messages?.Clients?.profile?.clientTypes ?? {}
    for (const type of CLIENT_TYPES) {
      assert.equal(
        typeof labels[type] === 'string' && labels[type].length > 0,
        true,
        `messages/${locale}.json is missing Clients.profile.clientTypes.${type}`
      )
    }
  }
})

// ── SSOT: the two sets are declared once (CLAUDE.md §6) ──────────────────────────────────────
//
// The default used to be typed out at four call sites — `app/api/admin/clients/route.ts` (POST),
// `app/api/coordinator/children/route.ts`, `ClientEditorModal` and `CoordinatorChildModal` —
// plus a fifth copy of the value LIST inside `ProfileTab`. Four declarations of one decision
// is not four bugs today; it is the guarantee that a fifth reader will find a stale one.

const SOURCE_DIRS = ['app', 'components', 'lib']
const SOURCE_EXTENSIONS = ['.ts', '.tsx']

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...sourceFiles(full))
    else if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) found.push(full)
  }
  return found
}

test('#357: no source file re-declares the client_type default', () => {
  // Both the old value and the new one: a leftover `'business'` is a call site that never
  // followed the rule change, and a fresh `'venue'` is the same decision declared twice.
  const literal = /client_type\s*:\s*['"](business|venue)['"]/
  const offenders: string[] = []

  for (const dir of SOURCE_DIRS) {
    for (const file of sourceFiles(join(REPO_ROOT, dir))) {
      if (literal.test(readFileSync(file, 'utf8'))) offenders.push(file.slice(REPO_ROOT.length + 1))
    }
  }

  assert.deepEqual(offenders, [], 'the default lives in types/clients.ts and is read from there')
})

test('BR-B2B-020: the client editor offers the four, not the seven', () => {
  // `\bCLIENT_TYPES\b` does not match inside `REGISTRABLE_CLIENT_TYPES` (the `_` is a word
  // character), so this is red exactly when the `<select>` goes back to mapping the accepted
  // vocabulary — which would offer `business` and `partner` to a registration being born.
  const source = readFileSync(
    join(REPO_ROOT, 'components/admin/clients/tabs/ProfileTab.tsx'),
    'utf8'
  )

  assert.match(source, /REGISTRABLE_CLIENT_TYPES/)
  assert.equal(/\bCLIENT_TYPES\b/.test(source), false, 'the accepted set is not the offer')
})

// ── The route: the only barrier left, since it holds `service_role` ───────────────────────────

const ADMIN_EMAIL = 'admin@tuggi.app'

interface FakeService {
  client: any
  /** Payload handed to .insert(), i.e. what would reach partner.clients. */
  lastInsert: Record<string, any> | null
}

function createFakeService(): FakeService {
  const state: FakeService = { client: null, lastInsert: null }

  const builder = () => {
    const chain: any = {
      insert: (rows: Record<string, any>[]) => {
        state.lastInsert = rows[0]
        return chain
      },
      select: () => chain,
      eq: () => chain,
      single: async () => ({ data: { id: 'client-1', ...state.lastInsert }, error: null }),
    }
    return chain
  }

  state.client = { schema: () => ({ from: () => builder() }) }
  return state
}

function createFakeAuthClient() {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({ data: { id: 'cms-user-1', role: 'admin', is_active: true }, error: null }),
  }

  return {
    auth: {
      getSession: async () => ({ data: { session: { user: { email: ADMIN_EMAIL } } }, error: null }),
    },
    schema: () => ({ from: () => chain }),
  }
}

let service: FakeService
let POST: (request: any) => Promise<Response>

before(async () => {
  mock.module('next/headers', {
    namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) },
  })

  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => createFakeAuthClient(),
      getSupabaseService: () => service.client,
    },
  })

  const route = await import('@/app/api/admin/clients/route')
  POST = route.POST
})

function createClientRequest(body: Record<string, unknown>) {
  service = createFakeService()

  return POST(new Request('http://localhost/api/admin/clients', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Pousada do Farol', email: 'contato@pousadadofarol.com', ...body }),
  }) as any)
}

test('BR-B2B-020: POST /api/admin/clients refuses a type that left the offer', async () => {
  for (const client_type of LEGACY_CLIENT_TYPES) {
    const response = await createClientRequest({ client_type })

    assert.equal(response.status, 400, `${client_type} must not start a registration`)
    assert.equal(service.lastInsert, null, 'nothing reaches partner.clients')
  }
})

test('BR-B2B-020: POST /api/admin/clients accepts the four the rule offers', async () => {
  for (const client_type of REGISTRABLE_CLIENT_TYPES) {
    const response = await createClientRequest({ client_type })

    assert.equal(response.status, 201, `${client_type} is offered by item 8`)
    assert.equal(service.lastInsert?.client_type, client_type)
  }
})

test('BR-B2B-020: a client created with no type is born `venue`', async () => {
  // `client_type` is NOT NULL in the database and its column default is still `business`; the
  // route never lets the column answer, so the type of a new row is the rule's, not the DDL's.
  const response = await createClientRequest({})

  assert.equal(response.status, 201)
  assert.equal(service.lastInsert?.client_type, DEFAULT_CLIENT_TYPE)
  assert.equal(service.lastInsert?.client_type, 'venue')
})
