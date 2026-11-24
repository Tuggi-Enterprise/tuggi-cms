/**
 * #1062: scripts/apple-analytics-setup.mjs, the operator's one-off setup of the Apple downloads collector.
 *
 * The script runs as a child process against a fake App Store Connect (APPLE_SETUP_TEST_BASE_URL) and a fake
 * `supabase` binary (APPLE_SETUP_TEST_SUPABASE_BIN) that records what it was given. The fake server checks every
 * JWT signature with the public half of the key named in `kid`, so a test also proves the token is valid ES256.
 *
 * What must hold: the Admin key never reaches the secrets, and no output ever carries a key or a token.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { generateKeyPairSync, verify, type KeyObject } from 'node:crypto'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve(__dirname, '../../scripts/apple-analytics-setup.mjs')
const APP_ID = '6744379818'
const ISSUER = 'issuer-test'
const ADMIN_KID = 'ADMINKEY01'
const SALES_KID = 'SALESKEY01'

type Call = { method: string; path: string; kid: string; body: unknown }
type Reply = { status: number; body: unknown }
type Routes = { list?: Partial<Record<string, Reply>>; reports?: Partial<Record<string, Reply>>; create?: Reply }

const dir = mkdtempSync(join(tmpdir(), 'apple-setup-test-'))
const keys: Record<string, { pem: string; publicKey: KeyObject; path: string }> = {}
let server: Server
let baseUrl = ''
let routes: Routes = {}
let calls: Call[] = []

function makeKey(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const path = join(dir, `AuthKey_${kid}.p8`)
  writeFileSync(path, pem)
  keys[kid] = { pem, publicKey, path }
}

/** The kid of a valid ES256 App Store Connect token, or null. */
function verifiedKid(auth: string | undefined): string | null {
  const token = auth?.replace(/^Bearer /, '') ?? ''
  const [h, p, s] = token.split('.')
  if (!h || !p || !s) return null
  const header = JSON.parse(Buffer.from(h, 'base64url').toString())
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString())
  const key = keys[header.kid]
  if (!key || header.alg !== 'ES256' || payload.aud !== 'appstoreconnect-v1' || payload.iss !== ISSUER) return null
  const good = verify('sha256', Buffer.from(`${h}.${p}`), { key: key.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))
  return good ? header.kid : null
}

before(async () => {
  makeKey(ADMIN_KID)
  makeKey(SALES_KID)
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const kid = verifiedKid(req.headers.authorization)
      const path = req.url ?? ''
      calls.push({ method: req.method ?? '', path, kid: kid ?? '', body: raw ? JSON.parse(raw) : null })
      let reply: Reply | undefined
      if (!kid) reply = { status: 401, body: { errors: [{ code: 'NOT_AUTHORIZED' }] } }
      else if (req.method === 'GET' && path === `/v1/apps/${APP_ID}/analyticsReportRequests?filter[accessType]=ONGOING`)
        reply = routes.list?.[kid]
      else if (req.method === 'GET' && /^\/v1\/analyticsReportRequests\/[^/]+\/reports$/.test(path)) reply = routes.reports?.[kid]
      else if (req.method === 'POST' && path === '/v1/analyticsReportRequests') reply = routes.create
      reply ??= { status: 404, body: { errors: [{ code: 'NOT_FOUND' }] } }
      res.writeHead(reply.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(reply.body))
    })
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const addr = server.address()
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
})

after(() => {
  server.close()
  rmSync(dir, { recursive: true, force: true })
})

const ok = (data: unknown): Reply => ({ status: 200, body: { data } })
const forbidden: Reply = { status: 403, body: { errors: [{ code: 'FORBIDDEN_ERROR', detail: 'detalhe-interno-da-apple' }] } }

/** A fake `supabase` that records argv, the env file's content and mode, then exits with `code`. */
function fakeSupabase(code = 0) {
  const log = join(dir, `supabase-${Date.now()}-${Math.random()}.json`)
  const bin = join(dir, `supabase-${Date.now()}-${Math.random()}.mjs`)
  writeFileSync(
    bin,
    `#!${process.execPath}
import { readFileSync, statSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const file = args[args.indexOf('--env-file') + 1]
writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args, file, content: readFileSync(file, 'utf8'), mode: statSync(file).mode & 0o777 }))
process.exit(${code})
`,
  )
  chmodSync(bin, 0o755)
  return { bin, read: () => JSON.parse(readFileSync(log, 'utf8')) as { args: string[]; file: string; content: string; mode: number } }
}

function run(extra: string[] = [], env: Record<string, string> = {}) {
  const argv = [SCRIPT, '--issuer', ISSUER, '--admin-key-id', ADMIN_KID, '--admin-p8', keys[ADMIN_KID].path,
    '--sales-key-id', SALES_KID, '--sales-p8', keys[SALES_KID].path, ...extra]
  return new Promise<{ code: number; out: string }>((done) => {
    execFile(process.execPath, argv, { env: { ...process.env, APPLE_SETUP_TEST_BASE_URL: baseUrl, ...env } }, (err, stdout, stderr) => {
      done({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: `${stdout}${stderr}` })
    })
  })
}

/** No PEM line, no key body and no JWT in anything the operator sees. */
function assertNoSecret(out: string) {
  assert.ok(!out.includes('PRIVATE KEY'), 'output carries a PEM header')
  for (const { pem } of Object.values(keys)) {
    for (const line of pem.split('\n').filter((l) => l && !l.startsWith('-----'))) assert.ok(!out.includes(line), 'output carries part of a key')
  }
  assert.ok(!/eyJ[\w-]+\.eyJ/.test(out), 'output carries a JWT')
}

