/**
 * santiago-routes.ts (#1203, item 5). The six routes around Santiago, public in the discovery
 * (BR-ROTA-003), in the mould of create-rio-maravilhas.ts: stops defined here, each one linked to the
 * POI of core.attractions it stands for, path routed by OSRM, row written in core.custom_routes.
 *
 * Why not RouteService.createRoute: its RPC core.upsert_custom_route takes the CMS user from the JWT
 * email and refuses the secret key ("CMS user not found"), so a script writes the row directly, as
 * the Rio script does. Country, region and travel_mode go in the same insert.
 *
 * Stop to POI: same name (folded) within 200 m, the nearest (lib/osm-chile/routes.ts matchStop).
 * A stop with no POI stays generic and is listed. POIs created by santiago-missing-pois-from-osm.ts
 * are born approved = false: they are linked anyway and the report marks them.
 *
 * Idempotent by metadata.route_key: a second run creates nothing and only writes the links that
 * changed, which is how a run after santiago-missing-pois-from-osm.ts links the new POIs. A route
 * whose stops were edited in the CMS is left alone. --force soft deletes and creates again.
 *
 * Translations: with --apply, each route created by the run goes to the Edge Function
 * generate-translated-audio (the one behind /api/routes/[id]/translations/generate) in the
 * DEFAULT_SELECTED_LANGS, text only (generateAudio false). If the function refuses the secret key,
 * the run says so and the curator uses the Traduções panel of the route in the CMS.
 *
 * Usage (from tuggi-cms/):
 *   npx tsx --env-file=.env scripts/santiago-routes.ts               # dry run (default)
 *   npx tsx --env-file=.env scripts/santiago-routes.ts --apply       # writes
 *   npx tsx --env-file=.env scripts/santiago-routes.ts --apply --force
 */
import { createHash } from 'node:crypto'
import { createCoreDb, type CoreDb } from '../lib/osm-chile/catalogue'
import { cachedJson, writeCsv } from '../lib/osm-chile/osm-sources'
import {
  ROUTES_COUNTRY, ROUTES_REGION_RAW, ROUTES_SCRIPT, ROUTES_VISIBILITY, SANTIAGO_ROUTES, STOP_MATCH_RADIUS_M,
  type EnrichedWaypoint, type PoiCandidate, type RouteSpec, buildWaypoints, matchStop, planRoute,
} from '../lib/osm-chile/routes'
import { OSRMService, type RouteResult } from '../lib/services/routing/OSRMService'
import { normalizeState } from '../lib/shared/location-normalize'
import { DEFAULT_SELECTED_LANGS } from '../lib/constants/route-languages'

const APPLY = process.argv.includes('--apply') && !process.argv.includes('--dry-run')
const FORCE = process.argv.includes('--force')
const REGION = normalizeState(ROUTES_COUNTRY, ROUTES_REGION_RAW)
/** ~280 m of latitude: the box the 200 m circle is cut from. */
const BOX_DEG = 0.0025

function env(name: string): string {
  return (process.env[name] ?? '').trim()
}

async function candidatesNear(db: CoreDb, lat: number, lng: number): Promise<PoiCandidate[]> {
  const dLng = BOX_DEG / Math.cos((lat * Math.PI) / 180)
  const { data, error } = await db.from('attraction_coordinate')
    .select('attraction_id, latitude, longitude, attractions!inner(id, name, approved, entity_kind, is_active)')
    .gte('latitude', lat - BOX_DEG).lte('latitude', lat + BOX_DEG)
    .gte('longitude', lng - dLng).lte('longitude', lng + dLng)
    .eq('attractions.entity_kind', 'poi')
    .limit(500)
  if (error) throw new Error(`attraction_coordinate near ${lat},${lng}: ${error.message}`)
  return ((data ?? []) as Array<Record<string, unknown>>).flatMap(r => {
    const a = (Array.isArray(r.attractions) ? r.attractions[0] : r.attractions) as
      { id: string; name: string | null; approved: boolean | null; is_active: boolean | null } | null
    if (!a?.name || a.is_active === false) return []
    return [{ id: a.id, name: a.name, approved: a.approved, lat: r.latitude as number, lng: r.longitude as number }]
  })
}

/** The OSRM path of the stops, cached by stops and profile so a dry run and the run share one call. */
async function routed(spec: RouteSpec): Promise<RouteResult> {
  const profile = spec.travelMode === 'walk' ? 'foot' : 'driving'
  const points = spec.stops.map(s => ({ lat: s.lat, lng: s.lng }))
  const hash = createHash('sha256').update(JSON.stringify({ profile, points })).digest('hex').slice(0, 12)
  return cachedJson(`route-${spec.key}-${hash}.json`, () => OSRMService.getRoute(points, profile))
}

