/**
 * create-caparao-rotas.ts, card #939 (Tuggi-Enterprise/tuggi-app)
 *
 * Eight Caparaó routes in core.custom_routes: four between towns by car (OSRM geometry) and four
 * forest trails on foot (OSM trail geometry).
 *
 * Trails: there is no route=hiking relation in this range (Overpass, 2026-10-16). The geometry is
 * the shortest path over highway=path/footway/track/steps (plus service roads, which link the park
 * gate to the trailhead) between one POI and the next. A leg with no OSM way goes in a straight
 * line and is listed in metadata.approximate_segments.
 *
 * The CMS does not regenerate these routes on open or save: lib/services/routing/route-geometry.ts
 * (#790) rebuilds the line only when the stops change, and the metadata.source values written here
 * ('manual-osrm', 'osm-trail', 'osm-trail-partial', 'manual-straightline') carry no known snap
 * state, so the snap toggle alone does not regenerate either. Test:
 * tests/api/route-stored-geometry.test.ts.
 *
 * POIs are resolved by name in core.attractions, within 60 km of Patrimônio da Penha (there is a
 * "Cachoeira da Fumaça" in Lençóis too). A missing POI is skipped and logged. A route with fewer
 * than two stops found is not written. This script never creates POIs.
 *
 * Idempotent: a route with the same name is UPDATED in place (keeps its id, partner and tourist
 * progress); otherwise it is inserted. Each stop's id is its attraction_id, stable across runs
 * (route progress matches waypoints[].id, migration 20260929140000).
 *
 * Usage:  npx tsx --env-file=.env scripts/create-caparao-rotas.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'
import { OSRMService, LatLng } from '../lib/services/routing/OSRMService'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')

const REGION = 'Serra do Caparaó'
const CENTER = { lat: -20.5836, lng: -41.7613 } // Patrimônio da Penha
const MAX_FROM_CENTER_M = 60_000
const OVERPASS = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass-api.de/api/interpreter']
const TRAIL_HIGHWAYS = 'path|footway|track|steps|bridleway|service|unclassified|residential'
const MAX_SNAP_M = 500 // POI to the nearest way

type Mode = 'car' | 'walk'
interface RouteDef {
  name: string
  description: string
  mode: Mode
  stops: string[] // names in core.attractions, in travel order
  scenic: string[]
  drivability: 'easy' | 'moderate' | 'demanding' | 'unknown'
  road_conditions: string[]
}

const ROUTES: RouteDef[] = [
  // ── Between towns, by car ─────────────────────────────────────────────────
  {
    name: 'De Patrimônio da Penha a Pedra Menina',
    description: 'Sai da vila de Patrimônio da Penha, passa por Divino de São Lourenço e Dores do Rio Preto e sobe até Pedra Menina, onde fica a entrada capixaba do Parque Nacional do Caparaó. Estrada de serra, com plantações de café e vista para o maciço do Caparaó.',
    mode: 'car',
    stops: ['Patrimônio da Penha', 'Divino de São Lourenço', 'Dores do Rio Preto', 'São José da Pedra Menina', 'Parque Nacional do Caparaó'],
    scenic: ['mountain', 'rural', 'nature'], drivability: 'moderate', road_conditions: ['paved', 'unpaved'],
  },
  {
    name: 'De Pedra Menina a Alto Caparaó',
    description: 'Liga as duas entradas do Parque Nacional do Caparaó. Sai de Pedra Menina, no Espírito Santo, contorna a serra até Alto Caparaó, em Minas Gerais, e segue pela Estrada Parque até a Tronqueira, ponto de partida da trilha mineira para o Pico da Bandeira.',
    mode: 'car',
    stops: ['São José da Pedra Menina', 'Alto Caparaó', 'Mirante Troqueira'],
    scenic: ['mountain', 'nature', 'panoramic'], drivability: 'demanding', road_conditions: ['paved', 'unpaved'],
  },
  {
    name: 'Circuito das Cachoeiras do Caparaó Mineiro',
    description: 'Quatro cachoeiras do lado mineiro do Caparaó numa volta de carro: Farofa e Sete Pilões, perto de Alto Caparaó, a do Aurélio, logo adiante, e a do Chiador, já em Espera Feliz, com parque aquático.',
    mode: 'car',
    stops: ['Cachoeira da Farofa', 'Cachoeira dos Sete Pilões', 'Cachoeira do Aurélio', 'Parque Aquático Cachoeira do Chiador'],
    scenic: ['nature', 'waterfall', 'rural'], drivability: 'moderate', road_conditions: ['paved', 'unpaved'],
  },
  {
    name: 'De Patrimônio da Penha à Cachoeira da Fumaça',
    description: 'De Patrimônio da Penha, passando por Divino de São Lourenço, até a Cachoeira da Fumaça, em Alegre, dentro do parque estadual que leva o nome dela. A queda tem mais de 140 metros e se vê do mirante, perto do estacionamento.',
    mode: 'car',
    stops: ['Patrimônio da Penha', 'Divino de São Lourenço', 'Cachoeira da Fumaça'],
    scenic: ['nature', 'waterfall', 'rural'], drivability: 'moderate', road_conditions: ['paved', 'unpaved'],
  },
  // ── Forest trails, on foot ────────────────────────────────────────────────
  {
    name: 'Trilha das Cachoeiras de Patrimônio da Penha',
    description: 'Começa na guarita dos Guardiões da AMPA e entra na mata ao longo do rio, passando pelas cachoeiras da Vó Tuti, do Arco-Íris e da Purificação.',
    mode: 'walk',
    stops: ['Trilha das Cachoeiras de Patrimônio da Penha', 'Cachoeira da Vó Tuti', 'Cachoeira do Arco-Íris', 'Cachoeira da Purificação'],
    scenic: ['nature', 'waterfall', 'forest'], drivability: 'unknown', road_conditions: ['trail'],
  },
  {
    name: 'Pico da Bandeira pelo lado capixaba',
    description: 'Da entrada do parque em Pedra Menina até a Casa Queimada e dali ao cume do Pico da Bandeira, a 2.892 metros, o ponto mais alto do Espírito Santo. Subida longa e íngreme, com frio forte de madrugada.',
    mode: 'walk',
    stops: ['Parque Nacional do Caparaó', 'Casa Queimada (Alto Caparaó)', 'Pico da Bandeira (Ibitirama, ES)'],
    scenic: ['mountain', 'panoramic', 'nature'], drivability: 'unknown', road_conditions: ['trail'],
  },
  {
    name: 'Pico da Bandeira pelo lado mineiro',
    description: 'Da Tronqueira ao acampamento do Terreirão e dali ao cume do Pico da Bandeira, pela trilha que sai de Minas Gerais. Subida longa, com frio forte de madrugada.',
    mode: 'walk',
    stops: ['Mirante Troqueira', 'Mirante Terreirão', 'Pico da Bandeira (Ibitirama, ES)'],
    scenic: ['mountain', 'panoramic', 'nature'], drivability: 'unknown', road_conditions: ['trail'],
  },
  {
    name: 'Trilha do Vale Verde',
    description: 'Caminhada curta logo depois da portaria mineira do parque, em Alto Caparaó, entre as piscinas naturais do Vale Verde e a Gruta do Jacu.',
    mode: 'walk',
    stops: ['Vale Verde de Alto Caparaó', 'Gruta do Jacu'],
    scenic: ['nature', 'waterfall', 'forest'], drivability: 'unknown', road_conditions: ['trail'],
  },
]

interface Poi { id: string; name: string; lat: number; lng: number }

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}
function lineLength(pts: LatLng[]): number {
  let d = 0
  for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1], pts[i])
  return d
}

async function getAdminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  if (data?.id) return data.id
  const { data: a } = await db.from('cms_users').select('id').eq('role', 'admin').eq('is_active', true).limit(1).maybeSingle()
  return a?.id ?? null
}

/** Name → active POI in the region. A same-named POI outside the radius (another state) is ignored. */
async function loadPois(names: string[]): Promise<Map<string, Poi>> {
  const { data: rows, error } = await db.from('attractions').select('id,name').in('name', names).eq('entity_kind', 'poi').eq('is_active', true)
  if (error) throw new Error(`attractions: ${error.message}`)
  const ids = (rows || []).map(r => r.id)
  const { data: coords, error: e2 } = await db.from('attraction_coordinate').select('attraction_id,latitude,longitude')
    .in('attraction_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  if (e2) throw new Error(`attraction_coordinate: ${e2.message}`)
  const cmap = new Map((coords || []).map(c => [c.attraction_id, c]))
  const out = new Map<string, Poi>()
  for (const r of rows || []) {
    const c: any = cmap.get(r.id)
    if (c?.latitude == null) continue
    const poi = { id: r.id, name: r.name, lat: Number(c.latitude), lng: Number(c.longitude) }
    if (haversine(CENTER, poi) > MAX_FROM_CENTER_M) continue
    if (out.has(r.name)) console.log(`  ! duplicate name in region: "${r.name}" (${out.get(r.name)!.id}, ${r.id}); keeping the first`)
    else out.set(r.name, poi)
  }
  return out
}

// ── OSM trail geometry ───────────────────────────────────────────────────────

type Graph = { coord: Map<number, LatLng>; adj: Map<number, Array<[number, number]>> }

async function overpass(query: string): Promise<any> {
  let last = ''
  for (const url of OVERPASS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'User-Agent': 'tuggi-cms/create-caparao-rotas' } })
        if (res.ok) return await res.json()
        last = `${url} ${res.status}`
      } catch (e: any) { last = `${url} ${e.message}` }
      await new Promise(r => setTimeout(r, 3000 * (attempt + 1)))
    }
  }
  throw new Error(`Overpass unavailable (${last})`)
}

