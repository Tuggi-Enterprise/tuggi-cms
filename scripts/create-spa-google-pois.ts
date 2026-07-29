/**
 * create-spa-google-pois.ts
 *
 * Atrações de São Pedro da Aldeia encontradas via Google Places que NÃO estavam
 * no OSM (o sweep OSM tinha ponto cego: Casa da Flor e Casa dos Azulejos também
 * só existem no Google). Coordenadas ancoradas no Google Places (sem osm_id).
 * Já ativados. TPs → manuais.
 *
 * Uso:  npx tsx --env-file=.env scripts/create-spa-google-pois.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')
const CITY = 'São Pedro da Aldeia', STATE = 'Rio de Janeiro', COUNTRY = 'Brazil'

interface P {
  name: string; lat: number; lng: number; primary: string; group: string; pl: number
  neighborhood?: string; historic?: boolean; desc: string
}

const POIS: P[] = [
  {
    name: 'Helicóptero SH-3 da Base Aeronaval', lat: -22.827541, lng: -42.119959,
    primary: 'attraction', group: 'culture', pl: 2, neighborhood: 'Balneário São Pedro',
    desc: 'Helicóptero Sikorsky SH-3 Sea King exposto como monumento na entrada da Base Aeronaval de São Pedro da Aldeia (BAeNSPA), a maior base de aviação naval do Brasil. A aeronave, que serviu à Marinha em missões de patrulha, transporte e resgate, hoje é um marco visual da cidade e homenagem à história da aviação naval.',
  },
  {
    name: 'Praia dos Cardeiros', lat: -22.879976, lng: -42.133477,
    primary: 'beach', group: 'water', pl: 2, neighborhood: 'Baleia',
    desc: 'Praia oceânica no distrito de Baleia, no extremo sul de São Pedro da Aldeia. Uma das poucas praias de mar aberto do município, de cenário preservado e águas límpidas, alcançada por trilha e procurada por sua tranquilidade.',
  },
  {
    name: 'Mirante da Laguna', lat: -22.858882, lng: -42.103578,
    primary: 'viewpoint', group: 'nature', pl: 2, neighborhood: 'Poço Fundo',
    desc: 'Mirante com vista para a Lagoa de Araruama, no bairro Poço Fundo, em São Pedro da Aldeia. Ponto de contemplação do espelho d’água e do pôr do sol sobre uma das maiores lagoas hipersalinas do mundo.',
  },
  {
    name: 'Praça do Arruda', lat: -22.830654, lng: -42.105632,
    primary: 'park', group: 'parks', pl: 3, neighborhood: 'Estação',
    desc: 'Praça tradicional no bairro Estação, em São Pedro da Aldeia — ponto de encontro e convívio da comunidade local.',
  },
  {
    name: 'Capela de São Pedro', lat: -22.849546, lng: -42.103527,
    primary: 'church', group: 'religious', pl: 3, neighborhood: 'Porto D’Aldeia',
    desc: 'Capela dedicada a São Pedro, padroeiro da cidade, no bairro Porto D’Aldeia, à beira da Lagoa de Araruama, em São Pedro da Aldeia.',
  },
  {
    name: 'Praia do Centro de São Pedro da Aldeia', lat: -22.832435, lng: -42.106153,
    primary: 'beach', group: 'water', pl: 3, neighborhood: 'Centro',
    desc: 'Praia da Lagoa de Araruama no centro de São Pedro da Aldeia, de águas calmas e salinas, junto à orla urbana e ao conjunto histórico da Igreja Matriz.',
  },
]

async function adminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  return data?.id ?? null
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

async function create(p: P, admin: string | null) {
  // dedup por nome (normalizado) na cidade
  const { data: existing } = await db.from('attractions').select('id,name').eq('city', CITY).eq('entity_kind', 'poi')
  const hit = (existing || []).find(e => norm(e.name) === norm(p.name))
  if (hit) { console.log(`  ↷ SKIP (nome existe ${hit.id}) — ${p.name}`); return }
  console.log(`  + ${p.name.padEnd(42)} [${p.primary}/${p.group}] pl${p.pl}`)
  if (DRY) return
  const { data: att, error } = await db.from('attractions').insert({
    name: p.name, city: CITY, state: STATE, country: COUNTRY, entity_kind: 'poi',
    neighborhood: p.neighborhood || null,
    is_active: true, approved: true, primary_category: p.primary, category_group: p.group,
    priority_level: p.pl, is_touristic: p.pl <= 2, is_notable: p.pl === 1 || p.pl === 2, is_historic: !!p.historic,
    description: p.desc, import_source: 'manual', source_type: 'manual',
    created_by: admin, processing_status: 'pending',
  }).select('id').single()
  if (error || !att) { console.error(`      ✗ ${error?.message}`); return }
  const { error: e2 } = await db.rpc('insert_coordinate_safe', { p_attraction_id: att.id, p_latitude: p.lat, p_longitude: p.lng, p_show_in_map: true })
  if (e2) { console.error(`      ✗ coord ${e2.message} — removendo`); await db.from('attractions').delete().eq('id', att.id); return }
  await db.from('attraction_descriptions').insert({ attraction_id: att.id, language: 'pt-br', description: p.desc, play_count: 0 })
  console.log(`      ✓ id=${att.id}`)
}

async function main() {
  console.log(`\n=== São Pedro da Aldeia — POIs via Google ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  const admin = await adminId()
  for (const p of POIS) await create(p, admin)
  const { count } = await db.from('attractions').select('id', { count: 'exact', head: true }).eq('city', CITY).eq('entity_kind', 'poi')
  console.log(`\n=== POIs em São Pedro da Aldeia: ${count} ===\n`)
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