async function existingRoute(db: CoreDb, spec: RouteSpec): Promise<{ id: string; waypoints: unknown } | null> {
  const { data, error } = await db.from('custom_routes').select('id, waypoints')
    .eq('metadata->>route_key', spec.key).eq('is_active', true)
  if (error) throw new Error(`custom_routes ${spec.key}: ${error.message}`)
  const rows = (data ?? []) as Array<{ id: string; waypoints: unknown }>
  if (rows.length > 1) throw new Error(`${rows.length} active routes with route_key ${spec.key}; deactivate the extra ones in the CMS first`)
  return rows[0] ?? null
}

async function adminUserId(db: CoreDb): Promise<string | null> {
  const { data: byEmail, error } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  if (error) throw new Error(`cms_users: ${error.message}`)
  if (byEmail?.id) return byEmail.id as string
  const { data: anyAdmin, error: e2 } = await db.from('cms_users').select('id').eq('role', 'admin').eq('is_active', true).limit(1).maybeSingle()
  if (e2) throw new Error(`cms_users: ${e2.message}`)
  return (anyAdmin?.id as string | undefined) ?? null
}

function counts(waypoints: EnrichedWaypoint[]) {
  const linked = waypoints.filter(w => !w.metadata.is_generic).length
  return { linked_pois: linked, generic_stops: waypoints.length - linked }
}

async function insertRoute(db: CoreDb, spec: RouteSpec, waypoints: EnrichedWaypoint[], path: RouteResult, adminId: string | null): Promise<string> {
  const { data, error } = await db.from('custom_routes').insert({
    name: spec.name,
    description: spec.description,
    client_id: null,
    geometry: OSRMService.toWKT(path.coordinates),
    waypoints,
    metadata: {
      source: 'osrm',
      distance: path.distance,
      duration: path.duration,
      script: ROUTES_SCRIPT,
      route_key: spec.key,
      card: '#1203',
      generated_at: new Date().toISOString(),
      ...counts(waypoints),
    },
    is_active: true,
    accessibility: 'unknown',
    drivability: 'unknown',
    scenic_profile: spec.scenicProfile,
    best_time: [],
    road_conditions: [],
    resources: {},
    photogenic_rating: 'unknown',
    stops_count: waypoints.length,
    visibility: ROUTES_VISIBILITY,
    travel_mode: spec.travelMode,
    country: ROUTES_COUNTRY,
    region: REGION,
    created_by: adminId,
    updated_by: adminId,
  }).select('id').single()
  if (error) throw new Error(`insert ${spec.key}: ${error.code ?? ''} ${error.message}`)
  return (data as { id: string }).id
}

/** Text translations through the Edge Function the CMS panel calls. Answers the languages that came back ok. */
async function translate(routeId: string): Promise<{ ok: string[]; refused: string | null }> {
  const url = env('NEXT_PUBLIC_SUPABASE_URL') || env('SUPABASE_URL')
  const key = env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY')
  const ok: string[] = []
  for (const language of DEFAULT_SELECTED_LANGS) {
    const res = await fetch(`${url}/functions/v1/generate-translated-audio`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ routeId, targetLanguage: language, voiceGender: 'male', generateAudio: false }),
      signal: AbortSignal.timeout(90_000),
    })
    const text = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) return { ok, refused: `http_${res.status}` }
    if (!res.ok) console.error(`    ${language}: http_${res.status} ${text.slice(0, 120)}`)
    else ok.push(language)
  }
  return { ok, refused: null }
}

