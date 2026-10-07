/**
 * #906 — publishing a partner's place moves its portal submission `approved → live`
 * (BR-B2B-049 item 8), at the act. `markPortalSubmissionLive` runs here against an injected
 * `partner` schema client; the route's order (after the write, never instead of it) is read from
 * the source. The daily reconciliation is in `edge-places-transition-email.test.ts`.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { markPortalSubmissionLive } from '@/lib/services/portal-validation-service'

const ROOT = resolve(import.meta.dirname, '../..')
const POI = 'aaaaaaaa-2222-4333-8444-555555555555'
const SUB = '5009da91-382f-49f0-9dc1-db2026c7959d'
const OPERATOR = 'bbbbbbbb-2222-4333-8444-555555555555'

type Submission = { id: string; attraction_id: string | null; status: string }

/** A `partner` schema that filters by `eq` and records every RPC. */
function fakeDb(rows: Submission[], rpcError: { code: string } | null = null) {
  const rpcs: { fn: string; args: Record<string, unknown> }[] = []
  const db = {
    from: () => {
      const filters: [string, unknown][] = []
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters.push([column, value])
          return query
        },
        then: (resolve: (r: { data: unknown; error: null }) => unknown) =>
          resolve({
            data: rows
              .filter((row) => filters.every(([c, v]) => (row as Record<string, unknown>)[c] === v))
              .map((row) => ({ id: row.id })),
            error: null,
          }),
      }
      return query
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args })
      return rpcError ? { data: null, error: rpcError } : { data: args.p_to, error: null }
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, rpcs }
}

test('BR-B2B-049 item 8: publishing moves the approved submission of that POI to live, by the operator', async () => {
  const { db, rpcs } = fakeDb([{ id: SUB, attraction_id: POI, status: 'approved' }])
  assert.deepEqual(await markPortalSubmissionLive(POI, OPERATOR, db), [SUB])
  assert.deepEqual(rpcs, [
    {
      fn: 'transition_place_submission',
      args: { p_submission_id: SUB, p_to: 'live', p_actor_kind: 'operator', p_actor_user_id: OPERATOR, p_note: null },
    },
  ])
})

test('BR-B2B-049 item 8: a POI with no portal submission calls nothing', async () => {
  const { db, rpcs } = fakeDb([{ id: SUB, attraction_id: 'other-poi', status: 'approved' }])
  assert.deepEqual(await markPortalSubmissionLive(POI, OPERATOR, db), [])
  assert.equal(rpcs.length, 0)
})

test('BR-B2B-049 item 8: a submission in another status does not move and is not an error', async () => {
  for (const status of ['in_review', 'changes_requested', 'live', 'rejected']) {
    const { db, rpcs } = fakeDb([{ id: SUB, attraction_id: POI, status }])
    assert.deepEqual(await markPortalSubmissionLive(POI, OPERATOR, db), [], status)
    assert.equal(rpcs.length, 0, status)
  }
})

test('BR-B2B-049 item 8: a failed transition is logged, never thrown — the publication stands', async () => {
  const { db } = fakeDb([{ id: SUB, attraction_id: POI, status: 'approved' }], { code: 'XX000' })
  assert.deepEqual(await markPortalSubmissionLive(POI, OPERATOR, db), [])
})

test('BR-B2B-049 item 8: the publish route moves the submission only after the write, and only when publishing', () => {
  const src = readFileSync(
    resolve(ROOT, 'app/api/admin/partnerships/clients/[clientId]/places/[attractionId]/publish/route.ts'),
    'utf8'
  )
  const write = src.indexOf('await placeService.setApproved(')
  const live = src.indexOf('await markPortalSubmissionLive(attractionId, auth.user.id)')
  const mail = src.indexOf('await notifyPortalLive(')
  assert.ok(write > 0 && live > write && mail > live)
  assert.match(src.slice(live - 120, live), /if \(approved\) \{/)
})
