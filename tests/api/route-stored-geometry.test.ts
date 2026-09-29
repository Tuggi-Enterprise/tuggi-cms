/**
 * Saving a route in the CMS never rebuilds a stored line it was not asked to rebuild — #790.
 *
 * Incident 2026-09-29: "Circuito de Cicloturismo Costa do Sol" was stored from a KML (10,497
 * line points, 636 km, 16 stops, metadata.source = 'kml'). The editor recomputed the line from
 * the 16 stops on open (~500 km) and RouteService.updateRoute rewrote the geometry from the stops
 * on save, replacing the KML line.
 *
 * Run with: npm run test:api
 */

import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { RouteService } from '../../lib/services/route-service'
import { OSRMService } from '../../lib/services/routing/OSRMService'
import { mustRegenerate, storedLineToLatLngs } from '../../lib/services/routing/route-geometry'

const ROUTE_ID = 'baba4a85-c6b6-4f2a-a00a-11f53cde2d45'

/** Hex EWKB of a LINESTRING with SRID 4326, little-endian — what PostgREST returns for geography. */
function ewkbHex(points: Array<[number, number]>): string {
  const buf = Buffer.alloc(1 + 4 + 4 + 4 + points.length * 16)
  buf.writeUInt8(1, 0)
  buf.writeUInt32LE(0x20000002, 1)
  buf.writeUInt32LE(4326, 5)
  buf.writeUInt32LE(points.length, 9)
  points.forEach(([lng, lat], i) => {
    buf.writeDoubleLE(lng, 13 + i * 16)
    buf.writeDoubleLE(lat, 21 + i * 16)
  })
  return buf.toString('hex')
}

// A dense line (the KML trace) and three stops along it.
const LINE: Array<[number, number]> = [
  [-42.0191, -22.8791], [-42.0183, -22.8785], [-42.0177, -22.8779], [-42.0101, -22.8702],
  [-41.9905, -22.8601], [-41.9870, -22.8544],
]
const STOPS = [
  { lat: -22.8791, lng: -42.0191, name: 'Cabo Frio' },
  { lat: -22.8702, lng: -42.0101, name: 'Parada' },
  { lat: -22.8544, lng: -41.9870, name: 'Arraial' },
]

function storedRoute(source: string) {
  return {
    id: ROUTE_ID,
    name: 'Circuito de Cicloturismo Costa do Sol',
    client_id: 'c1',
    geometry: ewkbHex(LINE),
    waypoints: STOPS,
    metadata: { distance: 636000, source, partner: 'Cicloturismo Costa do Sol' },
    is_active: true,
  }
}

/** Fake supabase: get_custom_route returns `row`; upsert_custom_route is captured. */
function fakeSupabase(row: Record<string, unknown>) {
  const calls: { upsert?: Record<string, any> } = {}
  const client: any = {
    schema: () => ({
      rpc: async (fn: string, args: Record<string, any>) => {
        if (fn === 'get_custom_route') return { data: row, error: null }
        if (fn === 'upsert_custom_route') { calls.upsert = args; return { data: { ...row, id: ROUTE_ID }, error: null } }
        throw new Error(`unexpected rpc ${fn}`)
      },
      from: () => ({ insert: async () => ({ error: null }) }),
    }),
  }
  return { client, calls }
}

const LINE_WKT = OSRMService.toWKT(LINE.map(([lng, lat]) => ({ lat, lng })))

test('#790 stored hex EWKB line is read back point by point', () => {
  const coords = storedLineToLatLngs(ewkbHex(LINE))
  assert.equal(coords.length, LINE.length)
  assert.deepEqual(coords[3], { lng: -42.0101, lat: -22.8702 })
})

test('#790 updateRoute with the same stops keeps the stored KML line and metadata', async () => {
  const osrm = mock.method(OSRMService, 'getRoute', async () => { throw new Error('must not route') })
  const { client, calls } = fakeSupabase(storedRoute('kml'))
  // What the editor sends: same stops (renamed, extra fields), snap toggle on, new name.
  await RouteService.updateRoute(client, ROUTE_ID, {
    name: 'Novo nome',
    waypoints: STOPS.map(s => ({ ...s, id: 'x', metadata: { name: 'renamed' } }) as any),
    snap_to_roads: true,
  }, 'user-1')
  assert.equal(osrm.mock.callCount(), 0)
  assert.equal(calls.upsert!.p_geometry_wkt, LINE_WKT)
  assert.deepEqual(calls.upsert!.p_metadata, storedRoute('kml').metadata)
  assert.equal(calls.upsert!.p_name, 'Novo nome')
  osrm.mock.restore()
})

test('#790 updateRoute with different stops recalculates the line', async () => {
  const { client, calls } = fakeSupabase(storedRoute('manual'))
  const moved = [STOPS[0], { lat: -22.9, lng: -42.1 }, STOPS[2]]
  await RouteService.updateRoute(client, ROUTE_ID, { waypoints: moved, snap_to_roads: false }, 'user-1')
  assert.equal(calls.upsert!.p_geometry_wkt, OSRMService.toWKT(moved))
  assert.equal(calls.upsert!.p_metadata.source, 'manual')
})

test('#790 updateRoute recalculates when the known snap state changes', async () => {
  const osrm = mock.method(OSRMService, 'getRoute', async () => ({
    coordinates: [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }], distance: 1234, duration: 99,
  }) as any)
  const { client, calls } = fakeSupabase(storedRoute('manual'))
  await RouteService.updateRoute(client, ROUTE_ID, { waypoints: STOPS, snap_to_roads: true }, 'user-1')
  assert.equal(osrm.mock.callCount(), 1)
  assert.equal(calls.upsert!.p_geometry_wkt, OSRMService.toWKT([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }]))
  assert.equal(calls.upsert!.p_metadata.distance, 1234)
  assert.equal(calls.upsert!.p_metadata.partner, 'Cicloturismo Costa do Sol')
  osrm.mock.restore()
})

test('#790 the editor opening a stored route does not regenerate it', () => {
  const stored = { waypoints: STOPS, source: 'kml' }
  // Loaded state: same stops, snap toggle defaults on — no /api/routes/generate.
  assert.equal(mustRegenerate(stored, { waypoints: STOPS, snapToRoads: true }), false)
  assert.equal(mustRegenerate(stored, { waypoints: STOPS, snapToRoads: false }), false)
  assert.equal(mustRegenerate(stored, { waypoints: STOPS.slice(0, 2), snapToRoads: true }), true)
  assert.equal(mustRegenerate({ waypoints: STOPS, source: 'osrm' }, { waypoints: STOPS, snapToRoads: false }), true)
})

test('#790 RouteEditorModal gates /api/routes/generate and the KML save behind mustRegenerate', () => {
  const src = readFileSync(resolve(import.meta.dirname, '../../components/routes/RouteEditorModal.tsx'), 'utf8')
  const effect = src.slice(src.indexOf('async function generate()'), src.indexOf("fetch('/api/routes/generate'"))
  assert.match(effect, /!mustRegenerate\(stored, \{ waypoints, snapToRoads \}\)[\s\S]*return/)
  assert.match(src, /setRouteGeometry\(route\.geometry_coords \|\| \[\]\)/)
  assert.match(src, /source === 'kml' && mustRegenerate[\s\S]{0,120}window\.confirm\(t\('kml_geometry_confirm'\)\)/)
  // The list reads the stored distance, untouched by the editor.
  const list = readFileSync(resolve(import.meta.dirname, '../../app/[locale]/routes/page.tsx'), 'utf8')
  assert.match(list, /route\.metadata\?\.distance/)
})