async function trailGraph(pois: Poi[]): Promise<Graph> {
  const pad = 0.02
  const s = Math.min(...pois.map(p => p.lat)) - pad, n = Math.max(...pois.map(p => p.lat)) + pad
  const w = Math.min(...pois.map(p => p.lng)) - pad, e = Math.max(...pois.map(p => p.lng)) + pad
  const data = await overpass(`[out:json][timeout:90];way["highway"~"^(${TRAIL_HIGHWAYS})$"](${s},${w},${n},${e});out geom;`)
  const coord = new Map<number, LatLng>(), adj = new Map<number, Array<[number, number]>>()
  const link = (a: number, b: number, d: number) => { if (!adj.has(a)) adj.set(a, []); adj.get(a)!.push([b, d]) }
  for (const way of data.elements || []) {
    const ids: number[] = way.nodes || [], geom: Array<{ lat: number; lon: number }> = way.geometry || []
    if (ids.length !== geom.length) continue
    ids.forEach((id, i) => coord.set(id, { lat: geom[i].lat, lng: geom[i].lon }))
    for (let i = 1; i < ids.length; i++) {
      const d = haversine(coord.get(ids[i - 1])!, coord.get(ids[i])!)
      link(ids[i - 1], ids[i], d); link(ids[i], ids[i - 1], d)
    }
  }
  return { coord, adj }
}

