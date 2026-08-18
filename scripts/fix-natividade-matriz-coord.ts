/**
 * fix-natividade-matriz-coord.ts
 *
 * "Igreja Matriz de Natividade" está gravada em -11.940485,-47.615839 — 28 km ao sul
 * do centro histórico, colada no povoado do Príncipe (nosso POI "Príncipe" fica a 300 m
 * dali). A matriz de verdade, a Paróquia Nossa Senhora da Natividade, fica na Av. dos
 * Cruzeiros, 50, no conjunto tombado pelo IPHAN — coordenada conferida no Google Places.
 *
 * O registro é o único POI do corredor com áudio gerado, então ele está falando no
 * lugar errado. O que este script corrige:
 *
 *   1. coordenada  → ponto do centro histórico;
 *   2. boundary    → limpo. O polígono atual veio do OSM, tem centroide a 400 m do
 *                    ponto gravado e pertence a outra feição; a matriz não está mapeada
 *                    no OSM, então não há polígono legítimo para pôr no lugar. Boundary
 *                    nulo é honesto; boundary errado dispara trigger point onde não deve;
 *   3. trigger points → os 11 existentes foram calculados em volta do ponto velho, a
 *                    28 km daqui. Ficam inativos, para regeração. Não são apagados.
 *
 * Uso:  npx tsx --env-file=.env scripts/fix-natividade-matriz-coord.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false }, db: { schema: 'core' } },
)
const DRY = process.argv.includes('--dry')

const POI_ID = '987ac153-9750-4245-95c6-c769ae15a678'
const NOVA = { lat: -11.7097757, lng: -47.7235955 } // Paróquia Nossa Senhora da Natividade

async function main() {
  const { data: antes, error } = await db
    .from('attraction_coordinate')
    .select('latitude,longitude,boundary_source,boundary_type')
    .eq('attraction_id', POI_ID).maybeSingle()
  if (error || !antes) { console.error(`✗ POI ${POI_ID} não encontrado: ${error?.message}`); process.exit(1) }

  const { count: tps } = await db.from('attraction_trigger_points')
    .select('id', { count: 'exact', head: true }).eq('attraction_id', POI_ID).eq('is_active', true)

  console.log(`\nantes:  ${antes.latitude},${antes.longitude}  boundary=${antes.boundary_source ?? 'nulo'}/${antes.boundary_type ?? '-'}`)
  console.log(`depois: ${NOVA.lat},${NOVA.lng}  boundary=nulo`)
  console.log(`trigger points ativos a desativar: ${tps ?? 0}`)
  if (DRY) { console.log('\n(DRY — nada gravado)'); return }

  // UPDATE direto, e não insert_coordinate_safe: aquela RPC usa COALESCE nos campos de
  // boundary, então não consegue LIMPAR um boundary errado — só sobrescrever por outro.
  const { error: e1 } = await db.from('attraction_coordinate').update({
    latitude: NOVA.lat, longitude: NOVA.lng,
    boundary_geometry: null, boundary_type: null, boundary_source: null,
    boundary_confidence: null, boundary_area_m2: null,
    boundary_centroid_lat: null, boundary_centroid_lng: null,
  }).eq('attraction_id', POI_ID)
  if (e1) { console.error(`✗ coordenada: ${e1.message}`); process.exit(1) }

  const { error: e2 } = await db.from('attraction_trigger_points')
    .update({ is_active: false }).eq('attraction_id', POI_ID).eq('is_active', true)
  if (e2) { console.error(`✗ trigger points: ${e2.message}`); process.exit(1) }

  console.log('\n✓ corrigido. Falta regerar os trigger points deste POI.')
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
