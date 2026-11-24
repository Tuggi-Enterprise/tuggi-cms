/**
 * #1203: the network side of the Chile scripts, with a local cache so the operator never repeats
 * a call. Public Overpass and Nominatim only, small queries, retry with exponential backoff, and
 * no PBF import on the Mac.
 *
 * Cache: output/chile-1203/ under the directory the script runs from (tuggi-cms/). `output/` is
 * gitignored. Delete a file to fetch it again.
 */
import fs from 'node:fs'
import path from 'node:path'
import { OSRMService } from '../services/routing/OSRMService'
import { type LatLng, type RawAdminArea, type AreaGeometry, type BBox, type AdminAreas, buildAdminAreas } from './admin-areas'
import { calculateDistance } from '../services/trigger-points-google/utils/calculations'
import type { OsmTags } from './osm-tags'

export const CACHE_DIR = path.resolve(process.cwd(), 'output', 'chile-1203')
const USER_AGENT = 'tuggi-cms/1.0 (+https://tuggi.app)'

/**
 * Three public instances. overpass-api.de answered "at capacity" (502) on 2026-11-11 while
 * private.coffee answered the same query; rotating keeps one busy server from failing the run.
 */
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const NOMINATIM_LOOKUP = 'https://nominatim.openstreetmap.org/lookup'

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

export function cachePath(name: string): string {
  return path.join(CACHE_DIR, name)
}

