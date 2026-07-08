/**
 * create-buzios-patrimonio.ts
 *
 * Cria os bens tombados (patrimônio histórico) de Armação dos Búzios como POIs
 * culture/religious, já ativados. Nenhum está no OSM → coordenada pesquisada por
 * fonte (ver `note`), com confiança anotada em heritage_status/description.
 * Só entram itens com confiança >= média. Baixa/sem-coord ficam em HELD/SKIP.
 * Trigger Points → manuais.
 *
 * Uso:  npx tsx --env-file=.env scripts/create-buzios-patrimonio.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')
const CITY = 'Armação dos Búzios', STATE = 'Rio de Janeiro', COUNTRY = 'Brazil'

interface Heritage {
  name: string; lat: number; lng: number
  primary_category: string; category_group: string
  neighborhood: string; confidence: string; description: string
}

const ITEMS: Heritage[] = [
  {
    name: 'Solar do Peixe Vivo', lat: -22.749994, lng: -41.882242,
    primary_category: 'historic_site', category_group: 'culture', neighborhood: 'Centro',
    confidence: 'alta',
    description: 'Casarão histórico na Orla Bardot, em frente à Praia da Armação, usado como casa de veraneio pelo ex-presidente Juscelino Kubitschek. Bem tombado pelo município. Hoje abriga o Restaurante Juscelino. [localização: confiança alta]',
  },
  {
    name: 'Caza do Sino', lat: -22.751171, lng: -41.881667,
    primary_category: 'historic_site', category_group: 'culture', neighborhood: 'Centro',
    confidence: 'média-alta',
    description: 'Casarão histórico tombado; fachada preservada integrada ao complexo do Hotel Atlântico Búzios, junto à Praia da Armação. [localização: confiança média-alta — âncora no hotel]',
  },
  {
    name: 'Casa de Aduelas Azuis', lat: -22.749805, lng: -41.881302,
    primary_category: 'historic_site', category_group: 'culture', neighborhood: 'Ossos',
    confidence: 'média',
    description: 'Casarão do século XVIII, remanescente do período da exploração baleeira em Búzios; exemplar da arquitetura colonial local. Bem tombado, ao lado do Colégio João de Oliveira Botas. [localização: confiança média — âncora no colégio vizinho]',
  },
  {
    name: 'Igreja Assembleia de Deus da Rua das Pedras', lat: -22.755279, lng: -41.887131,
    primary_category: 'church', category_group: 'religious', neighborhood: 'Centro',
    confidence: 'média',
    description: 'Templo em estilo clássico inaugurado em 1963 na Rua das Pedras, um dos marcos históricos do centro de Búzios. Bem tombado. [localização: confiança média — nó "Ministério Madureira" na Rua das Pedras]',
  },
  {
    name: 'Igreja Metodista de Baía Formosa', lat: -22.809221, lng: -41.974926,
    primary_category: 'church', category_group: 'religious', neighborhood: 'Baía Formosa',
    confidence: 'média-alta',
    description: 'Templo metodista do início do século XX, marco da chegada do protestantismo à região, junto à comunidade de Baía Formosa. Bem tombado. [localização: confiança média-alta — nó OSM com denomination=methodist]',
  },
]

const HELD = [
  'Casa da Colônia dos Pescadores Z23 (confiança baixa — endereço ambíguo)',
  'Igreja Metodista dos Ossos (confiança baixa-média — denominação não confirmada no OSM)',
]
const SKIP = [
  'Casa de Boy Sampaio (sem coordenada em nenhuma fonte)',
  'Museu da História/Identidade Buziana (projeto futuro, sem sede física)',
]

async function getAdminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  if (data?.id) return data.id
  const { data: a } = await db.from('cms_users').select('id').eq('role', 'admin').eq('is_active', true).limit(1).maybeSingle()
  return a?.id ?? null
}
async function existsByName(name: string): Promise<string | null> {
  const { data } = await db.from('attractions').select('id').eq('city', CITY).ilike('name', name).maybeSingle()
  return data?.id ?? null
}

async function create(h: Heritage, adminId: string | null) {
  const dup = await existsByName(h.name)
  if (dup) { console.log(`  ↷ SKIP (existe ${dup}) — ${h.name}`); return }
  console.log(`  + ${h.name}  [${h.primary_category}/${h.category_group}]  (${h.lat},${h.lng})  conf=${h.confidence}`)
  if (DRY) return
  const { data: att, error: e1 } = await db.from('attractions').insert({
    name: h.name, city: CITY, state: STATE, country: COUNTRY, neighborhood: h.neighborhood,
    entity_kind: 'poi', is_active: true, approved: true,
    primary_category: h.primary_category, category_group: h.category_group,
    priority_level: 1, is_touristic: true, is_notable: true, is_historic: true,
    heritage_status: 'tombado_municipal', description: h.description,
    import_source: 'manual', source_type: 'manual', created_by: adminId, processing_status: 'pending',
  }).select('id').single()
  if (e1 || !att) { console.error(`      ✗ ${e1?.message}`); return }
  const { error: e2 } = await db.rpc('insert_coordinate_safe', { p_attraction_id: att.id, p_latitude: h.lat, p_longitude: h.lng, p_show_in_map: true })
  if (e2) { console.error(`      ✗ coord ${e2.message} — removendo`); await db.from('attractions').delete().eq('id', att.id); return }
  console.log(`      ✓ id=${att.id}`)
}

async function main() {
  console.log(`\n=== Búzios patrimônio ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  const adminId = await getAdminId()
  console.log(`admin: ${adminId ?? '(null)'}\n`)
  console.log('— Criações —')
  for (const h of ITEMS) await create(h, adminId)
  console.log(`\n— HELD (confiança baixa, confirmar coord): ${HELD.length} —`)
  for (const x of HELD) console.log(`  · ${x}`)
  console.log(`\n— SKIP (sem coordenada): ${SKIP.length} —`)
  for (const x of SKIP) console.log(`  · ${x}`)
  console.log('\n=== fim ===\n')
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
