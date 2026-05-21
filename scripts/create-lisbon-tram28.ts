/**
 * create-lisbon-tram28.ts
 *
 * Cria o "Elétrico 28 — Pelos Morros de Lisboa" no banco de dados.
 *
 * Inspirado no percurso do Elétrico 28 — Carris Lisboa:
 * de Martim Moniz ao Cemitério dos Prazeres, passando por Alfama,
 * Sé, Miradouros, Bairro Alto, Chiado e Estrela — os morros mais
 * charmosos de Lisboa.
 *
 * 15 paradas · percurso pelos morros históricos de Lisboa
 *
 * Uso:
 *   npx tsx scripts/create-lisbon-tram28.ts
 *   npx tsx scripts/create-lisbon-tram28.ts --force
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { OSRMService, LatLng } from '../lib/services/routing/OSRMService'

// ─── Bootstrap ───────────────────────────────────────────────────────────────

const envPath = path.join(__dirname, '../.env')
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const t = line.trim()
    if (t && !t.startsWith('#')) {
      const i = t.indexOf('=')
      if (i !== -1) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
    }
  })
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || ''

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY são obrigatórios')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  db: { schema: 'core' },
  auth: { autoRefreshToken: false, persistSession: false },
})

const FORCE = process.argv.includes('--force')

// ─── Constantes da rota ───────────────────────────────────────────────────────

const ROUTE_NAME = 'Elétrico 28 — Pelos Morros de Lisboa'
const ROUTE_DESCRIPTION =
  'Siga o percurso do Elétrico 28, o bonde mais famoso do mundo. ' +
  'De Martim Moniz ao Cemitério dos Prazeres, passando por Alfama, Sé, Miradouros, ' +
  'Bairro Alto, Chiado e Estrela — os morros mais charmosos de Lisboa.'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface RouteLandmark {
  name: string
  lat:  number
  lng:  number
  note: string   // breve descrição para o console
}

interface EnrichedWaypoint {
  id:       string
  lat:      number
  lng:      number
  metadata: {
    name:              string
    attraction_id:     string | null
    is_generic:        boolean
    wheelchair_access: 'yes' | 'partial' | 'no' | 'unknown'
    parking:           'yes' | 'no' | 'unknown'
    restrooms:         'yes' | 'no' | 'unknown'
    rest_areas:        'yes' | 'no' | 'unknown'
    photogenic_rating: 'low' | 'medium' | 'high' | 'unknown'
  }
}

// ─── 15 paradas do Elétrico 28 ────────────────────────────────────────────────
// Ordem: Martim Moniz → Alfama → Chiado → Bairro Alto → Estrela → Prazeres

const ROUTE_LANDMARKS: RouteLandmark[] = [
  { name: 'Martim Moniz',                       lat: 38.7189, lng: -9.1373, note: 'Ponto de partida do Elétrico 28 (leste)' },
  { name: 'Mouraria — Largo da Rosa',            lat: 38.7175, lng: -9.1346, note: 'Berço do Fado mourisco' },
  { name: 'Sé de Lisboa',                        lat: 38.7094, lng: -9.1322, note: 'Catedral do séc. XII — mais antiga de Lisboa' },
  { name: 'Miradouro das Portas do Sol',         lat: 38.7121, lng: -9.1313, note: 'Vista sobre Alfama e o Tejo' },
  { name: 'Miradouro de Santa Luzia',            lat: 38.7127, lng: -9.1325, note: 'Azulejos e jardim suspenso sobre Alfama' },
  { name: 'Largo da Graça — Miradouro',          lat: 38.7157, lng: -9.1308, note: 'Melhor vista panorâmica de Lisboa' },
  { name: 'Rua da Graça — Beco da Lage',         lat: 38.7148, lng: -9.1330, note: 'Beco típico alfamista' },
  { name: 'Elevador de Santa Justa',             lat: 38.7120, lng: -9.1381, note: 'Elevador neogótico de Raul Mesnier (1902)' },
  { name: 'Largo do Chiado',                     lat: 38.7109, lng: -9.1412, note: 'Coração literário e cultural de Lisboa' },
  { name: 'Bairro Alto — Rua da Atalaia',        lat: 38.7118, lng: -9.1444, note: 'Bairro boêmio e de vida noturna' },
  { name: 'Miradouro de São Pedro de Alcântara', lat: 38.7138, lng: -9.1426, note: 'Jardim suspenso com vista para o Castelo' },
  { name: 'Praça do Príncipe Real',              lat: 38.7136, lng: -9.1494, note: 'Praça aristocrática com jacarandás centenários' },
  { name: 'Jardim da Estrela',                   lat: 38.7132, lng: -9.1568, note: 'Jardim vitoriano com patos e coreto' },
  { name: 'Basílica da Estrela',                 lat: 38.7133, lng: -9.1584, note: 'Basílica neoclássica do séc. XVIII' },
  { name: 'Cemitério dos Prazeres',              lat: 38.7120, lng: -9.1627, note: 'Fim de linha do Elétrico 28 — cemitério histórico' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomId(): string {
  return Math.random().toString(36).substring(2, 9)
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R    = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── Busca POI mais próximo no banco ──────────────────────────────────────────

async function findNearbyAttraction(lat: number, lng: number): Promise<{ attraction_id: string; name: string; dist: number } | null> {
  const DELTA = 0.003  // ~333m

  const { data, error } = await db
    .from('attraction_coordinate')
    .select('attraction_id, latitude, longitude, attractions!inner(id, name, city, country)')
    .gte('latitude',  lat - DELTA).lte('latitude',  lat + DELTA)
    .gte('longitude', lng - DELTA).lte('longitude', lng + DELTA)
    .limit(10)

  if (error || !data || data.length === 0) return null

  const sorted = data
    .map((row: any) => {
      const a = Array.isArray(row.attractions) ? row.attractions[0] : row.attractions
      return {
        attraction_id: row.attraction_id as string,
        name:          a?.name as string || 'POI sem nome',
        dist:          haversineMeters(lat, lng, row.latitude, row.longitude),
      }
    })
    .sort((a, b) => a.dist - b.dist)

  return sorted[0] ?? null
}

// ─── Enriquecimento ───────────────────────────────────────────────────────────

async function enrichWaypoints(): Promise<EnrichedWaypoint[]> {
  console.log('  Vinculando waypoints a POIs do banco...')
  const results: EnrichedWaypoint[] = []

  for (let i = 0; i < ROUTE_LANDMARKS.length; i++) {
    const lm = ROUTE_LANDMARKS[i]
    const match = await findNearbyAttraction(lm.lat, lm.lng)

    // Determina rating fotogênico por tipo de ponto
    const photoRating: 'high' | 'medium' = [
      'Sé de Lisboa', 'Miradouro das Portas do Sol', 'Miradouro de Santa Luzia',
      'Largo da Graça', 'Elevador de Santa Justa', 'Basílica da Estrela',
      'Miradouro de São Pedro de Alcântara',
    ].some(n => lm.name.includes(n.split(' ')[0])) ? 'high' : 'medium'

    if (match) {
      console.log(`  ${(i + 1).toString().padStart(2)}. ${lm.name.padEnd(45)} → ✓ "${match.name}" (${Math.round(match.dist)}m)`)
    } else {
      console.log(`  ${(i + 1).toString().padStart(2)}. ${lm.name.padEnd(45)} → ✗ genérico`)
    }

    results.push({
      id:  randomId(),
      lat: lm.lat,
      lng: lm.lng,
      metadata: {
        name:              match ? match.name : lm.name,
        attraction_id:     match ? match.attraction_id : null,
        is_generic:        !match,
        wheelchair_access: 'unknown',
        parking:           'unknown',
        restrooms:         'unknown',
        rest_areas:        'unknown',
        photogenic_rating: photoRating,
      },
    })
  }

  return results
}

// ─── Roteamento OSRM ─────────────────────────────────────────────────────────

async function generateRoute(waypoints: EnrichedWaypoint[]) {
  const latlngs: LatLng[] = waypoints.map(w => ({ lat: w.lat, lng: w.lng }))
  console.log(`  Enviando ${latlngs.length} waypoints para o OSRM...`)

  try {
    const result = await OSRMService.getRoute(latlngs)
    const ewkt   = OSRMService.toWKT(result.coordinates)
    console.log(`  ✓ ${(result.distance / 1000).toFixed(1)} km | ${Math.round(result.duration / 60)} min | ${result.coordinates.length} pts road-snapped`)
    return { ewkt, distance: result.distance, duration: result.duration, source: 'osrm' as const }
  } catch (err) {
    console.warn(`  ⚠ OSRM falhou: ${(err as Error).message}. Usando linha direta.`)
    const ewkt = OSRMService.toWKT(latlngs)
    let dist = 0
    for (let i = 1; i < latlngs.length; i++) {
      dist += haversineMeters(latlngs[i-1].lat, latlngs[i-1].lng, latlngs[i].lat, latlngs[i].lng)
    }
    return { ewkt, distance: dist, duration: (dist / 1000 / 30) * 3600, source: 'manual' as const }
  }
}

// ─── Admin user ───────────────────────────────────────────────────────────────

async function getAdminUserId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id')
    .eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  if (data?.id) return data.id
  const { data: any } = await db.from('cms_users').select('id')
    .eq('role', 'admin').eq('is_active', true).limit(1).maybeSingle()
  return any?.id ?? null
}

// ─── Guard de idempotência ────────────────────────────────────────────────────

async function checkExisting(): Promise<string | null> {
  const { data } = await db.from('custom_routes').select('id')
    .eq('name', ROUTE_NAME).eq('is_active', true).maybeSingle()
  return data?.id ?? null
}

// ─── Insert ───────────────────────────────────────────────────────────────────

async function insertRoute(
  waypoints: EnrichedWaypoint[],
  ewkt: string,
  distance: number,
  duration: number,
  source: 'osrm' | 'manual',
  adminId: string | null,
): Promise<string> {
  const linked  = waypoints.filter(w => !w.metadata.is_generic).length
  const generic = waypoints.filter(w =>  w.metadata.is_generic).length

  const { data, error } = await db.from('custom_routes')
    .insert({
      name:        ROUTE_NAME,
      description: ROUTE_DESCRIPTION,
      client_id:   null,
      geometry:    ewkt,
      waypoints,
      metadata: {
        source,
        distance,
        duration,
        script:        'create-lisbon-tram28',
        generated_at:  new Date().toISOString(),
        linked_pois:   linked,
        generic_stops: generic,
        inspiration:   'Percurso do Elétrico 28 — Carris Lisboa',
      },
      is_active:         true,
      accessibility:     'partial',
      drivability:       'moderate',
      scenic_profile:    ['historical', 'urban', 'panoramic'],
      best_time:         ['morning', 'afternoon'],
      road_conditions:   ['paved', 'curves', 'steep'],
      resources: {
        parking:    'partial',
        restrooms:  'yes',
        rest_areas: 'yes',
      },
      photogenic_rating: 'high',
      stops_count:       waypoints.length,
      visibility:        'public',
      created_by:        adminId,
      updated_by:        adminId,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Insert falhou: ${error.message} | ${error.details}`)
  return data.id
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const LINE = '═'.repeat(60)
  console.log(`\n${LINE}`)
  console.log(`  Elétrico 28 — Pelos Morros de Lisboa`)
  console.log(`  ${ROUTE_LANDMARKS.length} paradas inspiradas no Percurso do Elétrico 28 — Carris Lisboa`)
  console.log(`${LINE}\n`)

  // Guard
  const existingId = await checkExisting()
  if (existingId) {
    if (!FORCE) {
      console.log(`⚠  Rota já existe: ${existingId}`)
      console.log('   Use --force para recriar.')
      process.exit(0)
    }
    console.log(`⚠  Deletando rota existente (--force)...`)
    await db.from('custom_routes').update({ is_active: false }).eq('id', existingId)
    console.log('   OK.\n')
  }

  // 1. Enriquecer com POIs do banco
  console.log('1. Vinculando aos POIs do banco...')
  const enriched = await enrichWaypoints()
  const linked  = enriched.filter(w => !w.metadata.is_generic).length
  const generic = enriched.filter(w =>  w.metadata.is_generic).length
  console.log(`\n   Resultado: ${linked} vinculados | ${generic} genéricos\n`)

  // 2. OSRM
  console.log('2. Gerando rota via OSRM...')
  const { ewkt, distance, duration, source } = await generateRoute(enriched)
  console.log()

  // 3. Admin
  console.log('3. Buscando usuário admin...')
  const adminId = await getAdminUserId()
  console.log(`   ${adminId ?? '(null)'}\n`)

  // 4. Insert
  console.log('4. Salvando no banco...')
  const routeId = await insertRoute(enriched, ewkt, distance, duration, source, adminId)

  // Resultado
  console.log(`\n${LINE}`)
  console.log('  ✅ SUCESSO')
  console.log(`${LINE}`)
  console.log(`  Route ID:        ${routeId}`)
  console.log(`  Paradas:         ${enriched.length}`)
  console.log(`  POIs vinculados: ${linked}/${enriched.length}`)
  console.log(`  Distância:       ${(distance / 1000).toFixed(1)} km`)
  console.log(`  Duração:         ~${Math.round(duration / 60)} min de carro`)
  console.log(`  Fonte geom.:     ${source.toUpperCase()}`)
  console.log(`${LINE}\n`)

  console.log('Verificar:')
  console.log(`  SELECT id, name, stops_count, ST_Length(geometry)/1000 AS km`)
  console.log(`  FROM core.custom_routes WHERE name LIKE '%Elétrico 28%';`)
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ FALHOU:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