test('#1062 a live ONGOING request is reused without POST, the stopped one is ignored', async () => {
  calls = []
  routes = {
    list: {
      [ADMIN_KID]: ok([{ id: 'req-old', attributes: { stoppedDueToInactivity: true } }, { id: 'req-live', attributes: { stoppedDueToInactivity: false } }]),
      [SALES_KID]: ok([]),
    },
    reports: { [SALES_KID]: ok([]) },
  }
  const r = await run()
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /1\. Pedido ONGOING já existia e foi reaproveitado: req-live/)
  assert.match(r.out, /2\. Sales lê: sim/)
  assert.match(r.out, /3\. Segredos: não cadastrados/)
  assert.match(r.out, new RegExp(`4\\. Agora revogue a chave Admin ${ADMIN_KID}`))
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0)
  assert.ok(calls.some((c) => c.kid === SALES_KID && c.path === '/v1/analyticsReportRequests/req-live/reports'))
  assertNoSecret(r.out)
})

test('#1062 with no live request, creates ONGOING with the Admin key and the body from Apple docs', async () => {
  calls = []
  routes = {
    list: { [ADMIN_KID]: ok([{ id: 'req-old', attributes: { stoppedDueToInactivity: true } }]), [SALES_KID]: ok([]) },
    create: { status: 201, body: { data: { id: 'req-new', type: 'analyticsReportRequests' } } },
    reports: { [SALES_KID]: ok([]) },
  }
  const r = await run()
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /1\. Pedido ONGOING criado: req-new/)
  const post = calls.find((c) => c.method === 'POST')
  assert.equal(post?.kid, ADMIN_KID)
  assert.deepEqual(post?.body, {
    data: {
      type: 'analyticsReportRequests',
      attributes: { accessType: 'ONGOING' },
      relationships: { app: { data: { type: 'apps', id: APP_ID } } },
    },
  })
  assertNoSecret(r.out)
})

test('#1062 an Apple error shows only the status and the code, never the detail', async () => {
  calls = []
  routes = { list: { [ADMIN_KID]: ok([]) }, create: forbidden }
  const r = await run()
  assert.equal(r.code, 1)
  assert.match(r.out, /HTTP 403 \(FORBIDDEN_ERROR\)/)
  assert.ok(!r.out.includes('detalhe-interno-da-apple'))
  assertNoSecret(r.out)
})

test('#1062 Sales 403 on the listing: prints the APPLE_ASC_REQUEST_ID command, runs nothing, stores no secret', async () => {
  calls = []
  const fake = fakeSupabase()
  routes = { list: { [ADMIN_KID]: ok([{ id: 'req-live', attributes: {} }]), [SALES_KID]: forbidden }, reports: { [SALES_KID]: ok([]) } }
  const r = await run(['--set-secrets'], { APPLE_SETUP_TEST_SUPABASE_BIN: fake.bin })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /2\. Sales lê: não \(HTTP 403/)
  assert.match(r.out, /supabase secrets set APPLE_ASC_REQUEST_ID=req-live --project-ref tysnkzmljlmmqpbotkxv/)
  assert.match(r.out, /3\. Segredos: não cadastrados, porque a chave Sales não passou/)
  assert.throws(() => fake.read(), 'supabase must not have been called')
  assert.match(r.out, /4\. Agora revogue a chave Admin/)
  assertNoSecret(r.out)
})

test('#1062 --set-secrets stores only the Sales key, through a 600 file removed at the end, without leaking it', async () => {
  calls = []
  const fake = fakeSupabase()
  routes = { list: { [ADMIN_KID]: ok([{ id: 'req-live', attributes: {} }]), [SALES_KID]: ok([]) }, reports: { [SALES_KID]: ok([]) } }
  const r = await run(['--set-secrets'], { APPLE_SETUP_TEST_SUPABASE_BIN: fake.bin })
  assert.equal(r.code, 0, r.out)
  const seen = fake.read()
  assert.deepEqual(seen.args, ['secrets', 'set', '--env-file', seen.file, '--project-ref', 'tysnkzmljlmmqpbotkxv'])
  assert.equal(seen.mode, 0o600)
  assert.equal(existsSync(seen.file), false, 'the temp file was left on disk')
  assert.match(seen.content, new RegExp(`^APPLE_ASC_KEY_ID=${SALES_KID}$`, 'm'))
  assert.match(seen.content, new RegExp(`^APPLE_ASC_ISSUER_ID=${ISSUER}$`, 'm'))
  const stored = /^APPLE_ASC_PRIVATE_KEY="(.*)"$/m.exec(seen.content)?.[1].replace(/\\n/g, '\n')
  assert.equal(stored, keys[SALES_KID].pem.trim())
  assert.ok(!seen.content.includes(ADMIN_KID))
  const adminBody = keys[ADMIN_KID].pem.split('\n')[1]
  assert.ok(!seen.content.includes(adminBody), 'the Admin key reached the secrets')
  assert.match(r.out, /3\. Segredos: chave Sales SALESKEY01 cadastrada no projeto tysnkzmljlmmqpbotkxv/)
  assertNoSecret(r.out)
})

test('#1062 the same key in both roles is refused before any call', async () => {
  calls = []
  const r = await run(['--sales-p8', keys[ADMIN_KID].path])
  assert.equal(r.code, 1)
  assert.match(r.out, /A Admin nunca vai para os segredos/)
  assert.equal(calls.length, 0)
  assertNoSecret(r.out)
})
