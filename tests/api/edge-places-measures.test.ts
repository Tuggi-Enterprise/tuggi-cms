/**
 * #1145 — `places-measures`, the measures of BR-B2B-068 for the overview of the Portal Locais, against
 * `docs/contracts/places-cms.md` and `identidade-publica.md` "As medidas" (workspace).
 *
 * The handler lives in `_shared/places-measures.ts` with the gate and the reads injected, so it runs
 * here under Node end to end. `places-measures/index.ts` imports supabase-js from esm.sh and cannot be
 * loaded; a static reading proves it wires the real gate, the submission row and the right RPC.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const FUNCTIONS = resolve(import.meta.dirname, '../../supabase/functions')

type Mod = typeof import('../../supabase/functions/_shared/places-measures')
let mod: Mod

before(async () => {
  mod = await import(pathToFileURL(resolve(FUNCTIONS, '_shared/places-measures.ts')).href)
})

const SUBMISSION = '3f2a9c1e-8b4d-4e2f-9a7b-1c2d3e4f5a6b'
const OWN = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const POI = '33333333-3333-4333-8333-333333333333'

const ANSWER = {
  month: '2026-11',
  since_month: '2026-03',
  commission: { status: 'to_be_settled', amount_cents: null, currency: null },
  listened: 12,
  saved: null,
  downloaded: 3,
  profile_visits: 0,
}

type Opts = {
  authorized?: boolean
  link?: { client_id?: string | null; legacy_client_id?: string | null; attraction_id?: string | null } | null
  linkError?: { code: string } | null
  poiPartner?: string | null
  data?: unknown
  error?: { code?: string; message?: string } | null
  throws?: boolean
}

function deps(opts: Opts = {}) {
  const calls: { fn: string; args: unknown[] }[] = []
  const link = 'link' in opts ? opts.link : { client_id: null, legacy_client_id: null, attraction_id: POI }
  return {
    calls,
    deps: {
      isAuthorized: () => opts.authorized ?? true,
      submission: async (submissionId: string) => {
        calls.push({ fn: 'submission', args: [submissionId] })
        if (opts.throws) throw new Error('network')
        return {
          data: link === null ? null : { client_id: null, legacy_client_id: null, attraction_id: null, ...link },
          error: opts.linkError ?? null,
        }
      },
      attractionPartner: async (attractionId: string) => {
        calls.push({ fn: 'attractionPartner', args: [attractionId] })
        return { data: 'poiPartner' in opts ? opts.poiPartner : OWN, error: null }
      },
      measures: async (clientId: string, month: string | null) => {
        calls.push({ fn: 'measures', args: [clientId, month] })
        return { data: 'data' in opts ? opts.data : ANSWER, error: opts.error ?? null }
      },
    },
  }
}

const post = (body: unknown, raw = false) =>
  new Request('http://edge/places-measures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  })

const read = async (res: Response) => ({ status: res.status, body: await res.json() })
const measuresCalls = (d: ReturnType<typeof deps>) => d.calls.filter((c) => c.fn === 'measures').map((c) => c.args)

test('BR-B2B-068: no secret is 401 and the database is not touched', async () => {
  const d = deps({ authorized: false })
  assert.deepEqual(await read(await mod.handlePlacesMeasures(post({ submission_id: SUBMISSION }), d.deps)), {
    status: 401,
    body: { error: 'unauthorized' },
  })
  assert.equal(d.calls.length, 0)
})

test('BR-B2B-068: only POST, and a malformed body is 400 without reading anything', async () => {
  const d0 = deps()
  assert.equal((await mod.handlePlacesMeasures(new Request('http://edge/places-measures'), d0.deps)).status, 405)
  const bad: unknown[] = [{}, { submission_id: 'abc' }, [SUBMISSION], null, { submission_id: SUBMISSION, month: '2026-13' }, { submission_id: SUBMISSION, month: '2026-11-01' }, { submission_id: SUBMISSION, month: 202611 }]
  for (const body of bad) {
    const d = deps()
    assert.deepEqual(await read(await mod.handlePlacesMeasures(post(body), d.deps)), { status: 400, body: { error: 'invalid_body' } }, JSON.stringify(body))
    assert.equal(d.calls.length, 0)
  }
  assert.equal((await mod.handlePlacesMeasures(post('{x', true), deps().deps)).status, 400)
})

test('BR-B2B-068: one partner never reads another, a client_id in the body is ignored and the partner comes from the submission', async () => {
  const d = deps({ link: { client_id: null, legacy_client_id: null, attraction_id: POI }, poiPartner: OWN })
  const res = await mod.handlePlacesMeasures(post({ submission_id: SUBMISSION, client_id: OTHER, p_client_id: OTHER }), d.deps)
  assert.equal(res.status, 200)
  assert.deepEqual(measuresCalls(d), [[OWN, null]])
  assert.ok(!JSON.stringify(d.calls).includes(OTHER))
})

test('BR-B2B-068 item 1: the place, the no-address partner and the pre-portal client each reach their own partner', async () => {
  const noAddress = deps({ link: { client_id: OWN, attraction_id: null } })
  await mod.handlePlacesMeasures(post({ submission_id: SUBMISSION }), noAddress.deps)
  assert.deepEqual(measuresCalls(noAddress), [[OWN, null]])
  assert.equal(noAddress.calls.some((c) => c.fn === 'attractionPartner'), false)

  const mirror = deps({ link: { legacy_client_id: OWN, attraction_id: POI }, poiPartner: OTHER })
  await mod.handlePlacesMeasures(post({ submission_id: SUBMISSION }), mirror.deps)
  assert.deepEqual(measuresCalls(mirror), [[OWN, null]])

  const place = deps({ link: { attraction_id: POI }, poiPartner: OWN })
  await mod.handlePlacesMeasures(post({ submission_id: SUBMISSION.toUpperCase() }), place.deps)
  assert.deepEqual(place.calls[0], { fn: 'submission', args: [SUBMISSION] })
  assert.deepEqual(measuresCalls(place), [[OWN, null]])
})

test('BR-B2B-068: a submission without a partner yet (or unknown) answers measures null, no RPC', async () => {
  for (const opts of [{ link: null }, { link: { attraction_id: null } }, { link: { attraction_id: POI }, poiPartner: null }] as Opts[]) {
    const d = deps(opts)
    assert.deepEqual(await read(await mod.handlePlacesMeasures(post({ submission_id: SUBMISSION }), d.deps)), { status: 200, body: { measures: null } })
    assert.deepEqual(measuresCalls(d), [])
  }
})

test('BR-B2B-068 item 2: the chosen month goes as its first day; a month that has not started is 400 invalid_month', async () => {
  const d = deps()
  await mod.handlePlacesMeasures(post({ submission_id: SUBMISSION, month: '2026-10' }), d.deps)
  assert.deepEqual(measuresCalls(d), [[OWN, '2026-10-01']])
  const future = deps({ error: { code: '22023', message: 'the month has not started' } })
  assert.deepEqual(await read(await mod.handlePlacesMeasures(post({ submission_id: SUBMISSION, month: '2099-01' }), future.deps)), {
    status: 400,
    body: { error: 'invalid_month' },
  })
})

test('BR-B2B-068: the answer passes with only the contract keys; null stays null, never zero', async () => {
  const d = deps({ data: { ...ANSWER, extra: 'x', commission: { ...ANSWER.commission, rate: 0.1 } } })
  const out = await read(await mod.handlePlacesMeasures(post({ submission_id: SUBMISSION }), d.deps))
  assert.deepEqual(out, { status: 200, body: { measures: ANSWER } })
  assert.equal(out.body.measures.saved, null)
  assert.equal(out.body.measures.profile_visits, 0)
})

test('BR-B2B-068 item 2.a: only a settled month carries an amount; a count that is not an integer becomes null', () => {
  assert.deepEqual(mod.shapeMeasures({ ...ANSWER, commission: { status: 'settled', amount_cents: 4250, currency: 'BRL' } })?.commission, {
    status: 'settled',
    amount_cents: 4250,
    currency: 'BRL',
  })
  assert.deepEqual(mod.shapeMeasures({ ...ANSWER, commission: { status: 'to_be_settled', amount_cents: 999, currency: 'BRL' } })?.commission, {
    status: 'to_be_settled',
    amount_cents: null,
    currency: null,
  })
  const loose = mod.shapeMeasures({ ...ANSWER, listened: '12', downloaded: -1, profile_visits: 1.5 })
  assert.deepEqual([loose?.listened, loose?.downloaded, loose?.profile_visits], [null, null, null])
  assert.equal(mod.shapeMeasures({ ...ANSWER, commission: { status: 'estimated' } }), null)
  assert.equal(mod.shapeMeasures({ ...ANSWER, month: '11/2026' }), null)
})

test('BR-B2B-068: any other failure is 502 unavailable, with no detail in the body', async () => {
  const cases = [
    deps({ linkError: { code: '42501' } }),
    deps({ throws: true }),
    deps({ error: { code: '42501', message: `permission denied ${OWN}` } }),
    deps({ data: 'x' }),
    deps({ data: null }),
  ]
  for (const d of cases) {
    const res = await mod.handlePlacesMeasures(post({ submission_id: SUBMISSION }), d.deps)
    const text = await res.text()
    assert.equal(res.status, 502)
    assert.deepEqual(JSON.parse(text), { error: 'unavailable' })
  }
  const gone = deps({ error: { code: 'P0002' } })
  assert.deepEqual(await read(await mod.handlePlacesMeasures(post({ submission_id: SUBMISSION }), gone.deps)), { status: 200, body: { measures: null } })
})

test('places-measures/index.ts: wires the shared secret, the submission row and partner.get_partner_measures_as', () => {
  const src = readFileSync(resolve(FUNCTIONS, 'places-measures', 'index.ts'), 'utf8')
  assert.match(src, /isPlacesSecret\(r\.headers\.get\(PLACES_SECRET_HEADER\)\)/)
  assert.match(src, /from\('place_submissions'\)\s*\.select\('client_id, legacy_client_id, attraction_id'\)\s*\.eq\('id', submissionId\)/)
  assert.match(src, /\.rpc\('get_partner_measures_as', \{ p_client_id: clientId, p_month: month \}\)/)
  assert.match(src, /handlePlacesMeasures\(req,/)
})
