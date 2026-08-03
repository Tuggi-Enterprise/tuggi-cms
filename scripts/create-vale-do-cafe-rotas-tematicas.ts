/**
 * create-vale-do-cafe-rotas-tematicas.ts
 *
 * Rotas temáticas de agroturismo do Vale do Café (RJ), ligando POIs já cadastrados:
 *   - Rota do Café    : fazendas históricas do ciclo do café (visitáveis)
 *   - Rota da Cachaça : cachaçarias / alambiques  (adicionada quando os produtores existirem)
 *   - Rota do Queijo  : queijarias artesanais     (idem)
 *
 * Waypoints resolvidos por (nome, cidade) no banco; ordem por vizinho-mais-próximo a
 * partir de um ponto inicial. Geometria OSRM (fallback linha reta). Data-driven e
 * idempotente (apaga a rota ativa de mesmo nome e recria). TPs → manuais.
 *
 * Uso:  npx tsx --env-file=.env scripts/create-vale-do-cafe-rotas-tematicas.ts [--dry] [--theme cafe]
 */
import { createClient } from '@supabase/supabase-js'
import { OSRMService, LatLng } from '../lib/services/routing/OSRMService'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')
const THEME_FILTER = process.argv.includes('--theme') ? process.argv[process.argv.indexOf('--theme') + 1] : null

interface WP { name: string; city: string }
interface Theme {
  key: string; name: string; description: string; start: { lat: number; lng: number }
  scenic: string[]; waypoints: WP[]
}

const THEMES: Theme[] = [
  {
    key: 'cafe',
    name: 'Rota do Café do Vale do Café',
    description: 'Circuito pelas fazendas históricas do ciclo do café no Vale do Paraíba fluminense, de Vassouras a Rio das Flores. Sedes neoclássicas, terreiros, senzalas e museus contam a era em que o café movia o Império — muitas hoje abertas a visitas guiadas, hospedagem e degustação.',
    start: { lat: -22.4072, lng: -43.6583 }, // Vassouras (Casa da Hera)
    scenic: ['historical', 'cultural', 'rural', 'scenic'],
    waypoints: [
      { name: 'Museu Casa da Hera', city: 'Vassouras' },
      { name: 'Fazenda do Secretário', city: 'Vassouras' },
      { name: 'Fazenda Santa Eufrásia', city: 'Vassouras' },
      { name: 'Fazenda São Luiz da Boa Sorte', city: 'Vassouras' },
      { name: 'Fazenda Cachoeira Grande', city: 'Vassouras' },
      { name: 'Fazenda São Roque', city: 'Vassouras' },
      { name: 'Fazenda São Fernando', city: 'Vassouras' },
      { name: 'Fazenda Arvoredo', city: 'Barra do Piraí' },
      { name: 'Fazenda da Taquara', city: 'Barra do Piraí' },
      { name: 'Fazenda São João da Prosperidade', city: 'Barra do Piraí' },
      { name: 'Fazenda Florença', city: 'Conservatória' },
      { name: 'Fazenda Santo Antônio do Paiol', city: 'Valença' },
      { name: 'Fazenda Vista Alegre', city: 'Valença' },
      { name: 'Fazenda União', city: 'Rio das Flores' },
      { name: 'Fazenda do Paraízo', city: 'Rio das Flores' },
      { name: 'Fazenda Santo Inácio', city: 'Rio das Flores' },
      { name: 'Fazenda São José do Pinheiro', city: 'Pinheiral' },
    ],
  },
  {
    key: 'cachaca',
    name: 'Rota da Cachaça do Vale do Café',
    description: 'Circuito pelos alambiques e cachaçarias artesanais do Vale do Café fluminense, de Paty do Alferes a Conservatória. Cana orgânica, alambiques de cobre centenários e cachaças premiadas — muitos produtores abertos a visita e degustação, além do primeiro museu da cachaça do país.',
    start: { lat: -22.289553, lng: -43.927002 }, // Conservatória
    scenic: ['gastronomic', 'rural', 'cultural'],
    waypoints: [
      { name: 'Cachaça da Bisa', city: 'Conservatória' },
      { name: 'Hotel Fazenda Vilarejo', city: 'Conservatória' },
      { name: 'Cachaçaria Werneck', city: 'Rio das Flores' },
      { name: 'Alambique Vieira & Castro', city: 'Rio das Flores' },
      { name: 'Cachaça Pindorama - Fazenda das Palmas', city: 'Engenheiro Paulo de Frontin' },
      { name: 'Cachaça Magnífica - Alambique Alegria', city: 'Vassouras' },
      { name: 'Museu da Cachaça de Paty do Alferes', city: 'Paty do Alferes' },
    ],
  },
  {
    key: 'queijo',
    name: 'Rota do Queijo do Vale do Café',
    description: 'Roteiro pelas queijarias artesanais de Valença, coração da Rota do Queijo do Vale do Café. Do Empório Rural, que reúne dezenas de produtores, às caves de cura na rocha e aos queijos de leite de cabra e de búfala — tradições que rendem prêmios nacionais e internacionais.',
    start: { lat: -22.278834, lng: -43.739256 }, // Empório Rural de Valença
    scenic: ['gastronomic', 'rural', 'cultural'],
    waypoints: [
      { name: 'Empório Rural de Valença', city: 'Valença' },
      { name: "Du'Vale Queijaria", city: 'Valença' },
      { name: 'Capril do Lago', city: 'Valença' },
      { name: 'Ateliê du Leite', city: 'Valença' },
      { name: 'Rancho Latte Buono', city: 'Valença' },
      { name: 'Sítio Vale do Vento', city: 'Valença' },
    ],
  },
]