export async function cachedJson<T>(name: string, produce: () => Promise<T>): Promise<T> {
  const file = cachePath(name)
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  const value = await produce()
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value))
  return value
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Writes rows as CSV under the cache dir and returns the absolute path. */
export function writeCsv(name: string, header: string[], rows: unknown[][]): string {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const file = cachePath(name)
  fs.writeFileSync(file, [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n')
  return file
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504])

/** Fetch with retry and exponential backoff (5 s, 10 s, 20 s, 40 s, 60 s). Throws on the last failure. */
async function fetchWithRetry(urls: string[], init: RequestInit, label: string, attempts = 6): Promise<unknown> {
  let lastError = ''
  for (let i = 0; i < attempts; i++) {
    const url = urls[i % urls.length]
    try {
      // Overpass stops itself at the [timeout:180] of the query; the client gives it one more minute.
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(240_000), headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) } })
      const body = await res.text()
      const looksJson = /^[[{]/.test(body.trimStart())
      if (res.ok && looksJson) {
        const json = JSON.parse(body)
        // Overpass reports a query timeout inside a 200 with a `remark`; the element list is then partial.
        if (json && typeof json === 'object' && typeof (json as { remark?: unknown }).remark === 'string' && /runtime error|timeout|out of memory/i.test((json as { remark: string }).remark)) {
          lastError = `${label}: ${(json as { remark: string }).remark}`
        } else {
          return json
        }
      } else if (!res.ok && !RETRY_STATUS.has(res.status)) {
        throw new Error(`${label}: HTTP ${res.status} ${body.slice(0, 200)}`)
      } else {
        lastError = `${label}: HTTP ${res.status} ${body.slice(0, 120).replace(/\s+/g, ' ')}`
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith(`${label}: HTTP`)) throw e
      lastError = `${label}: ${e instanceof Error ? e.message : String(e)}`
    }
    if (i === attempts - 1) break
    const wait = Math.min(60_000, 5_000 * 2 ** i)
    console.warn(`  retry ${i + 1}/${attempts - 1} in ${wait / 1000}s (${lastError})`)
    await sleep(wait)
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError}`)
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number }
  tags?: OsmTags
}

export async function overpass(query: string, label: string): Promise<OverpassElement[]> {
  const json = await fetchWithRetry(OVERPASS_ENDPOINTS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  }, label) as { elements?: OverpassElement[] }
  if (!Array.isArray(json.elements)) throw new Error(`${label}: Overpass answer without elements`)
  return json.elements
}

/** An OSM element reduced to what the scripts read: identity, a point, tags and box area. */
export interface OsmElement {
  osmType: 'node' | 'way' | 'relation'
  osmId: number
  lat: number
  lng: number
  tags: OsmTags
  name: string
  altNames: string[]
  bboxAreaM2: number | null
}

export function toOsmElement(e: OverpassElement): OsmElement | null {
  const tags = e.tags ?? {}
  let lat: number, lng: number, area: number | null = null
  if (typeof e.lat === 'number' && typeof e.lon === 'number') {
    lat = e.lat; lng = e.lon
  } else if (e.bounds) {
    const b = e.bounds
    lat = (b.minlat + b.maxlat) / 2
    lng = (b.minlon + b.maxlon) / 2
    area = calculateDistance({ lat: b.minlat, lng }, { lat: b.maxlat, lng }) *
      calculateDistance({ lat, lng: b.minlon }, { lat, lng: b.maxlon })
  } else {
    return null
  }
  const altNames = ['alt_name', 'official_name', 'name:es', 'old_name', 'short_name']
    .map(k => tags[k]).filter((v): v is string => !!v)
  return { osmType: e.type, osmId: e.id, lat, lng, tags, name: tags.name ?? '', altNames, bboxAreaM2: area }
}

export function bboxClause(b: BBox): string {
  const f = (n: number) => n.toFixed(5)
  return `${f(b.minLat)},${f(b.minLng)},${f(b.maxLat)},${f(b.maxLng)}`
}

// ─── Chile administrative boundaries ────────────────────────────────────────────────────────

interface NominatimLookupHit {
  osm_type: string
  osm_id: number
  address?: { country_code?: string }
  geojson?: { type: string; coordinates: unknown }
}

/**
 * The 16 regiones and the 346 comunas, once. Overpass lists the relations (tags only, small);
 * Nominatim /lookup brings the assembled polygons 50 at a time (the documented maximum), simplified
 * at 0.0001 degree (about 11 m). The country filter matters: `rel(area)` also returns an Argentine
 * province that shares border ways, so regiones keep ISO3166-2 CL-* and every boundary keeps
 * Nominatim country_code cl.
 */
export async function fetchChileAdminAreas(): Promise<RawAdminArea[]> {
  return cachedJson('admin-areas.json', async () => {
    console.log('Downloading Chile administrative boundaries (once; cached in output/chile-1203/admin-areas.json)')
    const rels = await overpass(
      '[out:json][timeout:120];area["ISO3166-1"="CL"]["admin_level"="2"]->.cl;' +
      'rel(area.cl)["boundary"="administrative"]["admin_level"~"^(4|8)$"];out tags;',
      'overpass chile admin list',
    )
    const wanted = rels.filter(r => {
      const t = r.tags ?? {}
      if (t.admin_level === '4') return (t['ISO3166-2'] ?? '').startsWith('CL-')
      return t.admin_level === '8'
    })
    const meta = new Map(wanted.map(r => [r.id, r.tags ?? {}]))
    const out: RawAdminArea[] = []
    const ids = wanted.map(r => r.id)
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50)
      const url = `${NOMINATIM_LOOKUP}?format=jsonv2&addressdetails=1&polygon_geojson=1&polygon_threshold=0.0001&osm_ids=${chunk.map(id => `R${id}`).join(',')}`
      const hits = await fetchWithRetry([url], { method: 'GET' }, `nominatim lookup ${i / 50 + 1}`) as NominatimLookupHit[]
      for (const h of hits) {
        const t = meta.get(h.osm_id)
        if (!t || h.osm_type !== 'relation') continue
        if (h.address?.country_code !== 'cl') continue
        if (h.geojson?.type !== 'Polygon' && h.geojson?.type !== 'MultiPolygon') continue
        out.push({ osmId: h.osm_id, level: t.admin_level === '4' ? 4 : 8, name: t.name ?? '', geometry: h.geojson as AreaGeometry })
      }
      console.log(`  boundaries ${Math.min(i + 50, ids.length)}/${ids.length}`)
      await sleep(1100) // Nominatim usage policy: at most one request per second
    }
    const regions = out.filter(a => a.level === 4).length
    console.log(`  ${regions} regiones, ${out.length - regions} comunas with polygon`)
    if (regions !== 16) throw new Error(`expected 16 Chilean regiones, got ${regions}; delete the cache and retry`)
    return out
  })
}

export async function loadChileAdminAreas(): Promise<AdminAreas> {
  return buildAdminAreas(await fetchChileAdminAreas())
}

// ─── Route corridors ────────────────────────────────────────────────────────────────────────

/** Keep a vertex only when it is MIN_STEP_M from the last kept one: a 2 km band does not need more. */
const MIN_STEP_M = 250

export function decimate(line: LatLng[], minStepM = MIN_STEP_M): LatLng[] {
  if (line.length <= 2) return line
  const out = [line[0]]
  for (let i = 1; i < line.length - 1; i++) {
    if (calculateDistance(out[out.length - 1], line[i]) >= minStepM) out.push(line[i])
  }
  out.push(line[line.length - 1])
  return out
}

export async function corridorLine(key: string, waypoints: LatLng[]): Promise<LatLng[]> {
  return cachedJson(`corridor-${key}.json`, async () => {
    const route = await OSRMService.getRoute(waypoints)
    await sleep(1100)
    return decimate(route.coordinates)
  })
}
