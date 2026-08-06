/**
 * #174 — `lib/services/notification-service.ts` must address the `core` schema.
 *
 * The six notification RPCs live in `core`. The browser client is built without
 * `db.schema`, so supabase-js falls back to its own default and every unqualified
 * `.rpc()` goes out with `Content-Profile: public`: `create/update/delete_notification_template`
 * answered PGRST202 in production (the template screen could read but never write),
 * and the three read RPCs only worked through `SELECT core.<same_name>(...)` wrappers
 * that exist in `public` — the last thing in the CMS holding `public` on the exposed
 * API surface (blocks #173).
 *
 * The assertion is made on the wire, not on the call: a local HTTP server stands in
 * for PostgREST and only answers requests carrying `Content-Profile: core`, exactly
 * like a database whose functions live in `core` and nowhere else. Any call that loses
 * the schema gets the same PGRST202 production was returning. The last test is the
 * anti-vacuity control: it fires an unqualified RPC through the same client and proves
 * the server really does reject it, so the six green ones mean something.
 *
 * Run with: npm run test:api
 */

import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SCHEMA = 'core'
const TEMPLATE_ID = '3f1a0c7e-8f2b-4c31-9a5d-0b6e2f4d8a91'

interface RecordedRequest {
  method: string
  /** e.g. `/rest/v1/rpc/get_notification_templates` */
  path: string
  /** The PostgREST schema switch header for writes; undefined means "default schema". */
  contentProfile?: string
  acceptProfile?: string
  body: unknown
}

/** Return bodies keyed by function name, as `core.<name>` would answer. */
const RPC_RESULTS: Record<string, unknown> = {
  estimate_notification_audience: 42,
  get_notification_templates: [
    {
      id: TEMPLATE_ID,
      name: 'boas-vindas',
      title: 'Bem-vindo',
      body: 'Sua primeira escuta é por nossa conta',
      is_active: true,
      created_at: '2026-08-01T12:00:00Z',
    },
  ],
  create_notification_template: { id: TEMPLATE_ID, name: 'boas-vindas' },
  update_notification_template: { id: TEMPLATE_ID, name: 'boas-vindas-v2' },
  delete_notification_template: null,
  get_notification_logs: [{ id: 'log-1', type: 'broadcast', status: 'sent' }],
}

let server: Server
let baseUrl: string
let requests: RecordedRequest[] = []
let client: SupabaseClient
let NotificationService: typeof import('@/lib/services/notification-service')['NotificationService']

/**
 * Stand-in for PostgREST with the notification functions only in `core`.
 * Mirrors the real error: no/other schema profile -> 404 PGRST202.
 */
function startFakePostgrest(): Promise<void> {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const contentProfile = req.headers['content-profile'] as string | undefined
      const acceptProfile = req.headers['accept-profile'] as string | undefined
      const fn = url.pathname.replace('/rest/v1/rpc/', '')

      requests.push({
        method: req.method ?? '',
        path: url.pathname,
        contentProfile,
        acceptProfile,
        body: raw ? JSON.parse(raw) : null,
      })

      const profile = contentProfile ?? acceptProfile
      res.setHeader('Content-Type', 'application/json')

      if (profile !== SCHEMA) {
        res.statusCode = 404
        res.end(
          JSON.stringify({
            code: 'PGRST202',
            details: null,
            hint: null,
            message: `Could not find the function ${profile ?? 'public'}.${fn} in the schema cache`,
          })
        )
        return
      }

      res.statusCode = 200
      res.end(JSON.stringify(RPC_RESULTS[fn] ?? null))
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
      resolve()
    })
  })
}

before(async () => {
  await startFakePostgrest()

  // A real supabase-js client, so the schema switch is exercised end to end: only
  // `.schema('core')` makes postgrest-js emit `Content-Profile`.
  client = createClient(baseUrl, 'test-publishable-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const { mock } = await import('node:test')
  mock.module('@/lib/core/supabase-client', {
    namedExports: { getSupabaseClient: () => client },
  })

  NotificationService = (await import('@/lib/services/notification-service')).NotificationService
})

after(() => server.close())

beforeEach(() => {
  requests = []
})

function onlyRequest(): RecordedRequest {
  assert.equal(requests.length, 1, 'expected exactly one PostgREST request')
  return requests[0]
}

test('estimateAudience calls core.estimate_notification_audience', async () => {
  const total = await NotificationService.estimateAudience({ countries: ['BR'] } as any)

  const request = onlyRequest()
  assert.equal(request.path, '/rest/v1/rpc/estimate_notification_audience')
  assert.equal(request.contentProfile, SCHEMA, 'the audience estimate must not resolve in public')
  assert.equal(total, 42)
})

test('getTemplates calls core.get_notification_templates', async () => {
  const templates = await NotificationService.getTemplates()

  const request = onlyRequest()
  assert.equal(request.path, '/rest/v1/rpc/get_notification_templates')
  assert.equal(request.contentProfile, SCHEMA)
  assert.equal(templates[0].name, 'boas-vindas')
})

test('getLogs calls core.get_notification_logs', async () => {
  const logs = await NotificationService.getLogs()

  const request = onlyRequest()
  assert.equal(request.path, '/rest/v1/rpc/get_notification_logs')
  assert.equal(request.contentProfile, SCHEMA)
  assert.equal(request.body && (request.body as any).p_limit, 50)
  assert.equal(logs.length, 1)
})

// The three below were answering 404 in production: `public` never had these functions,
// not even a wrapper.

test('createTemplate reaches core.create_notification_template instead of 404', async () => {
  const created = await NotificationService.createTemplate({
    name: 'boas-vindas',
    title: 'Bem-vindo',
    body: 'Sua primeira escuta é por nossa conta',
    is_active: true,
  } as any)

  const request = onlyRequest()
  assert.equal(request.path, '/rest/v1/rpc/create_notification_template')
  assert.equal(request.contentProfile, SCHEMA)
  assert.equal((created as any).id, TEMPLATE_ID)
})

test('updateTemplate reaches core.update_notification_template instead of 404', async () => {
  const updated = await NotificationService.updateTemplate(TEMPLATE_ID, { title: 'Bem-vindo!' })

  const request = onlyRequest()
  assert.equal(request.path, '/rest/v1/rpc/update_notification_template')
  assert.equal(request.contentProfile, SCHEMA)
  assert.equal((request.body as any).p_id, TEMPLATE_ID)
  assert.equal((updated as any).name, 'boas-vindas-v2')
})

test('deleteTemplate reaches core.delete_notification_template instead of 404', async () => {
  await NotificationService.deleteTemplate(TEMPLATE_ID)

  const request = onlyRequest()
  assert.equal(request.path, '/rest/v1/rpc/delete_notification_template')
  assert.equal(request.contentProfile, SCHEMA)
  assert.equal((request.body as any).p_id, TEMPLATE_ID)
})

test('control: the same client without .schema() gets the production PGRST202', async () => {
  const { error } = await client.rpc('create_notification_template' as any, { p_template: {} })

  const request = onlyRequest()
  // supabase-js defaults `db.schema` to 'public', so an unqualified call does not omit the
  // header — it asserts `public`, which is why this had to be fixed at the call site.
  assert.equal(request.contentProfile, 'public', 'no .schema() means the client claims public')
  assert.equal(error?.code, 'PGRST202', 'the fake PostgREST must reject unqualified calls')
})