function haversine(a: any, b: any): number {
  const R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}
function rid() { return Math.random().toString(36).slice(2, 9) }
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').trim()

async function adminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  return data?.id ?? null
}

async function resolve(wp: WP) {
  const { data: rows } = await db.from('attractions').select('id,name').eq('city', wp.city).neq('is_active', false)
  const hit = (rows || []).find(r => norm(r.name) === norm(wp.name))
  if (!hit) return null
  const { data: c } = await db.from('attraction_coordinate').select('latitude,longitude').eq('attraction_id', hit.id).maybeSingle()
  if (!c) return null
  return { id: hit.id, name: hit.name, lat: c.latitude, lng: c.longitude }
}

function nnOrder(items: any[], start: any) {
  const out: any[] = [], pool = [...items]; let cur = start
  while (pool.length) { let bi = 0, bd = Infinity; for (let i = 0; i < pool.length; i++) { const d = haversine(cur, pool[i]); if (d < bd) { bd = d; bi = i } } cur = pool[bi]; out.push(cur); pool.splice(bi, 1) }
  return out
}

async function build(t: Theme, admin: string | null) {
  console.log(`\n— ${t.name} —`)
  const resolved: any[] = []
  for (const wp of t.waypoints) { const r = await resolve(wp); if (r) resolved.push(r); else console.log(`  ⚠ não achado: ${wp.name} (${wp.city})`) }
  if (resolved.length < 2) { console.log('  ✗ poucos waypoints — pulando'); return }
  const ordered = nnOrder(resolved, t.start)

  const { data: dups } = await db.from('custom_routes').select('id').eq('name', t.name)
  for (const d of (dups || [])) { if (!DRY) await db.from('custom_routes').delete().eq('id', d.id); console.log(`  ↻ removida rota antiga ${d.id}`) }

  const waypoints = ordered.map(e => ({ id: rid(), lat: e.lat, lng: e.lng, metadata: { name: e.name, attraction_id: e.id, is_generic: false } }))
  const coords = ordered.map(e => ({ lat: e.lat, lng: e.lng } as LatLng))
  let ewkt = OSRMService.toWKT(coords), geomSource = 'straightline', dist = 0
  for (let i = 1; i < coords.length; i++) dist += haversine(ordered[i - 1], ordered[i])
  try { const res = await OSRMService.getRoute(coords); ewkt = OSRMService.toWKT(res.coordinates); geomSource = 'osrm'; dist = res.distance; console.log(`  OSRM: ${(res.distance / 1000).toFixed(1)}km ${Math.round(res.duration / 60)}min`) }
  catch (e: any) { console.log(`  ⚠ OSRM falhou (${e.message}) → linha reta`) }

  console.log(`  ${waypoints.length} paradas, ${(dist / 1000).toFixed(1)}km:`)
  ordered.forEach((e, i) => console.log(`    ${i + 1}. ${e.name}`))
  if (DRY) return
  const { data, error } = await db.from('custom_routes').insert({
    name: t.name, description: t.description, client_id: null, country: 'Brazil', region: 'Vale do Café',
    geometry: ewkt, waypoints,
    metadata: { source: `manual-${geomSource}`, mode: 'driving', theme: t.key, distance_m: Math.round(dist), script: 'create-vale-do-cafe-rotas-tematicas' },
    is_active: true, accessibility: 'partial', drivability: 'moderate',
    scenic_profile: t.scenic, best_time: ['morning', 'afternoon'], road_conditions: ['paved', 'unpaved'],
    photogenic_rating: 'high', stops_count: waypoints.length, visibility: 'public', created_by: admin, updated_by: admin,
  }).select('id').single()
  if (error) { console.error(`  ✗ ${error.message} | ${error.details ?? ''}`); return }
  console.log(`  ✓ id=${data.id}`)
}

async function main() {
  console.log(`\n=== Rotas temáticas do Vale do Café ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===`)
  const admin = await adminId()
  for (const t of THEMES) { if (THEME_FILTER && t.key !== THEME_FILTER) continue; await build(t, admin) }
  console.log('\n=== fim ===\n')
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
