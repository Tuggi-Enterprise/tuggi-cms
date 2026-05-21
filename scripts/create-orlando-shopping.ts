/**
 * create-orlando-shopping.ts
 *
 * Cria a rota "Orlando Shopping — Outlets e Lojas Imperdíveis" no banco de dados.
 *
 * O script:
 *   1. Define 7 landmarks dos principais shopping centers e outlets de Orlando
 *   2. Para cada waypoint, busca o POI correspondente em core.attractions (bounding box ~200m)
 *   3. Se encontrar → vincula o attraction_id no metadata do waypoint
 *   4. Se não encontrar → registra como genérico (name sem attraction_id)
 *      (POIs de Orlando NÃO estão no banco Tuggi — todos serão genéricos)
 *   5. Gera o trajeto road-snapped via OSRM público
 *   6. Salva em core.custom_routes com waypoints enriquecidos
 *   7. Atualiza country e region separadamente (RouteService não os gerencia)
 *
 * Uso:
 *   npx tsx scripts/create-orlando-shopping.ts
 *   npx tsx scripts/create-orlando-shopping.ts --force   # recria se já existir
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

const ROUTE_NAME        = 'Orlando Shopping — International Drive e os Outlets dos Brasileiros'
const ROUTE_DESCRIPTION = 'O roteiro definitivo de compras em Orlando para brasileiros, com foco no coração turístico da cidade: a International Drive. Dois Premium Outlets (I-Drive ao norte e Vineland ao sul, com mais de 300 lojas somadas), o mall mais luxuoso da Flórida, Walmart, Costco, TJ Maxx, Ross, Marshalls e Disney Springs — tudo no grande corredor turístico onde os brasileiros ficam hospedados. De lojas de grife com 65% de desconto a produtos americanos que não existem no Brasil: um dia inteiro de compras sem precisar sair da região central de Orlando.'
const ROUTE_COUNTRY     = 'United States'
const ROUTE_REGION      = 'Orlando'

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

// ─── Landmarks — corredor turístico da I-Drive e arredores ───────────────────
// Rota corrigida com base nas localizações reais dos shoppings frequentados
// por brasileiros em Orlando. Foco total na I-Drive e Lake Buena Vista.
// Sequência: I-Drive norte → centro → Florida Mall → LBV → Vineland sul → volta

const ROUTE_LANDMARKS: RouteLandmark[] = [
  // ── I-Drive NORTE: maior outlet outlet de Orlando ──
  { name: 'Orlando International Premium Outlets (I-Drive, 180+ lojas)', lat: 28.4727, lng: -81.4504 },

  // ── Meio da I-Drive: entretenimento + compras ──
  { name: 'Pointe Orlando (9101 International Drive)',     lat: 28.4390, lng: -81.4665 },
  { name: 'TJ Maxx / Ross / Old Navy — The Loop I-Drive', lat: 28.4378, lng: -81.4460 },

  // ── Lojas americanas must-have perto da I-Drive ──
  { name: 'Walmart Supercenter — Turkey Lake Rd',         lat: 28.4400, lng: -81.4670 },
  { name: 'Costco Wholesale — Sand Lake Rd',              lat: 28.4430, lng: -81.4790 },
  { name: 'Target — Sand Lake Road',                      lat: 28.4416, lng: -81.4630 },

  // ── Mallls premium (saindo da I-Drive para o norte) ──
  { name: 'The Mall at Millenia — Luxury (Neiman Marcus, Bloomingdale\'s)', lat: 28.4842, lng: -81.4375 },

  // ── Florida Mall (maior mall fechado da região) ──
  { name: 'The Florida Mall — 8001 S Orange Blossom Trail', lat: 28.4460, lng: -81.4020 },

  // ── Lake Buena Vista: próximo a Disney ──
  { name: 'Lake Buena Vista Factory Stores (SR-535)',     lat: 28.3837, lng: -81.5047 },
  { name: 'Disney Springs — Shopping + Lazer Grátis',    lat: 28.3694, lng: -81.5157 },

  // ── I-Drive SUL: outlet luxury (Gucci, Prada, Versace) ──
  { name: 'Orlando Premium Outlets — Vineland (Luxury, 160+ lojas)', lat: 28.3872, lng: -81.4925 },

  // ── Volta pela I-Drive: mais discount stores ──
  { name: 'Marshalls + HomeGoods — I-Drive Corridor',    lat: 28.4350, lng: -81.4550 },
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
        script:        'create-orlando-shopping',
        generated_at:  new Date().toISOString(),
        linked_pois:   linkedCount,
        generic_stops: genericCount,
      },
      is_active:         true,
      accessibility:     'accessible',
      drivability:       'easy',
      scenic_profile:    ['urban'],
      best_time:         ['morning', 'afternoon'],
      road_conditions:   ['paved'],
      resources: {
        parking:   'yes',
        restrooms: 'yes',
        rest_areas: 'yes',
      },
      photogenic_rating: 'medium',
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
