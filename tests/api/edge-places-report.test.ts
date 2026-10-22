/**
 * #907, cycles since #993 — `places-report`, the published cycle reports of a live place
 * (BR-B2B-059), against `docs/contracts/places-cms.md` (workspace).
 *
 * The handler lives in `_shared/places-report.ts` with the gate and the RPC injected, so it runs
 * here under Node end to end. `places-report/index.ts` imports supabase-js from esm.sh and cannot
 * be loaded; a static reading proves it wires the real gate and the right RPC.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const FUNCTIONS = resolve(import.meta.dirname, '../../supabase/functions')

type Mod = typeof import('../../supabase/functions/_shared/places-report')
let mod: Mod

before(async () => {
  mod = await import(pathToFileURL(resolve(FUNCTIONS, '_shared/places-report.ts')).href)
})

const ID = '3f2a9c1e-8b4d-4e2f-9a7b-1c2d3e4f5a6b'

const OCT = {
  cycle_end: '2026-10-20',
  period_from: '2026-09-21',
  plan: 'paid',
  payload: { city: { name: 'Cabo Frio', partners_live: 34 }, door: { m300: 25 } },
}
const SEP = { cycle_end: '2026-09-20', period_from: '2026-08-21', plan: 'free', payload: { door: { m100: 18 } } }

function deps(opts: { authorized?: boolean; data?: unknown; error?: { code?: string; message?: string } | null; throws?: boolean } = {}) {
  const calls: string[] = []
  return {
    calls,
    deps: {
      isAuthorized: () => opts.authorized ?? true,
      cycleList: async (submissionId: string) => {
        calls.push(submissionId)
        if (opts.throws) throw new Error('network')
        return { data: 'data' in opts ? opts.data : [OCT, SEP], error: opts.error ?? null }
      },
    },
  }
}

function post(body: unknown, raw = false): Request {
  return new Request('http://edge/places-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  })
}

async function read(res: Response) {
  return { status: res.status, body: await res.json() }
}

test('BR-B2B-059: no secret is 401 and the database is not touched', async () => {
  const d = deps({ authorized: false })
  assert.deepEqual(await read(await mod.handlePlacesReport(post({ submission_id: ID }), d.deps)), {
    status: 401,
    body: { error: 'unauthorized' },
  })
  assert.equal(d.calls.length, 0)
})

test('BR-B2B-059: only POST', async () => {
  const d = deps()
  const res = await mod.handlePlacesReport(new Request('http://edge/places-report'), d.deps)
  assert.equal(res.status, 405)
  assert.equal(d.calls.length, 0)
})

test('BR-B2B-059: invalid body is 400 invalid_body and the database is not touched', async () => {
  const bad: unknown[] = [{}, { submission_id: 'abc' }, { submission_id: 42 }, [ID], null]
  for (const body of bad) {
    const d = deps()
    const out = await read(await mod.handlePlacesReport(post(body), d.deps))
    assert.deepEqual(out, { status: 400, body: { error: 'invalid_body' } }, JSON.stringify(body))
    assert.equal(d.calls.length, 0)
  }
  const d = deps()
  assert.equal((await mod.handlePlacesReport(post('{not json', true), d.deps)).status, 400)
})

test('#993: the request has no month; one sent by the portal of #907 is ignored', async () => {
  const d = deps()
  await mod.handlePlacesReport(post({ submission_id: ID.toUpperCase() }), d.deps)
  await mod.handlePlacesReport(post({ submission_id: ID, month: '2026-10' }), d.deps)
  assert.deepEqual(d.calls, [ID, ID])
})

test('BR-B2B-059 item 5: the published cycles pass through in the order of the database, as { cycles }', async () => {
  const d = deps()
  const res = await mod.handlePlacesReport(post({ submission_id: ID }), d.deps)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/json')
  assert.deepEqual(await res.json(), { cycles: [OCT, SEP] })
})

test('BR-B2B-059 item 5: no cycle yet is an empty list, not an error', async () => {
  for (const data of [[], null]) {
    const d = deps({ data })
    assert.deepEqual(await read(await mod.handlePlacesReport(post({ submission_id: ID }), d.deps)), { status: 200, body: { cycles: [] } })
  }
})

test('#993: only cycle_end, period_from, plan and payload reach the portal; a malformed item is dropped', () => {
  const out = mod.shapeCycles([
    { ...OCT, email_sent_at: '2026-10-21T09:00:01Z', computed_at: '2026-10-21T09:00:00Z', published_at: '2026-10-21T09:00:00Z' },
    { cycle_end: '20/10', period_from: '2026-09-21', plan: 'paid', payload: {} },
    { cycle_end: '2026-08-20', period_from: '2026-07-21', plan: 'paid', payload: [] },
    'x',
  ])
  assert.deepEqual(out, [OCT])
})

test('BR-B2B-059: any failure of the database is 502 unavailable, with no detail in the body', async () => {
  const cases = [
    deps({ error: { code: 'P0001', message: 'not_live' } }),
    deps({ error: { code: '42501', message: 'permission denied for function report_cycle_list' } }),
    deps({ error: { message: 'FetchError: network' } }),
    deps({ throws: true }),
    deps({ data: { cycles: 'x' } }),
    deps({ data: 'x' }),
  ]
  for (const d of cases) {
    const res = await mod.handlePlacesReport(post({ submission_id: ID }), d.deps)
    const text = await res.text()
    assert.equal(res.status, 502)
    assert.deepEqual(JSON.parse(text), { error: 'unavailable' })
  }
})

test('places-report/index.ts: wires the shared secret and partner.report_cycle_list', () => {
  const src = readFileSync(resolve(FUNCTIONS, 'places-report', 'index.ts'), 'utf8')
  assert.match(src, /isPlacesSecret\(r\.headers\.get\(PLACES_SECRET_HEADER\)\)/)
  assert.match(src, /\.schema\('partner'\)\s*\.rpc\('report_cycle_list', \{ p_submission_id: submissionId \}\)/)
  assert.doesNotMatch(src, /place_monthly_report/)
  assert.match(src, /handlePlacesReport\(req,/)
})
