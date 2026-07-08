/**
 * create-buzios-rota-religiosa.ts
 *
 * (1) Adiciona 2 igrejas-âncora que faltavam (OSM-first): Igreja Matriz de Santa
 *     Rita de Cássia e Igreja São José. (2) Cria a "Rota Religiosa de Búzios" em
 *     core.custom_routes (driving, OSRM), circuito de peregrinação ligando as 5
 *     igrejas notáveis existentes. Trigger Points → manuais.
 *
 * Uso:  npx tsx --env-file=.env scripts/create-buzios-rota-religiosa.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'
import { OSRMService, LatLng } from '../lib/services/routing/OSRMService'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')
const CITY = 'Armação dos Búzios', STATE = 'Rio de Janeiro', COUNTRY = 'Brazil'

// Igrejas-âncora que faltavam na base (OSM-first).
const NEW_CHURCHES = [
  { name: 'Igreja Matriz de Santa Rita de Cássia', lat: -22.77432, lng: -41.91392, osm_id: 552232271, neighborhood: 'Rasa', notable: true,
    description: 'Igreja matriz (paróquia principal) de Armação dos Búzios, na Rasa; forma um complexo devocional com a vizinha Capela de Nossa Senhora Desatadora dos Nós.' },
  { name: 'Igreja São José', lat: -22.78136, lng: -41.94207, osm_id: 554741582, neighborhood: 'José Gonçalves', notable: false,
    description: 'Igreja católica no bairro de José Gonçalves, na porção sudoeste da península de Búzios.' },
]

// Ordem do circuito de peregrinação (NE → SW). Todos os waypoints são POIs existentes.
const ROUTE_WAYPOINTS = [
  { name: "Igreja de Sant'Anna", lat: -22.7471, lng: -41.8819 },
  { name: 'Igreja Matriz de Santa Rita de Cássia', lat: -22.77432, lng: -41.91392 },
  { name: 'Capela de Nossa Senhora Desatadora dos Nós', lat: -22.7741, lng: -41.9140 },
  { name: 'Igreja São José', lat: -22.78136, lng: -41.94207 },
  { name: 'Igreja Metodista de Baía Formosa', lat: -22.8092, lng: -41.9749 },
]
const ROUTE_NAME = 'Rota Religiosa de Búzios'
const ROUTE_DESC = 'Circuito de peregrinação pelas igrejas históricas de Armação dos Búzios: da Igreja de Sant’Anna (1740), berço da fé buziana, à Matriz de Santa Rita de Cássia e à Capela de Nossa Senhora Desatadora dos Nós na Rasa, passando pela Igreja São José até a histórica Igreja Metodista de Baía Formosa.'

function haversine(a: any, b: any): number {
  const R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}
function rid() { return Math.random().toString(36).slice(2, 9) }

async function getAdminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  if (data?.id) return data.id
  const { data: a } = await db.from('cms_users').select('id').eq('role', 'admin').eq('is_active', true).limit(1).maybeSingle()
  return a?.id ?? null
}

async function ensureChurch(c: typeof NEW_CHURCHES[0], adminId: string | null) {
  const { data: byOsm } = await db.from('attractions').select('id').eq('osm_type', 'way').eq('osm_id', c.osm_id).maybeSingle()
  if (byOsm) { console.log(`  ↷ já existe (osm) — ${c.name}`); return }
  const { data: byName } = await db.from('attractions').select('id').eq('city', CITY).ilike('name', c.name).maybeSingle()
  if (byName) { console.log(`  ↷ já existe (nome) — ${c.name}`); return }
  console.log(`  + igreja: ${c.name}  osm way/${c.osm_id}  (${c.lat},${c.lng})`)
  if (DRY) return
  const { data: att, error: e1 } = await db.from('attractions').insert({
    name: c.name, city: CITY, state: STATE, country: COUNTRY, neighborhood: c.neighborhood,
    entity_kind: 'poi', is_active: true, approved: true,
    primary_category: 'church', category_group: 'religious',
    priority_level: 2, is_touristic: true, is_notable: c.notable,
    osm_type: 'way', osm_id: c.osm_id, osm_category: 'place_of_worship',
    description: c.description, import_source: 'manual', source_type: 'manual',
    created_by: adminId, processing_status: 'pending',
  }).select('id').single()
  if (e1 || !att) { console.error(`      ✗ ${e1?.message}`); return }
  const { error: e2 } = await db.rpc('insert_coordinate_safe', { p_attraction_id: att.id, p_latitude: c.lat, p_longitude: c.lng, p_show_in_map: true })
  if (e2) { console.error(`      ✗ coord ${e2.message} — removendo`); await db.from('attractions').delete().eq('id', att.id); return }
  console.log(`      ✓ id=${att.id}`)
}

async function linkPoi(wp: any) {
  const D = 0.003
  const { data } = await db.from('attraction_coordinate')
    .select('attraction_id, latitude, longitude, attractions!inner(id, name, entity_kind)')
    .gte('latitude', wp.lat - D).lte('latitude', wp.lat + D)
    .gte('longitude', wp.lng - D).lte('longitude', wp.lng + D).limit(20)
  if (!data?.length) return null
  const cand = (data as any[])
    .map(r => { const a = Array.isArray(r.attractions) ? r.attractions[0] : r.attractions; return { attraction_id: r.attraction_id, name: a?.name, kind: a?.entity_kind, dist: haversine(wp, { lat: r.latitude, lng: r.longitude }) } })
    .filter(c => c.kind === 'poi').sort((a, b) => a.dist - b.dist)
  const exact = cand.find(c => c.name && c.name.toLowerCase().includes(wp.name.toLowerCase().slice(0, 10)))
  return exact ?? cand[0] ?? null
}

async function createRoute(adminId: string | null) {
  const { data: dup } = await db.from('custom_routes').select('id').eq('name', ROUTE_NAME).eq('is_active', true).maybeSingle()
  if (dup) { console.log(`  ↷ rota já existe (${dup.id})`); return }
  const linked: any[] = []
  for (const wp of ROUTE_WAYPOINTS) {
    const m = await linkPoi(wp)
    linked.push({ id: rid(), lat: wp.lat, lng: wp.lng, metadata: { name: m?.name || wp.name, attraction_id: m?.attraction_id || null, is_generic: !m } })
    console.log(`     ${wp.name.padEnd(42)} → ${m ? `✓ "${m.name}" (${Math.round(m.dist)}m)` : '✗ SEM POI'}`)
  }
  const coords = ROUTE_WAYPOINTS.map(w => ({ lat: w.lat, lng: w.lng } as LatLng))
  let ewkt = OSRMService.toWKT(coords), geomSource = 'straightline', dist = 0
  for (let i = 1; i < coords.length; i++) dist += haversine(ROUTE_WAYPOINTS[i - 1], ROUTE_WAYPOINTS[i])
  try {
    const res = await OSRMService.getRoute(coords)
    ewkt = OSRMService.toWKT(res.coordinates); geomSource = 'osrm'; dist = res.distance
    console.log(`     OSRM: ${(res.distance / 1000).toFixed(1)}km ${Math.round(res.duration / 60)}min (${res.coordinates.length} pts)`)
  } catch (e: any) { console.log(`     ⚠ OSRM falhou (${e.message}) → linha reta`) }
  const linkedCount = linked.filter(w => !w.metadata.is_generic).length
  console.log(`  + ${ROUTE_NAME}  ${(dist / 1000).toFixed(1)}km  POIs ${linkedCount}/${linked.length}`)
  if (DRY) return
  const { data, error } = await db.from('custom_routes').insert({
    name: ROUTE_NAME, description: ROUTE_DESC, client_id: null, country: 'Brazil', region: CITY,
    geometry: ewkt, waypoints: linked,
    metadata: { source: `manual-${geomSource}`, mode: 'driving', theme: 'religious', distance_m: Math.round(dist), script: 'create-buzios-rota-religiosa', linked_pois: linkedCount },
    is_active: true, accessibility: 'partial', drivability: 'moderate',
    scenic_profile: ['religious', 'historical', 'cultural'], best_time: ['morning', 'afternoon'], road_conditions: ['paved'],
    photogenic_rating: 'high', stops_count: linked.length, visibility: 'public', created_by: adminId, updated_by: adminId,
  }).select('id').single()
  if (error) { console.error(`      ✗ ${error.message} | ${error.details ?? ''}`); return }
  console.log(`      ✓ id=${data.id}`)
}

async function main() {
  console.log(`\n=== Rota Religiosa de Búzios ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  const adminId = await getAdminId()
  console.log(`admin: ${adminId ?? '(null)'}\n`)
  console.log('— Igrejas-âncora faltantes —')
  for (const c of NEW_CHURCHES) await ensureChurch(c, adminId)
  console.log('\n— Rota —')
  await createRoute(adminId)
  console.log('\n=== fim ===\n')
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
