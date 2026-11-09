/**
 * #1156: the free minutes histogram of the Engagement report (spec-cms-relatorio-engajamento-2026-11
 * §D4, contract banco-para-cms Parte 26 §3), the read of "saw the paywall" from GA4 (§D3), and the
 * function that is not deployed yet answering "no data" instead of an error.
 *
 * Run with: npm run test:api
 */

import { test, before, mock } from 'node:test'
import assert from 'node:assert/strict'

import { parseFreeMinutesHistogram, readFreeMinutes, bucketKey, FREE_MINUTES_MARKS } from '../../lib/engagement/free-minutes'
import { parseGa4Report } from '../../lib/engagement/report'

/** The example of the contract, October. */
const RAW = {
  month: '2026-10',
  base: 14,
  buckets: [
    { from_min: 0, to_min: 15, people: 5 },
    { from_min: 15, to_min: 30, people: 5 },
    { from_min: 30, to_min: 60, people: null },
    { from_min: 60, to_min: 120, people: null },
    { from_min: 120, to_min: 180, people: 0 },
    { from_min: 180, to_min: null, people: null },
  ],
}

test('#1156 spec D4 happy path: six buckets in order, the share of each over base, the widest measured bucket is the ruler', () => {
  const h = parseFreeMinutesHistogram(RAW)
  assert.equal(h.month, '2026-10')
  assert.equal(h.base, 14)
  assert.deepEqual(h.buckets.map((b) => bucketKey(b.fromMin, b.toMin)), ['b0_15', 'b15_30', 'b30_60', 'b60_120', 'b120_180', 'b180_plus'])
  const v = readFreeMinutes(h, '2026-10')
  assert.equal(v.state, 'measured')
  assert.equal(v.max, 5)
  assert.equal(v.rows[0].share, 5 / 14)
  assert.equal(v.rows[4].share, 0)
})

test('#1156 spec D8 item 3 DS-COMPONENTE-084 item 1 BR-COMUNICACAO-022 item 4: a hidden bucket stays null with no share, the others keep theirs, nothing becomes 0', () => {
  const v = readFreeMinutes(parseFreeMinutesHistogram(RAW), '2026-10')
  for (const i of [2, 3, 5]) {
    assert.equal(v.rows[i].people, null)
    assert.equal(v.rows[i].share, null)
  }
  assert.equal(v.rows[1].share, 5 / 14)
  // a key that is absent is null too, never 0
  const absent = parseFreeMinutesHistogram({ month: '2026-10', buckets: [{ from_min: 0, to_min: 15 }] })
  assert.equal(absent.base, null)
  assert.equal(absent.buckets[0].people, null)
})

test('#1156 spec D4: the marks fall after the buckets whose to_min is 15, 60 and 180, read from the data, and go away when the border does', () => {
  assert.deepEqual([...FREE_MINUTES_MARKS], [15, 60, 180])
  const v = readFreeMinutes(parseFreeMinutesHistogram(RAW), '2026-10')
  assert.deepEqual(v.rows.map((r) => r.markAfter), [15, null, 60, null, 180, null])
  const moved = readFreeMinutes(
    parseFreeMinutesHistogram({ month: '2026-10', base: 20, buckets: [{ from_min: 0, to_min: 20, people: 10 }, { from_min: 20, to_min: 60, people: 6 }, { from_min: 60, to_min: null, people: 4 }] }),
    '2026-10'
  )
  assert.deepEqual(moved.rows.map((r) => r.markAfter), [null, 60, null])
})

test('#1156 spec D4 states: base null is a small base, base 0 is empty, a month before the minute ledger is not measured, no bucket is no source', () => {
  const small = readFreeMinutes(parseFreeMinutesHistogram({ ...RAW, base: null }), '2026-10')
  assert.equal(small.state, 'small_base')
  const empty = readFreeMinutes(parseFreeMinutesHistogram({ ...RAW, base: 0, buckets: RAW.buckets.map((b) => ({ ...b, people: 0 })) }), '2026-10')
  assert.equal(empty.state, 'empty')
  assert.deepEqual(empty.rows.map((r) => r.share), [null, null, null, null, null, null])
  const before = readFreeMinutes(parseFreeMinutesHistogram({ ...RAW, month: '2026-07', buckets: RAW.buckets.map((b) => ({ ...b, people: null })) }), '2026-07')
  assert.equal(before.state, 'before_ledger')
  assert.equal(readFreeMinutes(null, '2026-10').state, 'no_source')
  assert.equal(readFreeMinutes(parseFreeMinutesHistogram({}), '2026-10').state, 'no_source')
})

test('#1156 spec D3 DS-COMPONENTE-084 item 2: the GA4 answer carries the paywall devices; a function before #1156 parses them to null, never 0', () => {
  const months = [{ month: '2026-10', activeUsers: 225, engagementSeconds: 1, sessionsPerUser: 2, engagedUsers: 90, newEngagedUsers: 40, paywallViewedUsers: 95 }]
  assert.equal(parseGa4Report({ months, clicks: [] })?.months[0].paywallViewedUsers, 95)
  const { paywallViewedUsers: _p, ...old } = months[0]
  assert.equal(parseGa4Report({ months: [old], clicks: [] })?.months[0].paywallViewedUsers, null)
  assert.equal(parseGa4Report({ months: [{ ...old, paywallViewedUsers: 0 }], clicks: [] })?.months[0].paywallViewedUsers, 0)
})

// ── The function not deployed yet ───────────────────────────────────────────────────────────

let answer: { data: unknown; error: { code: string; message: string } | null }
const calls: { fn: string; args: unknown }[] = []
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let service: any

before(async () => {
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseClient: () => ({
        schema: () => ({
          rpc: async (fn: string, args: unknown) => {
            calls.push({ fn, args })
            return answer
          },
        }),
      }),
    },
  })
  service = (await import('../../lib/services/conversion-service')).conversionService
})

test('#1156 BR-COMUNICACAO-022 item 4 contract Parte 26: PGRST202 (migration not applied) is a success with no data, so the card says no source, not an error', async () => {
  answer = { data: null, error: { code: 'PGRST202', message: 'Could not find the function core.cms_get_free_minutes_histogram' } }
  assert.deepEqual(await service.freeMinutes('2026-10'), { success: true, data: null })
  assert.deepEqual(calls[calls.length - 1], { fn: 'cms_get_free_minutes_histogram', args: { p_month: '2026-10' } })
  assert.equal(readFreeMinutes(null, '2026-10').state, 'no_source')
})

test('#1156: any other error is a failed read (retry), and a measured answer is parsed', async () => {
  answer = { data: null, error: { code: '42501', message: 'not admin' } }
  assert.deepEqual(await service.freeMinutes('2026-10'), { success: false, error: 'not admin' })
  answer = { data: RAW, error: null }
  const ok = await service.freeMinutes('2026-10')
  assert.equal(ok.success, true)
  assert.equal(ok.data.base, 14)
})
