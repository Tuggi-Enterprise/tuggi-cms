/**
 * create-buzios-pontos-turisticos.ts
 *
 * Cria/reconcilia os pontos turísticos de Armação dos Búzios que constam no site
 * oficial da prefeitura (turismo.buzios.rj.gov.br/pontos-turisticos) e que ainda
 * NÃO existiam na core, reaproveitando id/estrutura do OSM (Overpass).
 *
 * Regras: entity_kind='poi', is_active=true (já ativado), OSM id anexado, coord via
 * insert_coordinate_safe (show_in_map=true). Trigger Points serão criados manualmente.
 *
 * Uso:  npx tsx --env-file=.env scripts/create-buzios-pontos-turisticos.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')

const CITY = 'Armação dos Búzios'
const STATE = 'Rio de Janeiro'
const COUNTRY = 'Brazil'

interface NewPoi {
  name: string
  lat: number
  lng: number
  osm_type: 'node' | 'way' | 'relation'
  osm_id: number
  osm_category: string
  primary_category: string
  category_group: string
  note: string
}

// 3 confiantes (nome OSM exato) + 1 de menor confiança (viewpoint sem nome no OSM,
// mas no costão do Forno). Todos são pontos turísticos oficiais → nível 1 / touristic.
const NEW_POIS: NewPoi[] = [
  {
    name: 'Capela de Nossa Senhora Desatadora dos Nós',
    lat: -22.77411, lng: -41.91404,
    osm_type: 'way', osm_id: 552591153, osm_category: 'place_of_worship',
    primary_category: 'church', category_group: 'religious',
    note: 'OSM way/552591153 building=church — nome exato',
  },
  {
    name: 'Rua das Pedras',
    lat: -22.75519, lng: -41.88750,
    osm_type: 'way', osm_id: 161828841, osm_category: 'pedestrian',
    primary_category: 'attraction', category_group: 'culture',
    note: 'OSM way/161828841 highway=pedestrian — rua turística/vida noturna',
  },
  {
    name: 'Orla Bardot',
    lat: -22.75119, lng: -41.88379,
    osm_type: 'way', osm_id: 554860093, osm_category: 'footway',
    primary_category: 'attraction', category_group: 'culture',
    note: 'OSM way/554860093 highway=footway — orla/calçadão (Orla Brigitte Bardot)',
  },
  {
    name: 'Mirante do Forno',
    lat: -22.76726, lng: -41.87936,
    osm_type: 'node', osm_id: 4621881796, osm_category: 'viewpoint',
    primary_category: 'viewpoint', category_group: 'nature',
    note: '⚠ OSM node/4621881796 tourism=viewpoint SEM nome — no costão da Praia do Forno (confiança média)',
  },
]

async function getAdminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  if (data?.id) return data.id
  const { data: a } = await db.from('cms_users').select('id').eq('role', 'admin').eq('is_active', true).limit(1).maybeSingle()
  return a?.id ?? null
}

async function existsByOsm(osm_type: string, osm_id: number): Promise<string | null> {
  const { data } = await db.from('attractions').select('id, name').eq('osm_type', osm_type).eq('osm_id', osm_id).maybeSingle()
  return data?.id ?? null
}
async function existsByName(name: string): Promise<string | null> {
  const { data } = await db.from('attractions').select('id').eq('city', CITY).ilike('name', name).maybeSingle()
  return data?.id ?? null
}

async function createPoi(p: NewPoi, adminId: string | null) {
  const dupOsm = await existsByOsm(p.osm_type, p.osm_id)
  if (dupOsm) { console.log(`  ↷ SKIP (osm já existe: ${dupOsm}) — ${p.name}`); return }
  const dupName = await existsByName(p.name)
  if (dupName) { console.log(`  ↷ SKIP (nome já existe: ${dupName}) — ${p.name}`); return }

  console.log(`  + CREATE ${p.name}  [${p.primary_category}/${p.category_group}]  osm ${p.osm_type}/${p.osm_id}`)
  console.log(`      (${p.lat},${p.lng})  ${p.note}`)
  if (DRY) return

  const { data: att, error: e1 } = await db.from('attractions').insert({
    name: p.name,
    city: CITY, state: STATE, country: COUNTRY,
    entity_kind: 'poi',
    is_active: true,
    approved: true,
    primary_category: p.primary_category,
    category_group: p.category_group,
    priority_level: 1,
    is_touristic: true,
    is_notable: true,
    osm_type: p.osm_type,
    osm_id: p.osm_id,
    osm_category: p.osm_category,
    import_source: 'manual',
    source_type: 'manual',
    created_by: adminId,
    processing_status: 'pending',
  }).select('id').single()

  if (e1 || !att) { console.error(`      ✗ attraction insert falhou: ${e1?.message}`); return }

  const { error: e2 } = await db.rpc('insert_coordinate_safe', {
    p_attraction_id: att.id, p_latitude: p.lat, p_longitude: p.lng, p_show_in_map: true,
  })
  if (e2) {
    console.error(`      ✗ coordenada falhou (${e2.message}) — removendo attraction ${att.id}`)
    await db.from('attractions').delete().eq('id', att.id)
    return
  }
  console.log(`      ✓ criado id=${att.id}`)
}

async function reconcilePescadores() {
  // Existe "Estátua dos Pescadores de Belo Horizonte" (artwork, sem osm_id) na mesma
  // coord da OSM node/1747178516 "Estátua dos Pescadores". Renomear + anexar OSM.
  const { data } = await db.from('attractions')
    .select('id, name, osm_id')
    .eq('city', CITY).ilike('name', '%Pescadores%').eq('primary_category', 'artwork')
  const row = (data || [])[0]
  if (!row) { console.log('  (nenhuma Estátua dos Pescadores encontrada — pular reconcile)'); return }
  if (row.osm_id) { console.log(`  ↷ Pescadores já tem osm_id (${row.osm_id}) — nada a fazer`); return }
  console.log(`  ~ RECONCILE "${row.name}" (id=${row.id}) → "Escultura dos Pescadores" + osm node/1747178516, is_touristic=true`)
  if (DRY) return
  const { error } = await db.from('attractions').update({
    name: 'Escultura dos Pescadores',
    osm_type: 'node', osm_id: 1747178516, osm_category: 'artwork',
    is_touristic: true, is_notable: true,
  }).eq('id', row.id)
  if (error) console.error(`      ✗ update falhou: ${error.message}`)
  else console.log('      ✓ reconciliado')
}

async function main() {
  console.log(`\n=== Búzios pontos turísticos ${DRY ? '(DRY RUN)' : '(EXECUTANDO)'} ===\n`)
  const adminId = await getAdminId()
  console.log(`admin created_by: ${adminId ?? '(null)'}\n`)
  console.log('— Criações —')
  for (const p of NEW_POIS) await createPoi(p, adminId)
  console.log('\n— Reconcile —')
  await reconcilePescadores()
  console.log('\n=== fim ===\n')
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
