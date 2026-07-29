/**
 * create-sao-pedro-aldeia-pois.ts
 *
 * Adiciona os POIs turísticos de São Pedro da Aldeia que faltavam (OSM-first),
 * já ativados. Cada candidato foi confirmado por reverse-geocode como pertencente
 * ao município (a bbox vazava para Iguaba Grande/Arraial do Cabo). TPs → manuais.
 *
 * Uso:  npx tsx --env-file=.env scripts/create-sao-pedro-aldeia-pois.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')
const CITY = 'São Pedro da Aldeia', STATE = 'Rio de Janeiro', COUNTRY = 'Brazil'

interface P {
  name: string; osm_type: 'node' | 'way' | 'relation'; osm_id: number; lat: number; lng: number
  primary: string; group: string; osm_cat: string; pl: number
  historic?: boolean; desc?: string
}

const POIS: P[] = [
  {
    name: 'Igreja de Nossa Senhora da Assunção', osm_type: 'way', osm_id: 971141180, lat: -22.83913, lng: -42.10272,
    primary: 'church', group: 'religious', osm_cat: 'place_of_worship', pl: 1, historic: true,
    desc: 'Igreja da antiga aldeia indígena dirigida pelos jesuítas, erguida por volta de 1723 — origem e nome de São Pedro da Aldeia. Um dos conjuntos coloniais mais antigos da Região dos Lagos.',
  },
  {
    name: 'Igreja Matriz de São Pedro', osm_type: 'way', osm_id: 289195901, lat: -22.83883, lng: -42.10287,
    primary: 'church', group: 'religious', osm_cat: 'place_of_worship', pl: 2,
    desc: 'Igreja de São Pedro, padroeiro que dá nome à cidade, no centro histórico de São Pedro da Aldeia.',
  },
  {
    name: 'Praça da Igreja dos Jesuítas', osm_type: 'way', osm_id: 547777176, lat: -22.83942, lng: -42.10245,
    primary: 'park', group: 'parks', osm_cat: 'park', pl: 3,
    desc: 'Praça em frente à histórica Igreja dos Jesuítas, no centro de São Pedro da Aldeia.',
  },
  {
    name: 'Serra de Sapiatiba', osm_type: 'node', osm_id: 12149685934, lat: -22.81886, lng: -42.16012,
    primary: 'peak', group: 'nature', osm_cat: 'peak', pl: 2,
    desc: 'Serra da Área de Proteção Ambiental de Sapiatiba, com trilhas e mirantes sobre a Lagoa de Araruama e a Região dos Lagos.',
  },
  {
    name: 'Morro do Milagre', osm_type: 'node', osm_id: 12604130445, lat: -22.82549, lng: -42.07434,
    primary: 'peak', group: 'nature', osm_cat: 'peak', pl: 3,
    desc: 'Morro na porção nordeste de São Pedro da Aldeia, ponto elevado da paisagem local.',
  },
  {
    name: 'Morro do Frade', osm_type: 'node', osm_id: 12604130446, lat: -22.83361, lng: -42.06125,
    primary: 'peak', group: 'nature', osm_cat: 'peak', pl: 3,
    desc: 'Elevação a leste de São Pedro da Aldeia, próxima à divisa com Cabo Frio.',
  },
  {
    name: 'Morro do Governo', osm_type: 'node', osm_id: 12741561797, lat: -22.84782, lng: -42.19065,
    primary: 'peak', group: 'nature', osm_cat: 'peak', pl: 3,
    desc: 'Morro na margem da Lagoa de Araruama, em São Pedro da Aldeia.',
  },
  {
    name: 'Ponta da Farinha', osm_type: 'node', osm_id: 12757476204, lat: -22.85521, lng: -42.19590,
    primary: 'coast', group: 'water', osm_cat: 'cape', pl: 3,
    desc: 'Ponta na orla da Lagoa de Araruama, em São Pedro da Aldeia.',
  },
  {
    name: 'Ponta da Madeira', osm_type: 'node', osm_id: 12800743741, lat: -22.85254, lng: -42.17756,
    primary: 'coast', group: 'water', osm_cat: 'cape', pl: 3,
    desc: 'Ponta na orla da Lagoa de Araruama, em São Pedro da Aldeia.',
  },
]

async function adminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  return data?.id ?? null
}

async function create(p: P, admin: string | null) {
  const { data: byOsm } = await db.from('attractions').select('id').eq('osm_type', p.osm_type).eq('osm_id', p.osm_id).maybeSingle()
  if (byOsm) { console.log(`  ↷ SKIP (osm existe ${byOsm.id}) — ${p.name}`); return }
  const { data: byName } = await db.from('attractions').select('id').eq('city', CITY).ilike('name', p.name).maybeSingle()
  if (byName) { console.log(`  ↷ SKIP (nome existe) — ${p.name}`); return }
  console.log(`  + ${p.name.padEnd(38)} [${p.primary}/${p.group}] pl${p.pl} osm ${p.osm_type}/${p.osm_id}`)
  if (DRY) return
  const { data: att, error } = await db.from('attractions').insert({
    name: p.name, city: CITY, state: STATE, country: COUNTRY, entity_kind: 'poi',
    is_active: true, approved: true, primary_category: p.primary, category_group: p.group,
    priority_level: p.pl, is_touristic: p.pl <= 2, is_notable: p.pl === 1, is_historic: !!p.historic,
    osm_type: p.osm_type, osm_id: p.osm_id, osm_category: p.osm_cat,
    description: p.desc || null, import_source: 'manual', source_type: 'manual',
    created_by: admin, processing_status: 'pending',
  }).select('id').single()
  if (error || !att) { console.error(`      ✗ ${error?.message}`); return }
  const { error: e2 } = await db.rpc('insert_coordinate_safe', { p_attraction_id: att.id, p_latitude: p.lat, p_longitude: p.lng, p_show_in_map: true })
  if (e2) { console.error(`      ✗ coord ${e2.message} — removendo`); await db.from('attractions').delete().eq('id', att.id); return }
  if (p.desc) await db.from('attraction_descriptions').insert({ attraction_id: att.id, language: 'pt-br', description: p.desc, play_count: 0 })
  console.log(`      ✓ id=${att.id}`)
}

async function main() {
  console.log(`\n=== São Pedro da Aldeia — POIs faltantes ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  const admin = await adminId()
  for (const p of POIS) await create(p, admin)
  const { count } = await db.from('attractions').select('id', { count: 'exact', head: true }).eq('city', CITY).eq('entity_kind', 'poi')
  console.log(`\n=== POIs em São Pedro da Aldeia: ${count} ===\n`)
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
