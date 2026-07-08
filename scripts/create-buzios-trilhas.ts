/**
 * create-buzios-trilhas.ts
 *
 * As 3 trilhas oficiais do Búzios Eco Trail como core.custom_routes, LIGANDO os
 * POIs de praia já existentes (waypoints com attraction_id). Não há traçado no
 * OSM (route=hiking=0) e o OSRM só faz driving → geometria = LINHA RETA entre os
 * POIs (marcada como aproximada em metadata; refinar depois com GPX). is_active=true.
 *
 * Também remove os 3 POIs de trailhead criados por engano numa versão anterior.
 *
 * Uso:  npx tsx --env-file=.env scripts/create-buzios-trilhas.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'
import { OSRMService, LatLng } from '../lib/services/routing/OSRMService'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')

// POIs de trailhead criados por engano (virar custom_routes) — remover.
const STALE_POI_IDS = [
  'ccd257d5-b0c6-422d-b841-532e734ac768',
  '73aee141-c059-4f57-8697-86aa06cc37b4',
  '23751738-0a0c-4341-9ef5-e28a2b8a9236',
]

interface WP { name: string; lat: number; lng: number }
interface TrailDef { name: string; description: string; waypoints: WP[] }

const TRAILS: TrailDef[] = [
  {
    name: 'Trilha Brava–Forno',
    description: 'Trilha costeira do Búzios Eco Trail ligando a Praia Brava, a Praia Olho de Boi e a Praia do Forno pelo costão.',
    waypoints: [
      { name: 'Praia Brava', lat: -22.7539, lng: -41.8735 },
      { name: 'Praia Olho de Boi', lat: -22.7550, lng: -41.8652 },
      { name: 'Praia do Forno', lat: -22.7614, lng: -41.8751 },
    ],
  },
  {
    name: 'Trilha Canto–Amores–Tartaruga',
    description: 'Trilha do Búzios Eco Trail ligando a Praia do Canto, a Praia dos Amores e a Praia da Tartaruga.',
    waypoints: [
      { name: 'Praia do Canto', lat: -22.7545, lng: -41.8861 },
      { name: 'Praia dos Amores', lat: -22.7517, lng: -41.8972 },
      { name: 'Praia da Tartaruga', lat: -22.7564, lng: -41.9077 },
    ],
  },
  {
    name: 'Trilha da Ponta do Pai Vitório',
    description: 'Trilha do Búzios Eco Trail na Rasa, da Praia da Gorda até a Ponta do Pai Vitório.',
    waypoints: [
      { name: 'Praia da Gorda', lat: -22.7290, lng: -41.9721 },
      { name: 'Ponta do Pai Vitório', lat: -22.73231, lng: -41.95605 },
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

// Liga a coord ao POI mais próximo (raio ~333m) — reaproveita o beach POI existente.
async function linkPoi(wp: WP): Promise<{ attraction_id: string; name: string; dist: number } | null> {
  const D = 0.003
  const { data } = await db.from('attraction_coordinate')
    .select('attraction_id, latitude, longitude, attractions!inner(id, name, entity_kind)')
    .gte('latitude', wp.lat - D).lte('latitude', wp.lat + D)
    .gte('longitude', wp.lng - D).lte('longitude', wp.lng + D).limit(15)
  if (!data?.length) return null
  const cand = data
    .map((r: any) => {
      const a = Array.isArray(r.attractions) ? r.attractions[0] : r.attractions
      return { attraction_id: r.attraction_id, name: a?.name, kind: a?.entity_kind, dist: haversine(wp, { name: '', lat: r.latitude, lng: r.longitude }) }
    })
    .filter(c => c.kind === 'poi')
    .sort((a, b) => a.dist - b.dist)
  return cand[0] ?? null
}

async function existsRoute(name: string): Promise<string | null> {
  const { data } = await db.from('custom_routes').select('id').eq('name', name).eq('is_active', true).maybeSingle()
  return data?.id ?? null
}

async function createTrail(t: TrailDef, adminId: string | null) {
  const dup = await existsRoute(t.name)
  if (dup) { console.log(`  ↷ SKIP (existe ${dup}) — ${t.name}`); return }

  const linked: any[] = []
  for (const wp of t.waypoints) {
    const m = await linkPoi(wp)
    linked.push({
      id: rid(), lat: wp.lat, lng: wp.lng,
      metadata: { name: m?.name || wp.name, attraction_id: m?.attraction_id || null, is_generic: !m },
    })
    console.log(`     ${wp.name.padEnd(24)} → ${m ? `✓ "${m.name}" (${Math.round(m.dist)}m)` : '✗ genérico'}`)
  }
  let dist = 0
  for (let i = 1; i < t.waypoints.length; i++) dist += haversine(t.waypoints[i - 1], t.waypoints[i])
  const ewkt = OSRMService.toWKT(t.waypoints.map(w => ({ lat: w.lat, lng: w.lng } as LatLng)))
  const linkedCount = linked.filter(w => !w.metadata.is_generic).length

  console.log(`  + ${t.name}  ${(dist / 1000).toFixed(1)}km  POIs ligados ${linkedCount}/${linked.length}`)
  if (DRY) return

  const { data, error } = await db.from('custom_routes').insert({
    name: t.name,
    description: t.description,
    client_id: null,
    country: 'Brazil',
    region: 'Armação dos Búzios',
    geometry: ewkt,
    waypoints: linked,
    metadata: {
      source: 'manual-straightline',
      mode: 'hiking',
      trail_system: 'Búzios Eco Trail',
      distance_straightline_m: Math.round(dist),
      note: 'Sem traçado OSM (route=hiking ausente) e OSRM só faz driving — geometria é linha reta entre POIs. Refinar com GPX oficial.',
      script: 'create-buzios-trilhas',
      linked_pois: linkedCount,
    },
    is_active: true,
    accessibility: 'partial',
    drivability: 'unknown',
    scenic_profile: ['nature', 'panoramic', 'coastal'],
    best_time: ['morning', 'afternoon'],
    road_conditions: ['trail', 'unpaved'],
    photogenic_rating: 'high',
    stops_count: linked.length,
    visibility: 'public',
    created_by: adminId,
    updated_by: adminId,
  }).select('id').single()

  if (error) { console.error(`      ✗ ${error.message} | ${error.details ?? ''}`); return }
  console.log(`      ✓ id=${data.id}`)
}

async function cleanupStalePois() {
  console.log('— Removendo POIs de trailhead antigos —')
  for (const id of STALE_POI_IDS) {
    const { data } = await db.from('attractions').select('id, name').eq('id', id).maybeSingle()
    if (!data) { console.log(`  · ${id} não existe (ok)`); continue }
    console.log(`  - deletando "${data.name}" (${id})`)
    if (DRY) continue
    await db.from('attraction_coordinate').delete().eq('attraction_id', id)
    const { error } = await db.from('attractions').delete().eq('id', id)
    if (error) console.error(`      ✗ ${error.message}`); else console.log('      ✓ removido')
  }
}

async function main() {
  console.log(`\n=== Búzios trilhas → custom_routes ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  const adminId = await getAdminId()
  console.log(`admin: ${adminId ?? '(null)'}\n`)
  await cleanupStalePois()
  console.log('\n— Criando trilhas (custom_routes) —')
  for (const t of TRAILS) await createTrail(t, adminId)
  console.log('\n=== fim ===\n')
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