async function main() {
  const db = createCoreDb()
  console.log(`\n${APPLY ? '[APPLY]' : '[DRY RUN]'}${FORCE ? ' --force' : ''} ${SANTIAGO_ROUTES.length} routes | ${ROUTES_COUNTRY}, ${REGION} | public`)

  const report: unknown[][] = []
  const work: Array<{ spec: RouteSpec; waypoints: EnrichedWaypoint[]; plan: ReturnType<typeof planRoute>; path: RouteResult }> = []
  for (const spec of SANTIAGO_ROUTES) {
    const existing = await existingRoute(db, spec)
    const matches: Array<PoiCandidate | null> = []
    for (const stop of spec.stops) matches.push(matchStop(stop, await candidatesNear(db, stop.lat, stop.lng)))
    const waypoints = buildWaypoints(spec.stops, matches, existing && Array.isArray(existing.waypoints) ? existing.waypoints as EnrichedWaypoint[] : null)
    const plan = planRoute(existing, spec.stops, waypoints, FORCE)
    const path = await routed(spec)
    work.push({ spec, waypoints, plan, path })

    console.log(`\n${spec.name} [${spec.key}] ${spec.travelMode} | ${(path.distance / 1000).toFixed(1)} km, ${Math.round(path.duration / 60)} min | ${plan.action}${'routeId' in plan ? ` ${plan.routeId}` : ''}`)
    spec.stops.forEach((stop, i) => {
      const m = matches[i]
      const mark = !m ? `generic (no POI with this name within ${STOP_MATCH_RADIUS_M} m)` : `POI ${m.name} ${m.id}${m.approved ? '' : ' NOT APPROVED'}`
      console.log(`  ${i + 1}. ${stop.name.padEnd(38)} ${mark}`)
      report.push([spec.key, i + 1, stop.name, stop.lat, stop.lng, m?.id ?? '', m?.name ?? '', m ? (m.approved ? 'yes' : 'no') : '', plan.action])
    })
  }
  const csv = writeCsv('routes-plan.csv', ['route_key', 'order', 'stop', 'lat', 'lng', 'poi_id', 'poi_name', 'poi_approved', 'action'], report)
  console.log(`\ncsv: ${csv}`)

  if (!APPLY) { console.log('Dry run: nothing written. Add --apply to write.\n'); return }

  const adminId = await adminUserId(db)
  const created: string[] = []
  const touched: string[] = []
  for (const { spec, waypoints, plan, path } of work) {
    if (plan.action === 'unchanged' || plan.action === 'edited_in_cms') continue
    if (plan.action === 'recreate') {
      const { error } = await db.from('custom_routes').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', plan.routeId)
      if (error) throw new Error(`deactivate ${spec.key}: ${error.message}`)
    }
    if (plan.action === 'update_links') {
      const { data: row, error: readError } = await db.from('custom_routes').select('metadata').eq('id', plan.routeId).single()
      if (readError) throw new Error(`read ${spec.key}: ${readError.message}`)
      const metadata = { ...((row as { metadata: Record<string, unknown> | null }).metadata ?? {}), ...counts(waypoints) }
      const { error } = await db.from('custom_routes')
        .update({ waypoints, metadata, updated_by: adminId, updated_at: new Date().toISOString() }).eq('id', plan.routeId)
      if (error) throw new Error(`update ${spec.key}: ${error.message}`)
      touched.push(plan.routeId)
      continue
    }
    const id = await insertRoute(db, spec, waypoints, path, adminId)
    created.push(id)
    touched.push(id)
  }

  // Re-read: what is in the table now, not what the calls answered.
  const { data, error } = await db.from('custom_routes')
    .select('id, name, slug, visibility, status, travel_mode, country, region, stops_count, waypoints')
    .in('metadata->>route_key', SANTIAGO_ROUTES.map(s => s.key)).eq('is_active', true)
  if (error) throw new Error(`re-read: ${error.message}`)
  const rows = (data ?? []) as Array<{ id: string; name: string; slug: string | null; visibility: string; status: string | null; travel_mode: string; country: string; region: string; stops_count: number; waypoints: EnrichedWaypoint[] }>
  console.log(`\nRe-read: ${rows.length}/${SANTIAGO_ROUTES.length} active routes (${created.length} created, ${touched.length - created.length} links updated)`)
  for (const r of rows) {
    const linked = r.waypoints.filter(w => w.metadata?.attraction_id).length
    console.log(`  ${r.id} | ${r.name} | /r/${r.slug} | ${r.visibility} ${r.status ?? ''} | ${r.travel_mode} | ${r.country}, ${r.region} | ${linked}/${r.stops_count} stops linked`)
  }
  const wrong = rows.filter(r => r.visibility !== ROUTES_VISIBILITY || r.country !== ROUTES_COUNTRY || r.region !== REGION)
  if (rows.length !== SANTIAGO_ROUTES.length || wrong.length) {
    console.error('Some routes are missing or not public with Chile and the region: check the lines above.')
    process.exit(1)
  }

  for (const id of created) {
    const { ok, refused } = await translate(id)
    if (refused) {
      console.error(`\nTranslations: the Edge Function refused the secret key (${refused}). Open each new route in the CMS, Traduções, and generate.`)
      break
    }
    const { data: tr, error: trError } = await db.from('custom_route_descriptions').select('language').eq('route_id', id).eq('status', 'ready')
    if (trError) throw new Error(`custom_route_descriptions: ${trError.message}`)
    console.log(`  translations of ${id}: asked ${ok.join(', ') || 'none'}; ready in the table: ${((tr ?? []) as Array<{ language: string }>).map(t => t.language).join(', ') || 'none'}`)
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e instanceof Error ? e.message : e); process.exit(1) })
