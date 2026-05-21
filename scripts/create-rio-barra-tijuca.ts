/**
 * create-rio-barra-tijuca.ts
 *
 * Cria a rota "Barra da Tijuca — Web Summit e o Melhor da Zona Oeste Carioca" no banco de dados.
 *
 * O script:
 *   1. Define 12 landmarks dos principais pontos da Barra da Tijuca
 *   2. Para cada waypoint, busca o POI correspondente em core.attractions (bounding box ~200m)
 *   3. Se encontrar → vincula o attraction_id no metadata do waypoint
 *   4. Se não encontrar → registra como genérico (name sem attraction_id)
 *   5. Gera o trajeto road-snapped via OSRM público
 *   6. Salva em core.custom_routes com waypoints enriquecidos
 *   7. Atualiza country e region separadamente (RouteService não os gerencia)
 *
 * Uso:
 *   npx tsx scripts/create-rio-barra-tijuca.ts
 *   npx tsx scripts/create-rio-barra-tijuca.ts --force   # recria se já existir
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

const ROUTE_NAME        = 'Barra da Tijuca — Web Summit e o Melhor da Zona Oeste Carioca'
const ROUTE_DESCRIPTION = 'O roteiro perfeito para quem está no Riocentro para o Web Summit e quer explorar a melhor região da Barra da Tijuca. A Barra é a área mais moderna e segura do Rio: praias desertas de 18 km, shoppings gigantescos, o legado olímpico de 2016, a arquitetura arrojada da Cidade das Artes de Oscar Niemeyer, a natureza preservada do Bosque da Barra e a mais bela praia intocada do Rio — Grumari. Uma tarde de carro explorando tudo que o bairro mais americano do Rio tem a oferecer.'
const ROUTE_COUNTRY     = 'Brazil'
const ROUTE_REGION      = 'Rio de Janeiro'

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

// ─── Landmarks ────────────────────────────────────────────────────────────────

const ROUTE_LANDMARKS: RouteLandmark[] = [
  { name: 'Riocentro Convention Center',                           lat: -22.9733, lng: -43.3984 },
  { name: 'Parque Olímpico Rio 2016',                             lat: -22.9751, lng: -43.3965 },
  { name: 'Cidade das Artes — Oscar Niemeyer',                    lat: -22.9770, lng: -43.3820 },
  { name: 'Bosque da Barra',                                      lat: -23.0011, lng: -43.3616 },
  { name: 'Barra Shopping — Um dos Maiores da América Latina',    lat: -22.9997, lng: -43.3637 },
  { name: 'Praia da Barra da Tijuca — 18 km de Areia',           lat: -23.0074, lng: -43.3450 },
  { name: 'Lagoa de Jacarepaguá',                                 lat: -22.9667, lng: -43.4037 },
  { name: 'Praia do Recreio dos Bandeirantes',                    lat: -23.0156, lng: -43.4640 },
  { name: 'Praia de Prainha',                                     lat: -23.0375, lng: -43.5010 },
  { name: 'Praia de Grumari — Mais Preservada do Rio',           lat: -23.0397, lng: -43.5284 },
  { name: 'Praia do Pepino — São Conrado (Voo Livre)',           lat: -22.9982, lng: -43.2888 },
  { name: 'Shopping Leblon / BarraSul',                          lat: -22.9843, lng: -43.2296 },
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
      console.log(`  ${i + 1}. ${landmark.name.padEnd(40)} → ✓ vinculado: "${match.name}" (${Math.round(match.dist)}m)`)
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
          photogenic_rating: 'medium',
        },
      })
    } else {
      console.log(`  ${i + 1}. ${landmark.name.padEnd(40)} → ✗ genérico (nenhum POI no banco a <200m)`)
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
          photogenic_rating: 'medium',
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

  const { data, error } = await db
    .from('custom_routes')
    .insert({
      name:        ROUTE_NAME,
      description: ROUTE_DESCRIPTION,
      client_id:   null,
      geometry:    ewkt,
      waypoints:   waypoints,
      metadata: {
        source,
        distance,
        duration,
        script:        'create-rio-barra-tijuca',
        generated_at:  new Date().toISOString(),
        linked_pois:   linkedCount,
        generic_stops: genericCount,
      },
      is_active:         true,
      accessibility:     'accessible',
      drivability:       'easy',
      scenic_profile:    ['panoramic', 'nature', 'urban'],
      best_time:         ['morning', 'afternoon', 'sunset'],
      road_conditions:   ['paved'],
      resources: {
        parking:   'yes',
        restrooms: 'yes',
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
