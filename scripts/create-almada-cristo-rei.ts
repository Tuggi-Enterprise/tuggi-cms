/**
 * create-almada-cristo-rei.ts
 *
 * Cria o "Outro Lado do Tejo — Cristo Rei e Almada" no banco de dados.
 *
 * Inspirado na travessia da Ponte 25 de Abril:
 * cruza para a margem sul do Tejo, visita o Cristo Rei, Almada histórica,
 * Cacilhas e a Costa da Caparica, regressando a Lisboa por Belém.
 *
 * 8 paradas · ~40 km · narrativa: Lisboa → Ponte → Cristo Rei → Almada → Caparica → Belém
 *
 * Uso:
 *   npx tsx scripts/create-almada-cristo-rei.ts
 *   npx tsx scripts/create-almada-cristo-rei.ts --force
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

const ROUTE_NAME = 'Outro Lado do Tejo — Cristo Rei e Almada'
const ROUTE_DESCRIPTION =
  'A perspectiva que todos os turistas querem mas poucos fazem: cruzar a Ponte 25 de Abril de carro, ' +
  'parar ao pé do Cristo Rei e contemplar Lisboa do outro lado do Tejo. Almada histórica, Cacilhas e ' +
  'a Costa da Caparica completam este roteiro único.'

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

// ─── 8 paradas — Travessia da Ponte 25 de Abril ───────────────────────────────
// Ordem: Alcântara → Ponte → Cristo Rei → Almada → Cacilhas → Caparica → Ponte (sul) → Belém

const ROUTE_LANDMARKS: RouteLandmark[] = [
  { name: 'Alcântara — Doca de Santo Amaro',       lat: 38.6985, lng: -9.1820, note: 'Partida de Lisboa, junto à Ponte 25 de Abril' },
  { name: 'Cristo Rei',                             lat: 38.6756, lng: -9.1720, note: 'Santuário do Cristo Rei — vista frontal de Lisboa' },
  { name: 'Almada Velha — Centro Histórico',        lat: 38.6778, lng: -9.1546, note: 'Antiga vila moura com vista sobre o Tejo' },
  { name: 'Miradouro do Alto do Castelo de Almada', lat: 38.6788, lng: -9.1558, note: 'A melhor vista de Lisboa do outro lado do rio' },
  { name: 'Cacilhas — Cais do Ginjal',              lat: 38.6872, lng: -9.1482, note: 'Cacilheiros e frente ribeirinha com vista de Lisboa' },
  { name: 'Costa da Caparica — Praia Norte',        lat: 38.6480, lng: -9.2270, note: '30km de praia atlântica a 20min de Lisboa' },
  { name: 'Retorno — Ponte 25 de Abril (sul)',      lat: 38.6910, lng: -9.1765, note: 'Voltar para Lisboa pela Ponte 25 de Abril' },
  { name: 'Belém — Torre e Jerónimos',              lat: 38.6979, lng: -9.2068, note: 'Chegar a Belém pelo lado do rio' },
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
      'Cristo Rei', 'Miradouro', 'Belém', 'Cacilhas', 'Ponte 25 de Abril',
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
        script:        'create-almada-cristo-rei',
        generated_at:  new Date().toISOString(),
        linked_pois:   linked,
        generic_stops: generic,
        inspiration:   'Travessia da Ponte 25 de Abril — Outro Lado do Tejo',
      },
      is_active:         true,
      accessibility:     'partial',
      drivability:       'easy',
      scenic_profile:    ['panoramic', 'urban', 'nature'],
      best_time:         ['morning', 'afternoon', 'sunset'],
      road_conditions:   ['paved'],
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
  console.log(`  Outro Lado do Tejo — Cristo Rei e Almada`)
  console.log(`  ${ROUTE_LANDMARKS.length} paradas — travessia da Ponte 25 de Abril`)
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
  console.log(`  FROM core.custom_routes WHERE name LIKE '%Cristo Rei%';`)
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ FALHOU:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
