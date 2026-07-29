/**
 * create-araruama-google-pois.ts
 *
 * Atrações de Araruama (Região dos Lagos) encontradas via Google Places e ausentes
 * do banco. Filtradas por endereço "Araruama - RJ". Foco na identidade da cidade:
 * orla e praias da Lagoa de Araruama + marcos culturais/religiosos + mirantes.
 * Coordenadas do Google (sem osm_id). Já ativados. TPs → manuais.
 *
 * Uso:  npx tsx --env-file=.env scripts/create-araruama-google-pois.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')
const CITY = 'Araruama', STATE = 'Rio de Janeiro', COUNTRY = 'Brazil'

interface P { name: string; lat: number; lng: number; primary: string; group: string; pl: number; neighborhood?: string; historic?: boolean; desc: string }

const POIS: P[] = [
  { name: 'Botânico das Asas', lat: -22.871058, lng: -42.331039, primary: 'garden', group: 'parks', pl: 2, neighborhood: 'Parque Hotel',
    desc: 'Espaço de jardins e natureza às margens da Lagoa de Araruama, no bairro Parque Hotel — ponto de visitação e lazer na Região dos Lagos.' },
  { name: 'Paróquia São Sebastião', lat: -22.873433, lng: -42.342191, primary: 'church', group: 'religious', pl: 2, neighborhood: 'Centro', historic: true,
    desc: 'Igreja Matriz de São Sebastião, no centro histórico de Araruama, à Rua da Matriz. Principal templo católico da cidade e um de seus marcos históricos e religiosos.' },
  { name: 'Parque de Exposições Manoel Marinho Leão', lat: -22.852937, lng: -42.327757, primary: 'attraction', group: 'leisure', pl: 2, neighborhood: 'Fazendinha',
    desc: 'Parque de exposições de Araruama, no bairro Fazendinha, palco de feiras, shows e grandes eventos da cidade e da Região dos Lagos.' },
  { name: 'Praia da Pontinha', lat: -22.874163, lng: -42.329954, primary: 'beach', group: 'water', pl: 2, neighborhood: 'Pontinha',
    desc: 'Praia da Lagoa de Araruama no bairro Pontinha, de águas calmas e salinas — uma das mais frequentadas da orla urbana de Araruama.' },
  { name: 'Praia dos Amores', lat: -22.879977, lng: -42.310417, primary: 'beach', group: 'water', pl: 2,
    desc: 'Praia da Lagoa de Araruama, de águas tranquilas e rasas, tradicional ponto de banho e lazer na orla de Araruama.' },
  { name: 'Orla da Lagoa de Araruama', lat: -22.877981, lng: -42.324577, primary: 'attraction', group: 'leisure', pl: 2, neighborhood: 'Pontinha',
    desc: 'Orla urbana às margens da Lagoa de Araruama — uma das maiores lagoas hipersalinas do mundo —, com calçadão, quiosques e vista para o espelho d’água, no coração de Araruama.' },
  { name: 'Nova Orla Oscar Niemeyer Araruama', lat: -22.895421, lng: -42.350221, primary: 'attraction', group: 'culture', pl: 2, neighborhood: 'Areal',
    desc: 'Novo trecho da orla de Araruama, no bairro Areal, com projeto paisagístico assinado por Oscar Niemeyer — passeio à beira da Lagoa de Araruama unindo arquitetura moderna e paisagem lagunar.' },
  { name: 'Praia das Bananeiras', lat: -22.879125, lng: -42.272496, primary: 'beach', group: 'water', pl: 2, neighborhood: 'Iguabinha',
    desc: 'Praia da Lagoa de Araruama no distrito de Iguabinha, de águas calmas e salinas, procurada por famílias.' },
  { name: 'Casa de Cultura de Araruama', lat: -22.872995, lng: -42.342116, primary: 'attraction', group: 'culture', pl: 2, neighborhood: 'Nossa Senhora de Nazaré',
    desc: 'Casa de Cultura de Araruama, no centro da cidade, espaço dedicado a exposições, oficinas e à memória cultural do município.' },
  { name: 'Mirante da Paz', lat: -22.834809, lng: -42.364282, primary: 'viewpoint', group: 'nature', pl: 2, neighborhood: 'Três Vendas',
    desc: 'Mirante no alto de Três Vendas, em Araruama, com vista panorâmica sobre a cidade e a Lagoa de Araruama.' },
  { name: 'Praça da Bíblia', lat: -22.872137, lng: -42.335778, primary: 'park', group: 'parks', pl: 3, neighborhood: 'Centro',
    desc: 'Praça da Bíblia, no centro de Araruama, espaço de convívio e contemplação junto à Avenida Araruama.' },
  { name: 'Praia do Coqueiral', lat: -22.869943, lng: -42.304092, primary: 'beach', group: 'water', pl: 3, neighborhood: 'Coqueiral',
    desc: 'Praia da Lagoa de Araruama no bairro Coqueiral, de águas rasas e tranquilas.' },
  { name: 'Praia do Lake View', lat: -22.876608, lng: -42.264770, primary: 'beach', group: 'water', pl: 3, neighborhood: 'Lakeview',
    desc: 'Praia da Lagoa de Araruama no bairro Lakeview, de águas calmas e salinas.' },
  { name: 'Mirante de Praia Seca', lat: -22.930657, lng: -42.308850, primary: 'viewpoint', group: 'nature', pl: 3, neighborhood: 'Praia Seca',
    desc: 'Mirante no distrito de Praia Seca, em Araruama, com vista para a restinga e as lagoas da região.' },
]

async function adminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  return data?.id ?? null
}
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

async function create(p: P, admin: string | null, existing: any[]) {
  const hit = existing.find(e => norm(e.name) === norm(p.name))
  if (hit) { console.log(`  ↷ SKIP (nome existe ${hit.id}) — ${p.name}`); return }
  console.log(`  + ${p.name.padEnd(42)} [${p.primary}/${p.group}] pl${p.pl}`)
  if (DRY) return
  const { data: att, error } = await db.from('attractions').insert({
    name: p.name, city: CITY, state: STATE, country: COUNTRY, entity_kind: 'poi', neighborhood: p.neighborhood || null,
    is_active: true, approved: true, primary_category: p.primary, category_group: p.group,
    priority_level: p.pl, is_touristic: p.pl <= 2, is_notable: p.pl <= 2, is_historic: !!p.historic,
    description: p.desc, import_source: 'manual', source_type: 'manual', created_by: admin, processing_status: 'pending',
  }).select('id').single()
  if (error || !att) { console.error(`      ✗ ${error?.message}`); return }
  const { error: e2 } = await db.rpc('insert_coordinate_safe', { p_attraction_id: att.id, p_latitude: p.lat, p_longitude: p.lng, p_show_in_map: true })
  if (e2) { console.error(`      ✗ coord ${e2.message} — removendo`); await db.from('attractions').delete().eq('id', att.id); return }
  await db.from('attraction_descriptions').insert({ attraction_id: att.id, language: 'pt-br', description: p.desc, play_count: 0 })
  console.log(`      ✓ id=${att.id}`)
}

async function main() {
  console.log(`\n=== Araruama — POIs via Google ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  const admin = await adminId()
  const { data: existing } = await db.from('attractions').select('id,name').eq('city', CITY).eq('entity_kind', 'poi')
  for (const p of POIS) await create(p, admin, existing || [])
  const { count } = await db.from('attractions').select('id', { count: 'exact', head: true }).eq('city', CITY).eq('entity_kind', 'poi')
  console.log(`\n=== POIs em Araruama: ${count} ===\n`)
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
