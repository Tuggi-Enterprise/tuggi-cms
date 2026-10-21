import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  RING_INDEX_MIN_VERTICES, calculateDistance, calculateDistanceToBoundary, calculateDistanceToPolygon,
  closestPointOnPolyline, closestPointOnSegment, closestStreetPointToPoi, distanceToRingSidesM, findClosestPointOnBoundary,
  isPointInPolygon, nearestRingVertex, spheroidDistanceM, spheroidDistanceToPolygonM, streetFootOnEdge,
} from '@/lib/services/trigger-points-google/utils/calculations'
import { VisibilityMapBuilder } from '@/lib/services/trigger-points-google/analyzers/visibility-map-builder'
import { perimeterPositionM, selectSpacedTriggerPoints } from '@/lib/services/trigger-points-google/utils/tp-selection'
import { VisibilityClass } from '@/lib/services/trigger-points-google/config/visibility-class'
import { buildClassification } from '@/lib/services/trigger-points-google/services/poi-classifier.service'

// TP engine — a border of thousands of vertices (Lago di Como 9 943, Golfo di Taranto 14 323) is read
// through a spatial index of its segments. The index must give the SAME number as the plain loop:
// reach (BR-POI-009 item 1), the inside test (INV-E11) and the perimeter sectors (INV-E10d) depend on it.

type P = { lat: number; lng: number }
let seed = 20261021
const rnd = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31)

const C = { lat: 45.99, lng: 9.26 }
const M_LAT = 110_540
const M_LNG = 111_320 * Math.cos((C.lat * Math.PI) / 180)
const at = (eastM: number, northM: number): P => ({ lat: C.lat + northM / M_LAT, lng: C.lng + eastM / M_LNG })

/** A lake-like ring: a wobbly star, closed like an OSM ring (last vertex = first). */
function lakeRing(n: number): P[] {
  const ring: P[] = []
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n
    const r = 8_000 + 2_500 * Math.sin(5 * a) + 900 * Math.sin(37 * a) + 150 * (rnd() - 0.5)
    ring.push(at(r * Math.cos(a), 1.8 * r * Math.sin(a)))
  }
  ring.push({ ...ring[0] })
  return ring
}

// The plain loops the index replaces, as they were.
const pipRef = (p: P, poly: P[]) => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng, yi = poly[i].lat, xj = poly[j].lng, yj = poly[j].lat
    if (((yi > p.lat) !== (yj > p.lat)) && (p.lng < (xj - xi) * (p.lat - yi) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}
const segRef = (p: P, a: P, b: P) => calculateDistance(p, closestPointOnSegment(p, a, b).point)
const polygonRef = (p: P, poly: P[]) => {
  if (pipRef(p, poly)) return 0
  let m = Infinity
  for (let i = 0; i < poly.length; i++) m = Math.min(m, segRef(p, poly[i], poly[(i + 1) % poly.length]))
  return m
}
const boundaryRef = (p: P, poly: P[]) => {
  if (pipRef(p, poly)) return 0
  let m = Infinity
  for (let i = 0; i < poly.length - 1; i++) m = Math.min(m, segRef(p, poly[i], poly[i + 1]))
  return m
}
const positionRef = (p: P, ring: P[]) => {
  let best = Infinity, pos = 0, walked = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const seg = calculateDistance(ring[i], ring[i + 1])
    const foot = closestPointOnSegment(p, ring[i], ring[i + 1])
    const d = calculateDistance(p, foot.point)
    if (d < best) { best = d; pos = walked + foot.t * seg }
    walked += seg
  }
  return pos
}
const closestOnBoundaryRef = (p: P, poly: P[]) => {
  let point = poly[0], min = calculateDistance(p, point)
  for (const v of poly) { const d = calculateDistance(p, v); if (d < min) { min = d; point = v } }
  for (let i = 0; i < poly.length; i++) {
    const f = closestPointOnSegment(p, poly[i], poly[(i + 1) % poly.length]).point
    const d = calculateDistance(p, f)
    if (d < min) { min = d; point = f }
  }
  return { lat: point.lat, lng: point.lng, distance: min }
}
const vertexRef = (p: P, poly: P[]) => {
  let point = poly[0], min = calculateDistance(p, point)
  for (const v of poly) { const d = calculateDistance(p, v); if (d < min) { min = d; point = v } }
  return point
}
const sidesRef = (p: P, poly: P[]) => {
  let m = Infinity
  for (let i = 0; i < poly.length; i++) m = Math.min(m, segRef(p, poly[i], poly[(i + 1) % poly.length]))
  return m
}
const spheroidRef = (p: P, poly: P[]) => {
  if (pipRef(p, poly)) return 0
  let m = Infinity
  for (let i = 0; i < poly.length; i++) m = Math.min(m, spheroidDistanceM(p, closestPointOnSegment(p, poly[i], poly[(i + 1) % poly.length]).point))
  return m
}
const crossingRef = (from: P, to: P, poly: P[]) => {
  const kx = 111_320 * Math.cos((from.lat * Math.PI) / 180), ky = 110_540
  const xy = (q: P) => ({ x: (q.lng - from.lng) * kx, y: (q.lat - from.lat) * ky })
  const r = xy(to)
  let best: number | null = null
  for (let i = 0; i < poly.length; i++) {
    const a = xy(poly[i]), b = xy(poly[(i + 1) % poly.length])
    const e = { x: b.x - a.x, y: b.y - a.y }
    const den = r.x * e.y - r.y * e.x
    if (den === 0) continue
    const t = (a.x * e.y - a.y * e.x) / den, u = (a.x * r.y - a.y * r.x) / den
    if (t >= 0 && t < 1 && u >= 0 && u <= 1 && (best === null || t > best)) best = t
  }
  return best
}
const streetPointRef = (line: P[], poly: P[]) => {
  let best: { point: P; distance: number } | null = null
  for (const t of poly) {
    const pr = closestPointOnPolyline(t, line)!
    if (!best || pr.distance < best.distance) best = { point: pr.point, distance: pr.distance }
  }
  return best
}
const footRef = (line: P[], ring: P[]) => {
  const seeds = [...line, ...ring.map(t => closestPointOnPolyline(t, line)!.point)]
  return Math.min(...seeds.map(s => boundaryRef(s, ring)))
}

