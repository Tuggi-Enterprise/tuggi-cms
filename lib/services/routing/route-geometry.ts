/**
 * Stored route geometry vs. waypoints — the one place that decides whether a saved route's
 * line may be regenerated (#790).
 *
 * `core.custom_routes.geometry` is the SSOT of the route's line. The waypoints are stops along
 * it, not its shape: a KML import has 10k+ line points and ~16 stops, so rebuilding the line
 * from the stops silently destroys it. The editor (RouteEditorModal) and the save path
 * (RouteService.updateRoute) both ask this module, so they cannot disagree.
 *
 * Pure module: safe to import from client components.
 */

import type { LatLng } from './OSRMService'

/** `metadata.source` values whose `snap_to_roads` state can be inferred from the stored row. */
const SNAP_BY_SOURCE: Record<string, boolean> = { osrm: true, manual: false }

/**
 * Whether the stored line was snapped to roads, from `metadata.source`.
 * `undefined` for imported/unknown sources (e.g. `kml`): there is no snap state to compare,
 * so a toggle alone never regenerates such a route.
 */
export function storedSnapToRoads(source: string | undefined): boolean | undefined {
  return source ? SNAP_BY_SOURCE[source] : undefined
}

/** Same stops, same order, same coordinates. Names and per-stop metadata are ignored. */
export function samePath(a: LatLng[] | undefined | null, b: LatLng[] | undefined | null): boolean {
  const x = a ?? []
  const y = b ?? []
  if (x.length !== y.length) return false
  return x.every((p, i) => Number(p.lat) === Number(y[i].lat) && Number(p.lng) === Number(y[i].lng))
}

/**
 * The stored line must be regenerated only when the path changed, or when the snap toggle
 * changed on a route whose snap state is known. Anything else (name, description,
 * characteristics, translations, stop names) keeps the stored geometry.
 */
export function mustRegenerate(
  stored: { waypoints?: LatLng[] | null; source?: string },
  next: { waypoints: LatLng[]; snapToRoads?: boolean },
): boolean {
  if (!samePath(stored.waypoints, next.waypoints)) return true
  const storedSnap = storedSnapToRoads(stored.source)
  return storedSnap !== undefined && next.snapToRoads !== undefined && next.snapToRoads !== storedSnap
}

/**
 * Reads the stored `geography(LineString, 4326)` as PostgREST serializes it: hex EWKB
 * (the default for geography) or GeoJSON. Throws on anything else — callers must never fall
 * back to rebuilding the line from waypoints.
 */
export function storedLineToLatLngs(geometry: unknown): LatLng[] {
  if (geometry == null || geometry === '') return []
  if (typeof geometry === 'object') return geoJsonLine(geometry as { type?: string; coordinates?: number[][] })
  if (typeof geometry !== 'string') throw new Error('Unsupported route geometry')
  const text = geometry.trim()
  if (text.startsWith('{')) return geoJsonLine(JSON.parse(text))
  if (/^[0-9a-fA-F]+$/.test(text)) return ewkbHexLine(text)
  throw new Error('Unsupported route geometry encoding')
}

function geoJsonLine(g: { type?: string; coordinates?: number[][] }): LatLng[] {
  if (g.type !== 'LineString' || !Array.isArray(g.coordinates)) {
    throw new Error(`Unsupported route geometry type: ${g.type}`)
  }
  return g.coordinates.map(([lng, lat]) => ({ lat, lng }))
}

const EWKB_Z = 0x80000000
const EWKB_M = 0x40000000
const EWKB_SRID = 0x20000000
const WKB_LINESTRING = 2

function ewkbHexLine(hex: string): LatLng[] {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  const view = new DataView(bytes.buffer)
  const le = view.getUint8(0) === 1
  const rawType = view.getUint32(1, le)
  // ISO WKB encodes Z/M as +1000/+2000/+3000 instead of flags.
  const isoDims = Math.floor((rawType & 0xffff) / 1000)
  const baseType = (rawType & 0xffff) % 1000
  if (baseType !== WKB_LINESTRING) throw new Error(`Unsupported route geometry WKB type: ${baseType}`)
  const hasZ = (rawType & EWKB_Z) !== 0 || isoDims === 1 || isoDims === 3
  const hasM = (rawType & EWKB_M) !== 0 || isoDims === 2 || isoDims === 3
  let offset = 5
  if (rawType & EWKB_SRID) offset += 4
  const count = view.getUint32(offset, le)
  offset += 4
  const stride = 8 * (2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0))
  const out: LatLng[] = new Array(count)
  for (let i = 0; i < count; i++) {
    const at = offset + i * stride
    out[i] = { lng: view.getFloat64(at, le), lat: view.getFloat64(at + 8, le) }
  }
  return out
}
