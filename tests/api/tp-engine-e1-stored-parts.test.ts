/**
 * E1 — the stored border read back from `core.get_boundary_geometry` (BR-POI-009, #779).
 *
 * Two engine defects found regenerating Portugal (queue pt-2026-10-05):
 * - a MultiPolygon of N parts (Rio Douro: 39) and a GeometryCollection (polygon + stray line,
 *   Castelo dos Mouros) were read as their first part only;
 * - a border stored with `boundary_source` NULL came back as 'manual', was written back as
 *   'manual' and became curated forever (3,592 borders).
 */
import { describe, it, mock, before } from 'node:test'
import assert from 'node:assert/strict'

type LatLng = { lat: number; lng: number }
const PIN: LatLng = { lat: 38.68, lng: -9.16 }
const M_LAT = 1 / 111_320
const M_LNG = 1 / (111_320 * Math.cos((PIN.lat * Math.PI) / 180))

/** Closed GeoJSON ring ([lng, lat]) of a square of `half` metres around `c`. */
function ring(half: number, c: LatLng) {
  return [[-1, -1], [-1, 1], [1, 1], [1, -1], [-1, -1]].map(([a, b]) => [c.lng + b * half * M_LNG, c.lat + a * half * M_LAT])
}
const away = (eastM: number): LatLng => ({ lat: PIN.lat, lng: PIN.lng + eastM * M_LNG })

let dbRow: { geojson: unknown; boundary_source: string | null; boundary_confidence?: number | null; pin?: LatLng | null }

before(() => {
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabase: () => ({
        schema: () => ({
          rpc: async () => ({ data: dbRow.geojson, error: null }),
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    boundary_source: dbRow.boundary_source,
                    boundary_confidence: dbRow.boundary_confidence ?? null,
                    boundary_area_m2: 99_000_000,
                    latitude: dbRow.pin === null ? null : (dbRow.pin ?? PIN).lat,
                    longitude: dbRow.pin === null ? null : (dbRow.pin ?? PIN).lng,
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    },
  })
})

async function read() {
  const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
  const r = await new BoundaryDetector().fetchBoundaryFromDatabase('x')
  assert.equal(r.success, true, r.error ?? '')
  return r.data!
}

const holds = async (b: { coordinates: LatLng[] }, p: LatLng) => {
  const { isPointInPolygon } = await import('../../lib/services/trigger-points-google/utils/calculations')
  return isPointInPolygon(p, b.coordinates)
}

describe('BR-POI-009 — a multi-part stored border is read as the part holding the pin, never just part 0', () => {
  it('MultiPolygon with the pin in part 2: the border is part 2, and its area is that part, not the stored sum', async () => {
    dbRow = {
      geojson: { type: 'MultiPolygon', coordinates: [[ring(40, away(7500))], [ring(300, away(3000))], [ring(100, PIN)]] },
      boundary_source: 'osm', boundary_confidence: 0.9,
    }
    const b = await read()
    assert.ok(await holds(b, PIN), 'the border holds the pin')
    assert.equal(b.area_m2, await areaOf(ring(100, PIN)))
  })

  it('MultiPolygon with the pin in no part: the largest part, not part 0', async () => {
    dbRow = {
      geojson: { type: 'MultiPolygon', coordinates: [[ring(40, away(7500))], [ring(300, away(3000))]] },
      boundary_source: 'osm', boundary_confidence: 0.9,
    }
    const b = await read()
    assert.ok(await holds(b, away(3000)), 'the largest part')
  })

  it('MultiPolygon with no pin stored: the largest part', async () => {
    dbRow = {
      geojson: { type: 'MultiPolygon', coordinates: [[ring(40, PIN)], [ring(300, away(3000))]] },
      boundary_source: 'osm', boundary_confidence: 0.9, pin: null,
    }
    assert.ok(await holds(await read(), away(3000)))
  })

  it('a hole is not a part: the pin in the hole of part 0 still picks part 0 by area, not the hole ring', async () => {
    dbRow = {
      geojson: { type: 'MultiPolygon', coordinates: [[ring(500, PIN), ring(50, PIN)], [ring(40, away(7500))]] },
      boundary_source: 'osm', boundary_confidence: 0.9,
    }
    const b = await read()
    assert.equal(b.area_m2, await areaOf(ring(500, PIN)))
  })

  it('GeometryCollection polygon + line: the polygon is the border, the line is dropped (Castelo dos Mouros)', async () => {
    const line = [[PIN.lng, PIN.lat], [PIN.lng + 2000 * M_LNG, PIN.lat + 2000 * M_LAT]]
    dbRow = {
      geojson: { type: 'GeometryCollection', geometries: [{ type: 'LineString', coordinates: line }, { type: 'Polygon', coordinates: [ring(100, PIN)] }] },
      boundary_source: 'osm', boundary_confidence: 0.9,
    }
    const b = await read()
    assert.ok(await holds(b, PIN))
    assert.equal(b.coordinates.length, 5, 'the polygon ring, not the line')
    assert.equal(b.synthetic, false)
  })
})

describe('BR-POI-009 — a border stored without a source is not curated', () => {
  const geojson = { type: 'Polygon', coordinates: [ring(100, PIN)] }

  it('boundary_source NULL: not curated, and not read back as manual', async () => {
    dbRow = { geojson, boundary_source: null, boundary_confidence: 0.5 }
    const b = await read()
    assert.equal(b.curated, false)
    assert.notEqual(b.source, 'manual')
    assert.equal(b.source, 'unknown')
  })

  it('a stored manual source, or confidence 1, stays curated (#779)', async () => {
    dbRow = { geojson, boundary_source: 'manual', boundary_confidence: 0.5 }
    assert.equal((await read()).curated, true)
    dbRow = { geojson, boundary_source: 'manual_drawing', boundary_confidence: null }
    assert.equal((await read()).curated, true)
    dbRow = { geojson, boundary_source: null, boundary_confidence: 1 }
    assert.equal((await read()).curated, true)
  })
})

async function areaOf(r: number[][]) {
  const { calculatePolygonAreaInM2 } = await import('../../lib/services/trigger-points-google/utils/calculations')
  return calculatePolygonAreaInM2(r.map(([lng, lat]) => ({ lat, lng })))
}
