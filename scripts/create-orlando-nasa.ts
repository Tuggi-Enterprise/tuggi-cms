/**
 * create-orlando-nasa.ts
 *
 * Cria a rota "Orlando até a NASA — A Rota do Espaço" no banco de dados.
 *
 * O script:
 *   1. Define 7 landmarks da rota de Orlando até o Kennedy Space Center
 *   2. Para cada waypoint, busca o POI correspondente em core.attractions (bounding box ~200m)
 *   3. Se encontrar → vincula o attraction_id no metadata do waypoint
 *   4. Se não encontrar → registra como genérico (name sem attraction_id)
 *      (POIs de Orlando/Space Coast NÃO estão no banco Tuggi — todos serão genéricos)
 *   5. Gera o trajeto road-snapped via OSRM público
 *   6. Salva em core.custom_routes com waypoints enriquecidos
 *   7. Atualiza country e region separadamente (RouteService não os gerencia)
 *
 * Uso:
 *   npx tsx scripts/create-orlando-nasa.ts
 *   npx tsx scripts/create-orlando-nasa.ts --force   # recria se já existir
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { OSRMService, LatLng } from '../lib/services/routing/OSRMService'

// ─── Bootstrap: ler .env manualmente (padrão dos scripts deste projeto) ───────

const envPath = path.join(__dirname, '../.env')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=')
      if (idx !== -1) {
        const key = trimmed.substring(0, idx).trim()
        const val = trimmed.substring(idx + 1).trim()
        process.env[key] = val
      }
    }
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || ''

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY são obrigatórios no .env')
  process.exit(1)
}

// Service role — bypassa RLS completamente, não precisa de JWT
const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  db: { schema: 'core' },
  auth: { autoRefreshToken: false, persistSession: false },
})

// ─── Flag --force ─────────────────────────────────────────────────────────────

const FORCE = process.argv.includes('--force')

// ─── Constantes da rota ───────────────────────────────────────────────────────

const ROUTE_NAME        = 'Orlando até a NASA — A Rota Completa do Espaço'
const ROUTE_DESCRIPTION = 'A jornada espacial mais épica a partir de Orlando: saia do centro e percorra de carro toda a Space Coast da Flórida, onde o Atlântico encontra a história da conquista do espaço. Passe por Titusville com o museu espacial e o melhor mirante de lançamentos, atravesse a reserva natural de Merritt Island, chegue ao Kennedy Space Center com foguetes reais e o ônibus espacial, explore o farol histórico de Cape Canaveral, veja cruzeiros zarpar do porto e termine os pés na areia em Cocoa Beach — onde os astronautas comemoravam antes de ir ao espaço. Menos de 1h de Orlando e um dia inesquecível.'
const ROUTE_COUNTRY     = 'United States'
const ROUTE_REGION      = 'Space Coast'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface RouteLandmark {
  name: string
  lat:  number
  lng:  number
}

interface EnrichedWaypoint {
  id:       string
  lat:      number
  lng:      number
  metadata: {
    name:             string
    attraction_id:    string | null
    is_generic:       boolean
    wheelchair_access: 'yes' | 'partial' | 'no' | 'unknown'
    parking:           'yes' | 'no' | 'unknown'
    restrooms:         'yes' | 'no' | 'unknown'
    rest_areas:        'yes' | 'no' | 'unknown'
    photogenic_rating: 'low' | 'medium' | 'high' | 'unknown'
  }
}

// ─── Landmarks — jornada completa Orlando → Space Coast ───────────────────────
// ~1h de Orlando até Titusville. Rota de ida pelo interior (SR-528),
// e regresso pela costa (SR-A1A) passando por Cocoa Beach.

const ROUTE_LANDMARKS: RouteLandmark[] = [
  // ── Orlando: ponto de partida ──────────────────────────────────────
  { name: 'Downtown Orlando — Ponto de Partida',                lat: 28.5383, lng: -81.3792 },

  // ── Titusville: porta de entrada da Space Coast ───────────────────
  { name: 'Space View Park — Melhor Mirante de Lançamentos',    lat: 28.6142, lng: -80.8072 },
  { name: 'American Space Museum (Titusville)',                  lat: 28.6070, lng: -80.8361 },
  { name: 'Astronaut Memorial Planetarium (Cocoa)',              lat: 28.3916, lng: -80.7427 },

  // ── Merritt Island: natureza e vida selvagem ──────────────────────
  { name: 'Merritt Island NWR — Black Point Wildlife Drive',     lat: 28.5597, lng: -80.7795 },
  { name: 'Canaveral National Seashore — Playalinda Beach',      lat: 28.7248, lng: -80.7082 },

  // ── Kennedy Space Center ──────────────────────────────────────────
  { name: 'Kennedy Space Center Visitor Complex',                lat: 28.5235, lng: -80.6826 },
  { name: 'Saturn V / Apollo Center (dentro do KSC)',            lat: 28.5240, lng: -80.6799 },

  // ── Cape Canaveral ────────────────────────────────────────────────
  { name: 'Cape Canaveral Lighthouse (1848)',                    lat: 28.4645, lng: -80.5368 },
  { name: 'Port Canaveral — Cruzeiros e Pôr do Sol',            lat: 28.4089, lng: -80.6020 },

  // ── Cocoa Beach: fim de tarde na praia dos astronautas ────────────
  { name: 'Ron Jon Surf Shop — Ícone de Cocoa Beach',           lat: 28.3163, lng: -80.6088 },
  { name: 'Cocoa Beach Pier',                                    lat: 28.3209, lng: -80.5974 },
  { name: 'Alan Shepard Park (homenagem ao 1.º americano no espaço)', lat: 28.3199, lng: -80.6008 },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** ID curto alfanumérico (padrão do projeto para waypoint IDs) */