function nearestNode(g: Graph, p: LatLng): { id: number; dist: number } | null {
  let best: { id: number; dist: number } | null = null
  for (const [id, c] of g.coord) { const d = haversine(p, c); if (!best || d < best.dist) best = { id, dist: d } }
  return best && best.dist <= MAX_SNAP_M ? best : null
}

/** Dijkstra with a binary heap; returns the node sequence, or null when unconnected. */
function shortestPath(g: Graph, from: number, to: number): number[] | null {
  const dist = new Map<number, number>([[from, 0]]), prev = new Map<number, number>()
  const heap: Array<[number, number]> = [[0, from]]
  const push = (x: [number, number]) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p } }
  const pop = (): [number, number] => {
    const top = heap[0], last = heap.pop()!
    if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m } }
    return top
  }
  while (heap.length) {
    const [d, u] = pop()
    if (u === to) break
    if (d > (dist.get(u) ?? Infinity)) continue
    for (const [v, w] of g.adj.get(u) || []) {
      const nd = d + w
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); push([nd, v]) }
    }
  }
  if (!dist.has(to)) return null
  const path = [to]
  while (path[0] !== from) path.unshift(prev.get(path[0])!)
  return path
}

async function trailGeometry(pois: Poi[]): Promise<{ line: LatLng[]; source: string; approximate: string[] }> {
  let g: Graph | null = null
  try { g = await trailGraph(pois) } catch (e: any) { console.log(`     ! ${e.message} -> straight line`) }
  const line: LatLng[] = [{ lat: pois[0].lat, lng: pois[0].lng }]
  const approximate: string[] = []
  for (let i = 1; i < pois.length; i++) {
    const a = pois[i - 1], b = pois[i]
    const na = g && nearestNode(g, a), nb = g && nearestNode(g, b)
    const nodes = g && na && nb ? shortestPath(g, na.id, nb.id) : null
    if (nodes) {
      const seg = nodes.map(id => g!.coord.get(id)!)
      line.push(...seg)
      console.log(`     ${a.name} -> ${b.name}: OSM trail ${(lineLength(seg) / 1000).toFixed(1)}km (ends ${Math.round(na!.dist)}m and ${Math.round(nb!.dist)}m off the way)`)
    } else {
      approximate.push(`${a.name} → ${b.name}`)
      console.log(`     ${a.name} -> ${b.name}: no OSM way -> straight line ${(haversine(a, b) / 1000).toFixed(1)}km`)
    }
    line.push({ lat: b.lat, lng: b.lng })
  }
  const clean = line.filter((p, i) => i === 0 || p.lat !== line[i - 1].lat || p.lng !== line[i - 1].lng)
  const segs = pois.length - 1
  const source = approximate.length === 0 ? 'osm-trail' : approximate.length === segs ? 'manual-straightline' : 'osm-trail-partial'
  return { line: clean, source, approximate }
}

