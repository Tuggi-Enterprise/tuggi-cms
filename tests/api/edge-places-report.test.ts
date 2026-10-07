/**
 * #907 — `places-report`, the monthly report of a live place (BR-B2B-059), against
 * `docs/contracts/places-cms.md` (workspace).
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

const REPORT = {
  live_since: '2026-10-07',
  generated_at: '2026-10-08T12:00:00Z',
  months: [{ month: '2026-10', period_from: '2026-10-07', period_to: '2026-10-07', partial: true }],
  month: '2026-10',
  period_from: '2026-10-07',
  period_to: '2026-10-07',
  partial: true,
  passersby_300m: { has_data: true, count: 150 },
  story_played: { has_data: false, count: null },
}

type Call = { submissionId: string; month: string | null }

function deps(opts: { authorized?: boolean; data?: unknown; error?: { code?: string; message?: string } | null; throws?: boolean } = {}) {
  const calls: Call[] = []
  return {
    calls,
    deps: {
      isAuthorized: () => opts.authorized ?? true,
      monthlyReport: async (submissionId: string, month: string | null) => {
        calls.push({ submissionId, month })
        if (opts.throws) throw new Error('network')
        return { data: opts.data ?? null, error: opts.error ?? null }
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
  const d = deps({ authorized: false, data: REPORT })
  assert.deepEqual(await read(await mod.handlePlacesReport(post({ submission_id: ID }), d.deps)), {
    status: 401,
    body: { error: 'unauthorized' },
  })
  assert.equal(d.calls.length, 0)
})

test('BR-B2B-059: only POST', async () => {
  const d = deps({ data: REPORT })
  const res = await mod.handlePlacesReport(new Request('http://edge/places-report'), d.deps)
  assert.equal(res.status, 405)
  assert.equal(d.calls.length, 0)
})

test('BR-B2B-059: invalid body is 400 invalid_body and the database is not touched', async () => {
  const bad: unknown[] = [
    {},
    { submission_id: 'abc' },
    { submission_id: ID, month: '2026-13' },
    { submission_id: ID, month: '2026-1' },
    { submission_id: ID, month: '2026-10-01' },
    { submission_id: ID, month: '' },
    { submission_id: ID, month: 202610 },
    [ID],
    null,
  ]
  for (const body of bad) {
    const d = deps({ data: REPORT })
    const out = await read(await mod.handlePlacesReport(post(body), d.deps))
    assert.deepEqual(out, { status: 400, body: { error: 'invalid_body' } }, JSON.stringify(body))
    assert.equal(d.calls.length, 0)
  }
  const d = deps({ data: REPORT })
  assert.equal((await mod.handlePlacesReport(post('{not json', true), d.deps)).status, 400)
})

test('BR-B2B-059 item 4: month YYYY-MM becomes the first day; absent or null asks for the current month', async () => {
  const d = deps({ data: REPORT })
  await mod.handlePlacesReport(post({ submission_id: ID.toUpperCase(), month: '2026-10' }), d.deps)
  await mod.handlePlacesReport(post({ submission_id: ID }), d.deps)
  await mod.handlePlacesReport(post({ submission_id: ID, month: null }), d.deps)
  assert.deepEqual(d.calls, [
    { submissionId: ID, month: '2026-10-01' },
    { submissionId: ID, month: null },
    { submissionId: ID, month: null },
  ])
})

test('BR-B2B-059: not_live (P0001) is 409, month outside the list (22023) is 404', async () => {
  const notLive = deps({ error: { code: 'P0001', message: 'not_live' } })
  assert.deepEqual(await read(await mod.handlePlacesReport(post({ submission_id: ID }), notLive.deps)), {
    status: 409,
    body: { error: 'not_live' },
  })
  const noMonth = deps({ error: { code: '22023', message: 'month 2026-01 for 3f2a… not available' } })
  assert.deepEqual(await read(await mod.handlePlacesReport(post({ submission_id: ID, month: '2026-01' }), noMonth.deps)), {
    status: 404,
    body: { error: 'month_not_available' },
  })
})

test('BR-B2B-059: any other failure is 502 unavailable, with no detail in the body', async () => {
  const cases = [
    deps({ error: { code: 'P0001', message: 'something else' } }),
    deps({ error: { code: '42501', message: 'permission denied for function place_monthly_report' } }),
    deps({ error: { message: 'FetchError: network' } }),
    deps({ throws: true }),
    deps({ data: null }),
    deps({ data: [REPORT] }),
  ]
  for (const d of cases) {
    const res = await mod.handlePlacesReport(post({ submission_id: ID }), d.deps)
    const text = await res.text()
    assert.equal(res.status, 502)
    assert.deepEqual(JSON.parse(text), { error: 'unavailable' })
  }
})

test('BR-B2B-059: the database JSON passes through as it came', async () => {
  const d = deps({ data: REPORT })
  const res = await mod.handlePlacesReport(post({ submission_id: ID, month: '2026-10' }), d.deps)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/json')
  assert.deepEqual(await res.json(), REPORT)
})

test('BR-B2B-059 item 5: a metric without has_data never carries a count, whatever the row says', () => {
  const out = mod.shapeReportResponse({
    ...REPORT,
    passersby_300m: { has_data: false, count: 42 },
    story_played: { count: 7 },
  })
  assert.deepEqual(out.passersby_300m, { has_data: false, count: null })
  assert.deepEqual(out.story_played, { has_data: false, count: null })
})

test('places-report/index.ts: wires the shared secret and partner.place_monthly_report', () => {
  const src = readFileSync(resolve(FUNCTIONS, 'places-report', 'index.ts'), 'utf8')
  assert.match(src, /isPlacesSecret\(r\.headers\.get\(PLACES_SECRET_HEADER\)\)/)
  assert.match(src, /\.schema\('partner'\)\s*\.rpc\('place_monthly_report', \{ p_submission_id: submissionId, p_month: month \}\)/)
  assert.match(src, /handlePlacesReport\(req,/)
})