function randomId(): string {
  return Math.random().toString(36).substring(2, 9)
}

/** Distância em metros entre dois pontos (Haversine) */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R   = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a   = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── Busca de POI próximo no banco ───────────────────────────────────────────

interface NearbyAttractionResult {
  attraction_id: string
  name:          string
  dist:          number
}

async function findNearbyAttraction(lat: number, lng: number): Promise<NearbyAttractionResult | null> {
  // Bounding box ~200m em graus (0.002° ≈ 222m)
  const DELTA = 0.002

  const { data, error } = await db
    .from('attraction_coordinate')
    .select('attraction_id, latitude, longitude, attractions!inner(id, name, city, country)')
    .gte('latitude',   lat - DELTA)
    .lte('latitude',   lat + DELTA)
    .gte('longitude',  lng - DELTA)
    .lte('longitude',  lng + DELTA)
    .limit(10)

  if (error) {
    // Tabela pode não ter o relacionamento esperado — falhar silenciosamente
    return null
  }

  if (!data || data.length === 0) return null

  // Escolher o POI mais próximo
  const sorted = data
    .map((row: any) => {
      const attraction = Array.isArray(row.attractions) ? row.attractions[0] : row.attractions
      return {
        attraction_id: row.attraction_id as string,
        name:          attraction?.name  as string || 'POI sem nome',
        dist:          haversineMeters(lat, lng, row.latitude, row.longitude),
      }
    })
    .sort((a, b) => a.dist - b.dist)

  return sorted[0] ?? null
}

// ─── Enriquecimento dos waypoints ─────────────────────────────────────────────

