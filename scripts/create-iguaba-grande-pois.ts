/**
 * create-iguaba-grande-pois.ts
 *
 * Adiciona POIs turísticos de Iguaba Grande (Região dos Lagos, vizinha de São Pedro
 * da Aldeia), OSM-first, já ativados. Todos confirmados por reverse-geocode como
 * pertencentes ao município de Iguaba Grande (apareceram na varredura de SPA por
 * estarem na divisa). TPs → manuais.
 *
 * Uso:  npx tsx --env-file=.env scripts/create-iguaba-grande-pois.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')
const CITY = 'Iguaba Grande', STATE = 'Rio de Janeiro', COUNTRY = 'Brazil'

interface P { name: string; osm_type: 'node' | 'way'; osm_id: number; lat: number; lng: number; primary: string; group: string; osm_cat: string; pl: number; desc?: string }

const POIS: P[] = [
  { name: 'Arcos de Iguaba', osm_type: 'node', osm_id: 7668063918, lat: -22.83972, lng: -42.21526, primary: 'attraction', group: 'culture', osm_cat: 'artwork', pl: 1,
    desc: 'Os Arcos, cartão-postal da orla de Iguaba Grande, à beira da Lagoa de Araruama.' },
  { name: 'Pedra do Lagarto', osm_type: 'node', osm_id: 12800511603, lat: -22.84322, lng: -42.20680, primary: 'attraction', group: 'culture', osm_cat: 'attraction', pl: 2,
    desc: 'Formação rochosa e ponto de contemplação da paisagem em Iguaba Grande, na Região dos Lagos.' },
  { name: 'Pedra da Salga', osm_type: 'way', osm_id: 1382582121, lat: -22.84288, lng: -42.20655, primary: 'attraction', group: 'culture', osm_cat: 'attraction', pl: 2,
    desc: 'Formação rochosa junto à orla da Lagoa de Araruama, atrativo natural de Iguaba Grande.' },
  { name: 'Reserva da Ponta da Farinha', osm_type: 'node', osm_id: 9596332750, lat: -22.85231, lng: -42.19901, primary: 'nature_reserve', group: 'parks', osm_cat: 'nature_reserve', pl: 2,
    desc: 'Área de reserva natural na Ponta da Farinha, na orla da Lagoa de Araruama, em Iguaba Grande.' },
  { name: 'Ponta do Bico Preto', osm_type: 'node', osm_id: 12757473074, lat: -22.85120, lng: -42.20249, primary: 'coast', group: 'water', osm_cat: 'cape', pl: 3,
    desc: 'Ponta na orla da Lagoa de Araruama, em Iguaba Grande.' },
  { name: 'Praia do Popeye', osm_type: 'way', osm_id: 688664086, lat: -22.84482, lng: -42.22450, primary: 'beach', group: 'water', osm_cat: 'beach', pl: 2,
    desc: 'Praia da Lagoa de Araruama em Iguaba Grande, de águas calmas e salinas, ideal para famílias.' },
  { name: 'Praia dos Ubás', osm_type: 'way', osm_id: 688664089, lat: -22.84110, lng: -42.21272, primary: 'beach', group: 'water', osm_cat: 'beach', pl: 2,
    desc: 'Praia da Lagoa de Araruama em Iguaba Grande.' },
  { name: 'Praia da Farinha', osm_type: 'way', osm_id: 1377779371, lat: -22.85314, lng: -42.19905, primary: 'beach', group: 'water', osm_cat: 'beach', pl: 3,
    desc: 'Praia da Lagoa de Araruama na Ponta da Farinha, em Iguaba Grande.' },
  { name: 'Píer de Iguaba (SEMMA)', osm_type: 'way', osm_id: 821251282, lat: -22.83965, lng: -42.21837, primary: 'pier', group: 'infrastructure', osm_cat: 'pier', pl: 3,
    desc: 'Píer na orla da Lagoa de Araruama, em Iguaba Grande.' },
  { name: 'Praça Princesa Diana', osm_type: 'way', osm_id: 821254847, lat: -22.83836, lng: -42.21744, primary: 'park', group: 'parks', osm_cat: 'park', pl: 3,
    desc: 'Praça na orla de Iguaba Grande, junto à Lagoa de Araruama.' },
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
  console.log(`  + ${p.name.padEnd(30)} [${p.primary}/${p.group}] pl${p.pl} osm ${p.osm_type}/${p.osm_id}`)
  if (DRY) return
  const { data: att, error } = await db.from('attractions').insert({
    name: p.name, city: CITY, state: STATE, country: COUNTRY, entity_kind: 'poi',
    is_active: true, approved: true, primary_category: p.primary, category_group: p.group,
    priority_level: p.pl, is_touristic: p.pl <= 2, is_notable: p.pl === 1,
    osm_type: p.osm_type, osm_id: p.osm_id, osm_category: p.osm_cat,
    description: p.desc || null, import_source: 'manual', source_type: 'manual', created_by: admin, processing_status: 'pending',
  }).select('id').single()
  if (error || !att) { console.error(`      ✗ ${error?.message}`); return }
  const { error: e2 } = await db.rpc('insert_coordinate_safe', { p_attraction_id: att.id, p_latitude: p.lat, p_longitude: p.lng, p_show_in_map: true })
  if (e2) { console.error(`      ✗ coord ${e2.message} — removendo`); await db.from('attractions').delete().eq('id', att.id); return }
  if (p.desc) await db.from('attraction_descriptions').insert({ attraction_id: att.id, language: 'pt-br', description: p.desc, play_count: 0 })
  console.log(`      ✓ id=${att.id}`)
}
async function main() {
  console.log(`\n=== Iguaba Grande — POIs ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  const { count: before } = await db.from('attractions').select('id', { count: 'exact', head: true }).eq('city', CITY).eq('entity_kind', 'poi')
  console.log(`POIs em Iguaba Grande antes: ${before}\n`)
  const admin = await adminId()
  for (const p of POIS) await create(p, admin)
  const { count } = await db.from('attractions').select('id', { count: 'exact', head: true }).eq('city', CITY).eq('entity_kind', 'poi')
  console.log(`\n=== POIs em Iguaba Grande: ${count} ===\n`)
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
