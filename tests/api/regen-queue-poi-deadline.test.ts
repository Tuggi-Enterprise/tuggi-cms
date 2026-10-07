/**
 * #779 — no POI holds the TP regen queue (`scripts/regen-trigger-points.ts#runBatch`), and the
 * queue child is reused between POIs (`lib/utils/run-in-child.ts#ReusableChild`).
 *
 * Mutations that turn this suite red:
 *  · racing the POI against a timer in the same process — a synchronous loop never yields,
 *    and the timer never fires (the Rio queue sat hours on six relief POIs);
 *  · a timed-out POI that does not say `timeout` — the queue row is how the operator finds it;
 *  · a failed pipeline answered as success — the queue would mark it `done`;
 *  · a fork per POI again — the ~8 s of modules, OSM region and relief come back on every POI;
 *  · a POI that fails or throws taking the child down with it;
 *  · the killed child reused for the next POI, or a child never replaced (`maxRequests`);
 *  · `streetFootOnEdge` answering differently after the seed dedup (BR-POI-009 reach is
 *    measured on this foot; the dedup only removes repeated points).
 *
 * Run with: npm run test:api
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { ReusableChild } from '../../lib/utils/run-in-child'
import { streetFootOnEdge, calculateDistanceToBoundary, closestPointOnPolyline } from '../../lib/services/trigger-points-google/utils/calculations'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-in-child-'))
/** A queue child on the real `serveParentRequests`: the request names what it does. */
const childPath = path.join(dir, 'child.ts')
fs.writeFileSync(childPath, `
import { serveParentRequests } from ${JSON.stringify(pathToFileURL(path.resolve('lib/utils/run-in-child.ts')).href)}
let served = 0
serveParentRequests(async request => {
  served++
  const r = request as { op: string; msg?: string }
  if (r.op === 'served') return 'served=' + served
  if (r.op === 'fail') return r.msg ?? 'failed'
  if (r.op === 'throw') throw new Error(r.msg)
  if (r.op === 'exit') process.exit(3)
  if (r.op === 'spin') { const t = Date.now(); while (Date.now() - t < 60_000) {} }
  return null
})
`)
const LONG = 60_000

test('#779 one child serves POI after POI, keeping its state', async () => {
  const c = new ReusableChild(childPath, [], 200)
  try {
    assert.deepEqual(await c.run({ op: 'ok' }, LONG), { ok: true })
    assert.deepEqual(await c.run({ op: 'ok' }, LONG), { ok: true })
    assert.deepEqual(await c.run({ op: 'served' }, LONG), { ok: false, timedOut: false, error: 'served=3' })
    assert.equal(c.started, 1)
  } finally { c.close() }
})

test('#779 a synchronous loop is killed at the deadline, reported as timeout, and the next POI runs in a new child', async () => {
  const c = new ReusableChild(childPath, [], 200)
  try {
    await c.run({ op: 'ok' }, LONG) // the child is up: the deadline below measures the POI only
    const t0 = Date.now()
    const r = await c.run({ op: 'spin' }, 1_500)
    assert.ok(!r.ok && r.timedOut && r.error.startsWith('timeout'), JSON.stringify(r))
    assert.ok(Date.now() - t0 < 15_000, 'the parent went on long before the loop would end')
    assert.deepEqual(await c.run({ op: 'served' }, LONG), { ok: false, timedOut: false, error: 'served=1' })
    assert.equal(c.started, 2)
  } finally { c.close() }
})

test('#779 a failed or throwing POI reaches the parent with its message, and the child goes on', async () => {
  const c = new ReusableChild(childPath, [], 200)
  try {
    assert.deepEqual(await c.run({ op: 'fail', msg: 'No trigger points generated' }, LONG), { ok: false, timedOut: false, error: 'No trigger points generated' })
    assert.deepEqual(await c.run({ op: 'throw', msg: 'Failed to load POI' }, LONG), { ok: false, timedOut: false, error: 'Failed to load POI' })
    assert.deepEqual(await c.run({ op: 'ok' }, LONG), { ok: true })
    assert.equal(c.started, 1)
  } finally { c.close() }
})

test('#779 a child that dies mid-POI fails that POI, and the next one gets a new child', async () => {
  const c = new ReusableChild(childPath, [], 200)
  try {
    assert.deepEqual(await c.run({ op: 'exit' }, LONG), { ok: false, timedOut: false, error: 'child exited with code 3' })
    assert.deepEqual(await c.run({ op: 'ok' }, LONG), { ok: true })
    assert.equal(c.started, 2)
  } finally { c.close() }
})

test('#779 the child is replaced after maxRequests POIs', async () => {
  const c = new ReusableChild(childPath, [], 2)
  try {
    for (let i = 0; i < 3; i++) assert.deepEqual(await c.run({ op: 'ok' }, LONG), { ok: true })
    assert.deepEqual(await c.run({ op: 'served' }, LONG), { ok: false, timedOut: false, error: 'served=2' })
    assert.equal(c.started, 2)
  } finally { c.close() }
})

// The pre-dedup `streetFootOnEdge`, kept here as the oracle.
function footReference(polyline: { lat: number; lng: number }[], ring: { lat: number; lng: number }[]) {
  const seeds = [...polyline]
  for (const t of ring) { const p = closestPointOnPolyline(t, polyline); if (p) seeds.push(p.point) }
  let best: { point: { lat: number; lng: number }; edgeDistanceM: number } | null = null
  for (const p of seeds) { const d = calculateDistanceToBoundary(p, ring); if (!best || d < best.edgeDistanceM) best = { point: p, edgeDistanceM: d } }
  return best
}

test('#779 BR-POI-009 streetFootOnEdge keeps the same foot after dropping repeated seeds', () => {
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  // A ring with many vertices, like the 7,616-vertex park edge the pico inherited.
  const ring = Array.from({ length: 400 }, (_, i) => {
    const a = (i / 400) * 2 * Math.PI, r = 0.02 * (1 + 0.2 * Math.sin(7 * a))
    return { lat: -22.96 + r * Math.sin(a), lng: -43.52 + r * Math.cos(a) }
  })
  ring.push({ ...ring[0] })
  for (let k = 0; k < 200; k++) {
    const n = 2 + Math.floor(rnd() * 4)
    const o = { lat: -22.96 + (rnd() - 0.5) * 0.1, lng: -43.52 + (rnd() - 0.5) * 0.1 }
    const street = Array.from({ length: n }, () => ({ lat: o.lat + (rnd() - 0.5) * 0.004, lng: o.lng + (rnd() - 0.5) * 0.004 }))
    assert.deepEqual(streetFootOnEdge(street, ring[0], ring), footReference(street, ring), `street ${k}`)
  }
})
