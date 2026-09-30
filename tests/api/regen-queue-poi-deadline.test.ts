/**
 * #779 — no POI holds the TP regen queue (`scripts/regen-trigger-points.ts#runBatch`).
 *
 * Mutations that turn this suite red:
 *  · racing the POI against a timer in the same process — a synchronous loop never yields,
 *    and the timer never fires (the Rio queue sat hours on six relief POIs);
 *  · a timed-out POI that does not say `timeout` — the queue row is how the operator finds it;
 *  · a failed pipeline that exits 0 — the queue would mark it `done`;
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
import { runInChild } from '../../lib/utils/run-in-child'
import { streetFootOnEdge, calculateDistanceToBoundary, closestPointOnPolyline } from '../../lib/services/trigger-points-google/utils/calculations'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-in-child-'))
const script = (name: string, body: string) => {
  const p = path.join(dir, name)
  fs.writeFileSync(p, body)
  return p
}

test('#779 a synchronous loop is killed at the deadline and reported as timeout', async () => {
  const spin = script('spin.mjs', 'const t = Date.now(); while (Date.now() - t < 60_000) {}\n')
  const t0 = Date.now()
  const r = await runInChild(spin, [], 500)
  assert.equal(r.ok, false)
  assert.ok(!r.ok && r.timedOut && r.error.startsWith('timeout'), JSON.stringify(r))
  assert.ok(Date.now() - t0 < 10_000, 'the parent went on long before the loop would end')
})

test('#779 a child that finishes in time is ok', async () => {
  const r = await runInChild(script('ok.mjs', 'process.exit(0)\n'), [], 10_000)
  assert.deepEqual(r, { ok: true })
})

test('#779 a reported failure reaches the parent with its message, not as timeout', async () => {
  const fail = script('fail.mjs', "process.send({ error: 'No trigger points generated' }, () => process.exit(1))\n")
  const r = await runInChild(fail, [], 10_000)
  assert.deepEqual(r, { ok: false, timedOut: false, error: 'No trigger points generated' })
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