async function enrichWaypoints(): Promise<EnrichedWaypoint[]> {
  console.log('  Buscando POIs próximos para cada waypoint...')

  const results: EnrichedWaypoint[] = []

  for (let i = 0; i < ROUTE_LANDMARKS.length; i++) {
    const landmark = ROUTE_LANDMARKS[i]
    const match    = await findNearbyAttraction(landmark.lat, landmark.lng)

    if (match) {
      console.log(`  ${i + 1}. ${landmark.name.padEnd(45)} → ✓ vinculado: "${match.name}" (${Math.round(match.dist)}m)`)
      results.push({
        id:  randomId(),
        lat: landmark.lat,
        lng: landmark.lng,
        metadata: {
          name:              match.name,
          attraction_id:     match.attraction_id,
          is_generic:        false,
          wheelchair_access: 'unknown',
          parking:           'unknown',
          restrooms:         'unknown',
          rest_areas:        'unknown',
          photogenic_rating: 'high',
        },
      })
    } else {
      console.log(`  ${i + 1}. ${landmark.name.padEnd(45)} → ✗ genérico (nenhum POI no banco a <200m)`)
      results.push({
        id:  randomId(),
        lat: landmark.lat,
        lng: landmark.lng,
        metadata: {
          name:              landmark.name,
          attraction_id:     null,
          is_generic:        true,
          wheelchair_access: 'unknown',
          parking:           'unknown',
          restrooms:         'unknown',
          rest_areas:        'unknown',
          photogenic_rating: 'high',
        },
      })
    }
  }

  return results
}

// ─── Roteamento OSRM ──────────────────────────────────────────────────────────

async function generateRoute(waypoints: EnrichedWaypoint[]) {
  const latlngs: LatLng[] = waypoints.map(w => ({ lat: w.lat, lng: w.lng }))

  try {
    const result = await OSRMService.getRoute(latlngs)
    const ewkt   = OSRMService.toWKT(result.coordinates)
    console.log(`  Road-snapped: ${(result.distance / 1000).toFixed(2)} km | ${Math.round(result.duration / 60)} min | ${result.coordinates.length} pontos`)
    return { ewkt, distance: result.distance, duration: result.duration, source: 'osrm' as const }
  } catch (err) {
    console.warn(`  ⚠ OSRM falhou (${(err as Error).message}), usando linha reta entre waypoints`)
    const ewkt = OSRMService.toWKT(latlngs)
    // Estimar distância em linha reta somando segmentos
    let dist = 0
    for (let i = 1; i < latlngs.length; i++) {
      dist += haversineMeters(latlngs[i-1].lat, latlngs[i-1].lng, latlngs[i].lat, latlngs[i].lng)
    }
    return { ewkt, distance: dist, duration: (dist / 1000 / 40) * 3600, source: 'manual' as const }
  }
}

// ─── Lookup do usuário admin ───────────────────────────────────────────────────

async function getAdminUserId(): Promise<string | null> {
  // Tentar pelo email do sistema
  const { data: byEmail } = await db
    .from('cms_users')
    .select('id')
    .eq('email', 'suporte@tuggi.app')
    .eq('is_active', true)
    .maybeSingle()

  if (byEmail?.id) return byEmail.id

  // Fallback: qualquer admin ativo
  const { data: anyAdmin } = await db
    .from('cms_users')
    .select('id')
    .eq('role', 'admin')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  return anyAdmin?.id ?? null
}

// ─── Guard de idempotência ────────────────────────────────────────────────────

async function checkExistingRoute(): Promise<string | null> {
  const { data } = await db
    .from('custom_routes')
    .select('id')
    .eq('name', ROUTE_NAME)
    .eq('is_active', true)
    .maybeSingle()

  return data?.id ?? null
}

async function softDeleteRoute(id: string) {
  await db
    .from('custom_routes')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
}

// ─── Insert da rota ───────────────────────────────────────────────────────────

