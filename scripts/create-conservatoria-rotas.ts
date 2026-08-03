/**
 * create-conservatoria-rotas.ts
 *
 * Duas rotas para a ação do Festival Delícias do Vale do Café 2026 em Conservatória:
 *   1) Rota Gastronômica  — pelos estabelecimentos participantes (places com a tag
 *      delicias-vale-do-cafe-2026), ordenados por vizinho-mais-próximo a partir da Praça.
 *   2) Rota Turística      — pelos pontos turísticos de Conservatória (POIs), em ordem
 *      centro → arredores.
 *
 * Data-driven e idempotente: apaga a rota ativa de mesmo nome e recria. Rerodar após
 * cadastrar Casa Tini / Cachaça da Bisa reconstrói a gastronômica com todos os pontos.
 * Geometria via OSRM (fallback linha reta). Trigger Points → manuais.
 *
 * Uso:  npx tsx --env-file=.env scripts/create-conservatoria-rotas.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'
import { OSRMService, LatLng } from '../lib/services/routing/OSRMService'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')
const CITY = 'Conservatória'
const FEST_TAG = 'delicias-vale-do-cafe-2026'
const PRACA = { lat: -22.289553, lng: -43.927002 } // ponto de partida (Praça de Conservatória)

// Ordem do roteiro turístico (centro → arredores)
const TOURIST_ORDER = [
  'Praça de Conservatória', 'Igreja Matriz de Santo Antônio', 'Casa da Cultura de Conservatória',
  'Museu Vicente Celestino', 'Instituto Waldir Azevedo', 'Monumento à Seresta de Conservatória',
  'Túnel que Chora', 'Antiga Estação Ferroviária de Conservatória', 'Cachoeira da Índia',
  'Ponte dos Arcos', 'Mirante da Serra da Beleza',
]

function haversine(a: any, b: any): number {
  const R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}
function rid() { return Math.random().toString(36).slice(2, 9) }

async function adminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  return data?.id ?? null
}

// Carrega {name, id, lat, lng} das attractions de Conservatória de um tipo
async function loadEntities(kind: 'poi' | 'place') {
  const { data: rows } = await db.from('attractions').select('id,name').eq('city', CITY).eq('entity_kind', kind).neq('is_active', false)
  const ids = (rows || []).map(r => r.id)
  const { data: coords } = await db.from('attraction_coordinate').select('attraction_id,latitude,longitude').in('attraction_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  const cmap = new Map((coords || []).map(c => [c.attraction_id, c]))
  return (rows || []).map(r => { const c: any = cmap.get(r.id); return { id: r.id, name: r.name, lat: c?.latitude, lng: c?.longitude } }).filter(e => e.lat != null)
}

// Greedy nearest-neighbor a partir de um ponto de início
function nnOrder(items: any[], start: any) {
  const out: any[] = [], pool = [...items]
  let cur = start
  while (pool.length) {
    let bi = 0, bd = Infinity
    for (let i = 0; i < pool.length; i++) { const d = haversine(cur, pool[i]); if (d < bd) { bd = d; bi = i } }
    cur = pool[bi]; out.push(cur); pool.splice(bi, 1)
  }
  return out
}

async function buildRoute(opts: {
  name: string; description: string; ordered: any[]; theme: string; mode: string
  scenic: string[]; drivability: string; accessibility: string
}, admin: string | null) {
  const { name, ordered } = opts
  const { data: dups } = await db.from('custom_routes').select('id').eq('name', name)
  for (const d of (dups || [])) { if (!DRY) await db.from('custom_routes').delete().eq('id', d.id); console.log(`  ↻ removida rota antiga ${d.id}`) }

  const waypoints = ordered.map(e => ({ id: rid(), lat: e.lat, lng: e.lng, metadata: { name: e.name, attraction_id: e.id, is_generic: false } }))
  const coords = ordered.map(e => ({ lat: e.lat, lng: e.lng } as LatLng))
  let ewkt = OSRMService.toWKT(coords), geomSource = 'straightline', dist = 0
  for (let i = 1; i < coords.length; i++) dist += haversine(ordered[i - 1], ordered[i])
  try {
    const res = await OSRMService.getRoute(coords)
    ewkt = OSRMService.toWKT(res.coordinates); geomSource = 'osrm'; dist = res.distance
    console.log(`     OSRM: ${(res.distance / 1000).toFixed(1)}km ${Math.round(res.duration / 60)}min`)
  } catch (e: any) { console.log(`     ⚠ OSRM falhou (${e.message}) → linha reta`) }

  console.log(`  + ${name}  ${(dist / 1000).toFixed(1)}km  ${waypoints.length} paradas:`)
  ordered.forEach((e, i) => console.log(`      ${i + 1}. ${e.name}`))
  if (DRY) return
  const { data, error } = await db.from('custom_routes').insert({
    name, description: opts.description, client_id: null, country: 'Brazil', region: CITY,
    geometry: ewkt, waypoints,
    metadata: { source: `manual-${geomSource}`, mode: opts.mode, theme: opts.theme, distance_m: Math.round(dist), script: 'create-conservatoria-rotas', event: FEST_TAG },
    is_active: true, accessibility: opts.accessibility, drivability: opts.drivability,
    scenic_profile: opts.scenic, best_time: ['morning', 'afternoon', 'evening'], road_conditions: ['paved'],
    photogenic_rating: 'high', stops_count: waypoints.length, visibility: 'public', created_by: admin, updated_by: admin,
  }).select('id').single()
  if (error) { console.error(`      ✗ ${error.message} | ${error.details ?? ''}`); return }
  console.log(`      ✓ id=${data.id}`)
}

async function main() {
  console.log(`\n=== Rotas de Conservatória ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  const admin = await adminId()

  // 1) Gastronômica — places com a tag do festival
  console.log('— Rota Gastronômica (estabelecimentos do festival) —')
  const places = await loadEntities('place')
  const { data: pd } = await db.from('place_details').select('attraction_id,tags')
  const festIds = new Set((pd || []).filter(p => (p.tags || []).includes(FEST_TAG)).map(p => p.attraction_id))
  const festPlaces = places.filter(p => festIds.has(p.id))
  console.log(`  estabelecimentos com tag: ${festPlaces.length}`)
  const gOrdered = nnOrder(festPlaces, PRACA)
  await buildRoute({
    name: 'Rota Gastronômica de Conservatória',
    description: 'Os doze restaurantes e produtores do Festival Delícias do Vale do Café ficam quase todos a poucos passos uns dos outros, no centro histórico de Conservatória. A rota liga todos, da praça das serestas e da Rua Luiz de Almeida Pinto à cozinha de fazenda que dá o tom do festival. Dá para fazer o trajeto a pé, com um prato em cada parada.',
    ordered: gOrdered, theme: 'gastronomic', mode: 'walking',
    scenic: ['gastronomic', 'cultural', 'historical'], drivability: 'easy', accessibility: 'partial',
  }, admin)

  // 2) Turística — POIs na ordem definida
  console.log('\n— Rota Turística (pontos de Conservatória) —')
  const pois = await loadEntities('poi')
  const byName = new Map(pois.map(p => [p.name.toLowerCase(), p]))
  const tOrdered = TOURIST_ORDER.map(n => byName.get(n.toLowerCase())).filter(Boolean) as any[]
  const missing = TOURIST_ORDER.filter(n => !byName.get(n.toLowerCase()))
  if (missing.length) console.log(`  ⚠ não encontrados: ${missing.join(', ')}`)
  await buildRoute({
    name: 'Conservatória, a Capital da Seresta',
    description: 'Conservatória mantém o costume das serestas de rua e um centro histórico pequeno, de percorrer a pé. A rota passa pela praça e pela Casa da Cultura, onde fica o Museu da Seresta, segue até o Túnel que Chora, a antiga estação de trem e a Ponte dos Arcos, e sobe ao Mirante da Serra da Beleza para ver o vale de cima.',
    ordered: tOrdered, theme: 'historical', mode: 'driving',
    scenic: ['historical', 'cultural', 'scenic'], drivability: 'moderate', accessibility: 'partial',
  }, admin)

  console.log('\n=== fim ===\n')
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
