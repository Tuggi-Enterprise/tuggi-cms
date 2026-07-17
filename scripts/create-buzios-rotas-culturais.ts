/**
 * create-buzios-rotas-culturais.ts
 *
 * Rotas CULTURAIS de Armação dos Búzios como core.custom_routes, com TODOS os
 * waypoints ligados a POIs que já existem na cidade (attraction_id real).
 *   1) Rota Histórica e Cultural da Orla Bardot — a pé, centro histórico (linha reta
 *      entre POIs coladinhos).
 *   2) Rota do Patrimônio Tombado de Búzios — circuito de carro (geometria via OSRM
 *      driving, fallback linha reta).
 * is_active=true. Trigger Points → manuais.
 *
 * Uso:  npx tsx --env-file=.env scripts/create-buzios-rotas-culturais.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'
import { OSRMService, LatLng } from '../lib/services/routing/OSRMService'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')

interface WP { name: string; lat: number; lng: number }
interface RouteDef {
  name: string; description: string; mode: 'walking' | 'driving'
  waypoints: WP[]
  accessibility: string; drivability: string
  scenic_profile: string[]; best_time: string[]; road_conditions: string[]
}

const ROUTES: RouteDef[] = [
  {
    name: 'Rota Histórica e Cultural da Orla Bardot',
    description: 'Caminhada pelo centro histórico de Búzios, da Igreja de Sant’Anna (1740) até o Espaço Cultural Zanine, passando pelos casarões tombados, esculturas da orla e a Rua das Pedras.',
    mode: 'walking',
    accessibility: 'partial', drivability: 'unknown',
    scenic_profile: ['urban', 'historical', 'coastal'], best_time: ['morning', 'sunset'],
    road_conditions: ['pedestrian', 'paved'],
    waypoints: [
      { name: 'Igreja de Sant\'Anna', lat: -22.7471, lng: -41.8819 },
      { name: 'Casa de Aduelas Azuis', lat: -22.7498, lng: -41.8813 },
      { name: 'Solar do Peixe Vivo', lat: -22.7500, lng: -41.8822 },
      { name: 'Escultura dos Pescadores', lat: -22.7501, lng: -41.8828 },
      { name: 'Caza do Sino', lat: -22.7512, lng: -41.8817 },
      { name: 'Orla Bardot', lat: -22.7512, lng: -41.8838 },
      { name: 'Brigitte Bardot', lat: -22.7527, lng: -41.8842 },
      { name: 'Rua das Pedras', lat: -22.7552, lng: -41.8875 },
      { name: 'Espaço Cultural Zanine', lat: -22.7586, lng: -41.8870 },
    ],
  },
  {
    name: 'Rota do Patrimônio Tombado de Búzios',
    description: 'Circuito de carro pelos bens tombados de Búzios espalhados pela península: da Igreja de Sant’Anna à Capela de Nossa Senhora Desatadora dos Nós, ao monumento Quilombola e à Igreja Metodista de Baía Formosa.',
    mode: 'driving',
    accessibility: 'partial', drivability: 'moderate',
    scenic_profile: ['historical', 'cultural', 'nature'], best_time: ['morning', 'afternoon'],
    road_conditions: ['paved'],
    waypoints: [
      { name: 'Igreja de Sant\'Anna', lat: -22.7471, lng: -41.8819 },
      { name: 'Capela de Nossa Senhora Desatadora dos Nós', lat: -22.7741, lng: -41.9140 },
      { name: 'Quilombola', lat: -22.7307, lng: -41.9726 },
      { name: 'Igreja Metodista de Baía Formosa', lat: -22.8092, lng: -41.9749 },
    ],
  },
]

function haversine(a: WP, b: WP): number {
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
async function linkPoi(wp: WP): Promise<{ attraction_id: string; name: string; dist: number } | null> {
  const D = 0.003
  const { data } = await db.from('attraction_coordinate')
    .select('attraction_id, latitude, longitude, attractions!inner(id, name, entity_kind)')
    .gte('latitude', wp.lat - D).lte('latitude', wp.lat + D)
    .gte('longitude', wp.lng - D).lte('longitude', wp.lng + D).limit(20)
  if (!data?.length) return null
  const cand = data
    .map((r: any) => { const a = Array.isArray(r.attractions) ? r.attractions[0] : r.attractions; return { attraction_id: r.attraction_id, name: a?.name, kind: a?.entity_kind, dist: haversine(wp, { name: '', lat: r.latitude, lng: r.longitude }) } })
    .filter(c => c.kind === 'poi')
    .sort((a, b) => a.dist - b.dist)
  // preferir nome que casa
  const exact = cand.find(c => c.name && wp.name && c.name.toLowerCase().includes(wp.name.toLowerCase().slice(0, 8)))
  return exact ?? cand[0] ?? null
}
async function existsRoute(name: string): Promise<string | null> {
  const { data } = await db.from('custom_routes').select('id').eq('name', name).eq('is_active', true).maybeSingle()
  return data?.id ?? null
}

async function createRoute(r: RouteDef, adminId: string | null) {
  const dup = await existsRoute(r.name)
  if (dup) { console.log(`  ↷ SKIP (existe ${dup}) — ${r.name}`); return }

  const linked: any[] = []
  let allLinked = true
  for (const wp of r.waypoints) {
    const m = await linkPoi(wp)
    if (!m) allLinked = false
    linked.push({ id: rid(), lat: wp.lat, lng: wp.lng, metadata: { name: m?.name || wp.name, attraction_id: m?.attraction_id || null, is_generic: !m } })
    console.log(`     ${wp.name.padEnd(42)} → ${m ? `✓ "${m.name}" (${Math.round(m.dist)}m)` : '✗ SEM POI'}`)
  }

  // geometria
  const coords = r.waypoints.map(w => ({ lat: w.lat, lng: w.lng } as LatLng))
  let ewkt = OSRMService.toWKT(coords)
  let geomSource = 'straightline'
  let dist = 0
  for (let i = 1; i < r.waypoints.length; i++) dist += haversine(r.waypoints[i - 1], r.waypoints[i])
  if (r.mode === 'driving') {
    try {
      const res = await OSRMService.getRoute(coords)
      ewkt = OSRMService.toWKT(res.coordinates); geomSource = 'osrm'; dist = res.distance
      console.log(`     OSRM: ${(res.distance / 1000).toFixed(1)}km ${Math.round(res.duration / 60)}min (${res.coordinates.length} pts)`)
    } catch (e: any) { console.log(`     ⚠ OSRM falhou (${e.message}) → linha reta`) }
  }

  const linkedCount = linked.filter(w => !w.metadata.is_generic).length
  console.log(`  + ${r.name}  [${r.mode}] ${(dist / 1000).toFixed(1)}km  POIs ${linkedCount}/${linked.length}${allLinked ? '' : ' ⚠ nem todos ligados'}`)
  if (DRY) return

  const { data, error } = await db.from('custom_routes').insert({
    name: r.name, description: r.description, client_id: null,
    country: 'Brazil', region: 'Armação dos Búzios',
    geometry: ewkt, waypoints: linked,
    metadata: { source: `manual-${geomSource}`, mode: r.mode, theme: 'cultural', distance_m: Math.round(dist), script: 'create-buzios-rotas-culturais', linked_pois: linkedCount },
    is_active: true,
    accessibility: r.accessibility, drivability: r.drivability,
    scenic_profile: r.scenic_profile, best_time: r.best_time, road_conditions: r.road_conditions,
    photogenic_rating: 'high', stops_count: linked.length, visibility: 'public',
    created_by: adminId, updated_by: adminId,
  }).select('id').single()
  if (error) { console.error(`      ✗ ${error.message} | ${error.details ?? ''}`); return }
  console.log(`      ✓ id=${data.id}`)
}

async function main() {
  console.log(`\n=== Búzios rotas culturais ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  const adminId = await getAdminId()
  console.log(`admin: ${adminId ?? '(null)'}\n`)
  for (const r of ROUTES) { await createRoute(r, adminId); console.log() }
  console.log('=== fim ===\n')
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