const ring = lakeRing(4_000)
const nearEdge = (): P => {
  const v = ring[Math.floor(rnd() * (ring.length - 1))]
  return { lat: v.lat + ((rnd() - 0.5) * 3_000) / M_LAT, lng: v.lng + ((rnd() - 0.5) * 3_000) / M_LNG }
}
const anywhere = (): P => at((rnd() - 0.5) * 30_000, (rnd() - 0.5) * 50_000)

describe('BR-POI-009, INV-E11 — the ring index gives the plain loop\'s number on a large border', () => {
  it('the ring is large enough to be indexed', () => {
    assert.ok(ring.length >= RING_INDEX_MIN_VERTICES)
  })

  it('inside test, distance to the polygon and to the boundary: identical on 500 points near and far', () => {
    for (let i = 0; i < 500; i++) {
      const p = i % 4 === 0 ? anywhere() : nearEdge()
      assert.equal(isPointInPolygon(p, ring), pipRef(p, ring))
      assert.equal(calculateDistanceToPolygon(p, ring), polygonRef(p, ring))
      assert.equal(calculateDistanceToBoundary(p, ring), boundaryRef(p, ring))
      assert.equal(spheroidDistanceToPolygonM(p, ring), spheroidRef(p, ring))
      assert.deepEqual(findClosestPointOnBoundary(p, ring), closestOnBoundaryRef(p, ring))
      assert.equal(nearestRingVertex(p, ring).point, vertexRef(p, ring))
      assert.equal(distanceToRingSidesM(p, ring), sidesRef(p, ring))
    }
  })

  it('INV-E8b — last crossing of the sight line with the footprint: identical on 500 lines', () => {
    for (let i = 0; i < 500; i++) {
      const from = i % 2 ? C : nearEdge()
      const to = i % 3 ? nearEdge() : anywhere()
      assert.equal(VisibilityMapBuilder.lastCrossingT(from, to, ring), crossingRef(from, to, ring))
    }
  })

  it('INV-E10d — perimeter position (the sector of a candidate): identical on 300 points', () => {
    for (let i = 0; i < 300; i++) {
      const p = nearEdge()
      assert.equal(perimeterPositionM(p, ring), positionRef(p, ring))
    }
  })

  it('street foot on the edge and street point closest to the edge: same as projecting every edge vertex (40 streets)', () => {
    const small = lakeRing(RING_INDEX_MIN_VERTICES + 100)
    for (let i = 0; i < 40; i++) {
      const v = small[Math.floor(rnd() * (small.length - 1))]
      const start = { lat: v.lat + ((rnd() - 0.5) * 3_000) / M_LAT, lng: v.lng + ((rnd() - 0.5) * 3_000) / M_LNG }
      const heading = rnd() * 2 * Math.PI
      const line = Array.from({ length: 2 + Math.floor(rnd() * 20) }, (_, k) => ({
        lat: start.lat + (Math.cos(heading) * k * 80 + (rnd() - 0.5) * 30) / M_LAT,
        lng: start.lng + (Math.sin(heading) * k * 80 + (rnd() - 0.5) * 30) / M_LNG,
      }))
      const got = streetFootOnEdge(line, C, small)!.edgeDistanceM
      const want = footRef(line, small)
      assert.ok(Math.abs(got - want) < 1e-6, `street ${i}: ${got} vs ${want}`)
      assert.deepEqual(closestStreetPointToPoi({ coordinates: line }, C, ring), streetPointRef(line, ring))
    }
  })
})

describe('INV-E10d, BR-POI-009 — selection over a large border ends in seconds', () => {
  it('2 500 far candidates on a 6 000-vertex edge: the far pass no longer re-sorts the pool every turn', () => {
    const edge = lakeRing(6_000)
    const area = buildClassification(VisibilityClass.AREA, { heightM: 2, prominenceM: 0, areaM2: 2e8 })
    const tps = Array.from({ length: 2_500 }, (_, i) => {
      const v = edge[Math.floor((i / 2_500) * (edge.length - 1))]
      const m = 200 + (i % 7) * 150
      const location = { lat: v.lat + m / M_LAT, lng: v.lng }
      return { id: `f${i}`, location, distance: m, radius: 30, quality: 0.5 + (i % 5) / 10,
        expectedBearing: 180, street: { type: i % 3 ? 'primary' : 'ferry' } } as any
    })
    const t0 = Date.now()
    const out = selectSpacedTriggerPoints(tps, area, C, new Map(), edge)
    const ms = Date.now() - t0
    assert.ok(out.length > 0)
    // Before (2026-10-21) the same input did not end: every turn sorted the pool reading the sector
    // of each candidate over the whole edge per comparison.
    assert.ok(ms < 30_000, `${ms} ms`)
  })
})