async function insertRoute(
  waypoints: EnrichedWaypoint[],
  ewkt:      string,
  distance:  number,
  duration:  number,
  source:    'osrm' | 'manual',
  adminId:   string | null,
): Promise<string> {
  const linkedCount  = waypoints.filter(w => !w.metadata.is_generic).length
  const genericCount = waypoints.filter(w =>  w.metadata.is_generic).length

  // Insert direto com service role — NÃO usar o RPC upsert_custom_route
  // porque ele verifica auth.jwt() ->> 'email' que é vazio em contexto de script.
  // O service role bypassa o RLS, então o insert direto funciona.
  const { data, error } = await db
    .from('custom_routes')
    .insert({
      name:        ROUTE_NAME,
      description: ROUTE_DESCRIPTION,
      client_id:   null,
      // Geometria como EWKT — o PostgREST chama geography_in() automaticamente,
      // o mesmo mecanismo usado em trigger-point-saving.ts para GEOGRAPHY(Point).
      geometry:    ewkt,
      waypoints:   waypoints,
      metadata: {
        source,
        distance,
        duration,
        script:        'create-orlando-nasa',
        generated_at:  new Date().toISOString(),
        linked_pois:   linkedCount,
        generic_stops: genericCount,
      },
      is_active:         true,
      accessibility:     'partial',
      drivability:       'easy',
      scenic_profile:    ['nature', 'panoramic', 'historical'],
      best_time:         ['morning', 'afternoon'],
      road_conditions:   ['paved'],
      resources: {
        parking:   'yes',
        restrooms: 'partial',
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

  if (error) {
    throw new Error(`Falha no insert: ${error.message} | Code: ${error.code} | Details: ${error.details}`)
  }

  const routeId = data.id

  // Atualizar country e region separadamente (RouteService não os gerencia)
  if (routeId) {
    await db.from('custom_routes').update({ country: ROUTE_COUNTRY, region: ROUTE_REGION }).eq('id', routeId)
  }

  return routeId
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  Criando Rota: ${ROUTE_NAME}`)
  console.log(`${'═'.repeat(60)}\n`)

  // ── 1. Guard de idempotência ──────────────────────────────
  const existingId = await checkExistingRoute()
  if (existingId) {
    if (!FORCE) {
      console.log(`⚠  Rota já existe com ID: ${existingId}`)
      console.log('   Use --force para deletar e recriar.')
      process.exit(0)
    }
    console.log(`⚠  Rota existente encontrada (${existingId}). --force ativo → deletando...`)
    await softDeleteRoute(existingId)
    console.log('   Deletada.\n')
  }

  // ── 2. Enriquecer waypoints com POIs do banco ─────────────
  console.log('1. Vinculando waypoints a POIs do banco...')
  const enrichedWaypoints = await enrichWaypoints()
  const linked  = enrichedWaypoints.filter(w => !w.metadata.is_generic).length
  const generic = enrichedWaypoints.filter(w =>  w.metadata.is_generic).length
  console.log(`   Resultado: ${linked} vinculados | ${generic} genéricos\n`)

  // ── 3. Gerar rota via OSRM ────────────────────────────────
  console.log('2. Gerando rota road-snapped via OSRM...')
  const { ewkt, distance, duration, source } = await generateRoute(enrichedWaypoints)
  console.log()

  // ── 4. Buscar admin para created_by ───────────────────────
  console.log('3. Buscando usuário admin...')
  const adminId = await getAdminUserId()
  console.log(`   Admin: ${adminId ?? '(null — não encontrado)'}`)
  console.log()

  // ── 5. Salvar no banco ────────────────────────────────────
  console.log('4. Salvando em core.custom_routes...')
  const routeId = await insertRoute(enrichedWaypoints, ewkt, distance, duration, source, adminId)

  // ── 6. Resultado ──────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`)
  console.log('  ✅ SUCESSO')
  console.log(`${'═'.repeat(60)}`)
  console.log(`  Route ID:        ${routeId}`)
  console.log(`  Nome:            ${ROUTE_NAME}`)
  console.log(`  País:            ${ROUTE_COUNTRY}`)
  console.log(`  Região:          ${ROUTE_REGION}`)
  console.log(`  Stops:           ${enrichedWaypoints.length}`)
  console.log(`  POIs vinculados: ${linked}/${enrichedWaypoints.length}`)
  console.log(`  Genéricos:       ${generic}/${enrichedWaypoints.length}`)
  console.log(`  Distância:       ${(distance / 1000).toFixed(2)} km`)
  console.log(`  Duração:         ${Math.round(duration / 60)} min`)
  console.log(`  Fonte geometria: ${source.toUpperCase()}`)
  console.log(`${'═'.repeat(60)}\n`)

  console.log('Verificar no banco:')
  console.log(`  SELECT id, name, country, region, stops_count, ST_Length(geometry) AS metros`)
  console.log(`  FROM core.custom_routes WHERE name = '${ROUTE_NAME}';`)
  console.log()
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ FALHOU:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