// ── Write ────────────────────────────────────────────────────────────────────

async function buildRoute(def: RouteDef, pois: Map<string, Poi>, adminId: string | null) {
  console.log(`\n-- ${def.name} (${def.mode}) --`)
  const found = def.stops.map(n => pois.get(n)).filter(Boolean) as Poi[]
  const missing = def.stops.filter(n => !pois.has(n))
  if (missing.length) console.log(`  ! missing POI, skipped: ${missing.join(', ')}`)
  if (found.length < 2) { console.log(`  x only ${found.length} stop(s) found; route not written`); return }

  let line: LatLng[] = found.map(p => ({ lat: p.lat, lng: p.lng }))
  let source = 'manual-straightline', duration: number | null = null, approximate: string[] = []
  if (def.mode === 'car') {
    try {
      const res = await OSRMService.getRoute(line)
      line = res.coordinates; source = 'manual-osrm'; duration = Math.round(res.duration)
      console.log(`     OSRM: ${(res.distance / 1000).toFixed(1)}km ${Math.round(res.duration / 60)}min`)
    } catch (e: any) { console.log(`     ! OSRM failed (${e.message}) -> straight line`); approximate = ['whole route'] }
  } else {
    ({ line, source, approximate } = await trailGeometry(found))
  }
  const distance = Math.round(lineLength(line))
  const waypoints = found.map(p => ({ id: p.id, lat: p.lat, lng: p.lng, metadata: { name: p.name, attraction_id: p.id, is_generic: false } }))
  console.log(`  geometry: ${source}  ${(distance / 1000).toFixed(1)}km  ${line.length} points  ${found.length}/${def.stops.length} stops`)
  found.forEach((p, i) => console.log(`      ${i + 1}. ${p.name}`))

  const { data: existing, error: e0 } = await db.from('custom_routes').select('id,metadata').eq('name', def.name).order('created_at')
  if (e0) { console.error(`  x custom_routes: ${e0.message}`); return }
  if ((existing || []).length > 1) console.log(`  ! ${existing!.length} routes with this name; updating ${existing![0].id}`)
  const current = existing?.[0]

  const row = {
    name: def.name, description: def.description, country: 'Brazil', region: REGION,
    geometry: OSRMService.toWKT(line), waypoints, travel_mode: def.mode, is_active: true, visibility: 'public',
    metadata: {
      ...(current?.metadata ?? {}),
      source, distance, duration, script: 'create-caparao-rotas', card: '#939',
      approximate_segments: approximate.length ? approximate : undefined,
      note: approximate.length ? 'Legs without an OSM way are straight lines between the POIs (approximate).' : undefined,
    },
    accessibility: 'partial', drivability: def.drivability, scenic_profile: def.scenic,
    best_time: def.mode === 'walk' ? ['morning'] : ['morning', 'afternoon'], road_conditions: def.road_conditions,
    photogenic_rating: 'high', stops_count: waypoints.length, updated_by: adminId,
  }
  if (DRY) { console.log(`  (dry) would ${current ? `update ${current.id}` : 'insert a new route'}`); return }

  if (current) {
    const { error } = await db.from('custom_routes').update(row).eq('id', current.id)
    if (error) { console.error(`  x ${error.message} | ${error.details ?? ''}`); return }
    console.log(`  ok updated id=${current.id}`)
  } else {
    const { data, error } = await db.from('custom_routes').insert({ ...row, client_id: null, created_by: adminId }).select('id').single()
    if (error) { console.error(`  x ${error.message} | ${error.details ?? ''}`); return }
    console.log(`  ok created id=${data.id}`)
  }
}

async function main() {
  console.log(`\n=== Caparaó routes ${DRY ? '(DRY)' : '(WRITING)'} ===`)
  const adminId = await getAdminId()
  const pois = await loadPois([...new Set(ROUTES.flatMap(r => r.stops))])
  for (const r of ROUTES) await buildRoute(r, pois, adminId)
  console.log('\n=== end ===\n')
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
