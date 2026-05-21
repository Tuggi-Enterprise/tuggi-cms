/**
 * create-lisbon-grand-tour.ts
 *
 * Cria o "Grand Tour de Lisboa — De Oriente a Belém" no banco de dados.
 *
 * Inspirado nos roteiros Hop On Hop Off de Lisboa:
 * percorre a cidade de leste a oeste em veículo, do Lisboa moderno (Expo 98)
 * até os monumentos da Era dos Descobrimentos (Belém), passando por Alfama,
 * Castelo, Baixa, Chiado e margens do Tejo.
 *
 * 20 paradas · ~22 km · narrativa: Moderno → Histórico → Descobrimentos
 *
 * Uso:
 *   npx tsx scripts/create-lisbon-grand-tour.ts
 *   npx tsx scripts/create-lisbon-grand-tour.ts --force
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

const ROUTE_NAME = 'Grand Tour de Lisboa — De Oriente a Belém'
const ROUTE_DESCRIPTION =
  'O melhor de Lisboa num único roteiro de veículo: da modernidade do Parque das Nações ' +
  'ao misticismo de Alfama e ao Castelo, descendo pela Baixa histórica até às margens do Tejo ' +
  'e chegando à grandiosidade de Belém. Inspirado nos roteiros Hop On Hop Off da cidade.'

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

// ─── 20 paradas do Grand Tour ─────────────────────────────────────────────────
// Ordem: Leste → Centro → Alfama → Baixa → Tejo → Belém (Oeste)

const ROUTE_LANDMARKS: RouteLandmark[] = [
  // === ORIENTE — Lisboa Moderna ===
  {
    name: 'Parque das Nações / Pavilhão do Oriente',
    lat:  38.7639, lng: -9.0984,
    note: 'Expo 98 — Lisboa moderna',
  },
  {
    name: 'Museu Nacional do Azulejo',
    lat:  38.7218, lng: -9.1190,
    note: 'Coleção de azulejos do séc. XV ao XX',
  },

  // === ALFAMA — Lisboa Antiga ===
  {
    name: 'Santa Apolónia',
    lat:  38.7142, lng: -9.1219,
    note: 'Porta de entrada para Alfama',
  },
  {
    name: 'Miradouro de Santa Luzia',
    lat:  38.7127, lng: -9.1325,
    note: 'Vista icónica sobre o Tejo e os telhados de Alfama',
  },
  {
    name: 'Castelo de São Jorge',
    lat:  38.7139, lng: -9.1337,
    note: 'Fortaleza moura do séc. XI — símbolo de Lisboa',
  },
  {
    name: 'Miradouro da Graça',
    lat:  38.7157, lng: -9.1308,
    note: 'Vista panorâmica mais bonita da cidade',
  },
  {
    name: 'Igreja de São Vicente de Fora',
    lat:  38.7152, lng: -9.1284,
    note: 'Panteão dos reis da Dinastia de Bragança',
  },
  {
    name: 'Campo de Santa Clara — Feira da Ladra',
    lat:  38.7153, lng: -9.1275,
    note: 'Feira popular com 500 anos de história',
  },

  // === MOURARIA / CENTRO HISTÓRICO ===
  {
    name: 'Mouraria — Largo do Intendente',
    lat:  38.7183, lng: -9.1343,
    note: 'Berço do Fado, bairro multicultural',
  },
  {
    name: 'Rossio — Praça Dom Pedro IV',
    lat:  38.7156, lng: -9.1393,
    note: 'Coração histórico de Lisboa desde o séc. XIII',
  },
  {
    name: 'Chiado — Largo do Chiado',
    lat:  38.7109, lng: -9.1412,
    note: 'Bairro literário, cultural e gastronômico',
  },

  // === BAIXA / TEJO ===
  {
    name: 'Praça do Comércio — Terreiro do Paço',
    lat:  38.7077, lng: -9.1366,
    note: 'Arco triunfal e frente ribeirinha do Tejo',
  },
  {
    name: 'Cais do Sodré — Time Out Market',
    lat:  38.7061, lng: -9.1451,
    note: 'Hub gastronômico, mercado e vida noturna',
  },

  // === CAMINHO PARA BELÉM ===
  {
    name: 'Museu de Arte Antiga',
    lat:  38.7028, lng: -9.1644,
    note: 'O mais importante museu de arte de Portugal',
  },
  {
    name: 'LX Factory',
    lat:  38.7003, lng: -9.1756,
    note: 'Complexo criativo numa fábrica do séc. XIX',
  },
  {
    name: 'Alcântara — Doca de Santo Amaro',
    lat:  38.6985, lng: -9.1820,
    note: 'Vista da Ponte 25 de Abril e do Cristo Rei',
  },

  // === BELÉM — Era dos Descobrimentos ===
  {
    name: 'Centro Cultural de Belém',
    lat:  38.6980, lng: -9.2060,
    note: 'Centro cultural junto ao Tejo',
  },
  {
    name: 'Mosteiro dos Jerónimos',
    lat:  38.6979, lng: -9.2068,
    note: 'Obra-prima manuelina — Património da UNESCO',
  },
  {
    name: 'Padrão dos Descobrimentos',
    lat:  38.6933, lng: -9.2059,
    note: 'Monumento aos navegadores portugueses',
  },
  {
    name: 'Torre de Belém',
    lat:  38.6916, lng: -9.2161,
    note: 'Ícone de Lisboa — Património da UNESCO',
  },
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
      'Torre de Belém', 'Mosteiro dos Jerónimos', 'Castelo de São Jorge',
      'Miradouro da Graça', 'Miradouro de Santa Luzia', 'Praça do Comércio',
      'Padrão dos Descobrimentos',
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
        script:        'create-lisbon-grand-tour',
        generated_at:  new Date().toISOString(),
        linked_pois:   linked,
        generic_stops: generic,
        inspiration:   'Hop On Hop Off Lisboa',
      },
      is_active:         true,
      accessibility:     'partial',
      drivability:       'moderate',
      scenic_profile:    ['historical', 'urban', 'panoramic'],
      best_time:         ['morning', 'afternoon'],
      road_conditions:   ['paved', 'curves'],
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
  console.log(`  Grand Tour de Lisboa — De Oriente a Belém`)
  console.log(`  ${ROUTE_LANDMARKS.length} paradas inspiradas nos roteiros Hop On Hop Off`)
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
  console.log(`  FROM core.custom_routes WHERE name LIKE '%Grand Tour%';`)
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ FALHOU:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
