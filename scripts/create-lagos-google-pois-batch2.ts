/**
 * create-lagos-google-pois-batch2.ts
 *
 * Segunda leva de atrações da Região dos Lagos via Google Places (ausentes do OSM
 * e do banco): Iguaba Grande e Saquarema. Já ativados. Coordenadas do Google.
 * TPs → manuais.
 *
 * Uso:  npx tsx --env-file=.env scripts/create-lagos-google-pois-batch2.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')
const STATE = 'Rio de Janeiro', COUNTRY = 'Brazil'

interface P { name: string; city: string; lat: number; lng: number; primary: string; group: string; pl: number; neighborhood?: string; historic?: boolean; desc: string }

const POIS: P[] = [
  // ===== Iguaba Grande =====
  { name: 'Praça Municipal José Gomes Filho', city: 'Iguaba Grande', lat: -22.835765, lng: -42.226186, primary: 'park', group: 'parks', pl: 2, neighborhood: 'Estação',
    desc: 'Principal praça de Iguaba Grande, no bairro Estação, junto à orla da Lagoa de Araruama — ponto de encontro, feiras e eventos da cidade.' },
  { name: 'Espaço Ecológico Célia Barbosa da Silva - Lagoa de Bulcão', city: 'Iguaba Grande', lat: -22.816912, lng: -42.208770, primary: 'nature_reserve', group: 'parks', pl: 2, neighborhood: 'Nova Iguaba',
    desc: 'Espaço ecológico às margens da Lagoa de Bulcão, em Nova Iguaba — área de preservação, contemplação e educação ambiental em Iguaba Grande.' },
  { name: 'Capela Nossa Senhora da Conceição', city: 'Iguaba Grande', lat: -22.847811, lng: -42.229757, primary: 'church', group: 'religious', pl: 3, neighborhood: 'Laguna Azul',
    desc: 'Capela dedicada a Nossa Senhora da Conceição, no bairro Laguna Azul, em Iguaba Grande.' },
  { name: 'Área de Lazer Nice dos Santos Vieira', city: 'Iguaba Grande', lat: -22.844485, lng: -42.201528, primary: 'park', group: 'parks', pl: 3, neighborhood: 'Ubás',
    desc: 'Área de lazer no bairro Ubás, em Iguaba Grande, com espaços de convívio junto à Lagoa de Araruama.' },
  { name: 'Horto Municipal de Iguaba Grande', city: 'Iguaba Grande', lat: -22.825636, lng: -42.219912, primary: 'garden', group: 'parks', pl: 3, neighborhood: 'São Miguel',
    desc: 'Horto municipal de Iguaba Grande, no bairro São Miguel — viveiro de mudas e área verde da cidade.' },
  { name: 'Ilha de Santa Rita', city: 'Iguaba Grande', lat: -22.844422, lng: -42.213782, primary: 'island', group: 'water', pl: 3, neighborhood: 'Iguaba Pequena',
    desc: 'Pequena ilha na Lagoa de Araruama, em frente a Iguaba Pequena — ponto pitoresco da paisagem lagunar de Iguaba Grande.' },
  { name: 'Casarão Abandonado de Iguabinha', city: 'Iguaba Grande', lat: -22.859837, lng: -42.235670, primary: 'historic_site', group: 'culture', pl: 3, neighborhood: 'Iguabinha', historic: true,
    desc: 'Antigo casarão histórico em ruínas às margens da Rodovia Amaral Peixoto, no distrito de Iguabinha — vestígio da arquitetura rural da Região dos Lagos.' },

  // ===== Saquarema =====
  { name: 'Cachoeira do Roncador', city: 'Saquarema', lat: -22.882906, lng: -42.648838, primary: 'waterfall', group: 'nature', pl: 2, neighborhood: 'Serra de Mato Grosso',
    desc: 'Cachoeira na Serra de Mato Grosso, em Saquarema, cercada de Mata Atlântica — destino de trilha e banho no interior do município.' },
  { name: 'Praça dos Pescadores', city: 'Saquarema', lat: -22.931794, lng: -42.492775, primary: 'park', group: 'parks', pl: 2, neighborhood: 'Campo de Aviação',
    desc: 'Praça dos Pescadores, junto à orla de Saquarema — homenagem à tradição pesqueira da cidade e ponto de encontro à beira-mar.' },
  { name: 'Praia de Massambaba', city: 'Saquarema', lat: -22.934123, lng: -42.437061, primary: 'beach', group: 'water', pl: 2, neighborhood: 'Vilatur',
    desc: 'Extensa praia oceânica da restinga de Massambaba, em Saquarema — faixa de areia preservada entre o mar aberto e as lagoas costeiras.' },
  { name: 'Reserva Ecológica Estadual de Jacarepiá', city: 'Saquarema', lat: -22.922505, lng: -42.445749, primary: 'nature_reserve', group: 'parks', pl: 2, neighborhood: 'Vilatur',
    desc: 'Reserva Ecológica Estadual de Jacarepiá, em Saquarema — área protegida de restinga e Mata Atlântica que abriga a Lagoa de Jacarepiá e rica biodiversidade.' },
  { name: 'Praia de Vilatur', city: 'Saquarema', lat: -22.934794, lng: -42.411396, primary: 'beach', group: 'water', pl: 2, neighborhood: 'Vilatur',
    desc: 'Praia oceânica no balneário de Vilatur, extremo oeste do litoral de Saquarema — águas abertas e cenário tranquilo, junto à restinga de Massambaba.' },
  { name: 'Museu de Conhecimentos Gerais de Jaconé', city: 'Saquarema', lat: -22.923056, lng: -42.601470, primary: 'museum', group: 'culture', pl: 3, neighborhood: 'Jaconé',
    desc: 'Museu comunitário no distrito de Jaconé, em Saquarema, que reúne curiosidades e conhecimentos gerais — uma parada peculiar no litoral do município.' },
  { name: 'Gruta de Santa Sara Kali de Saquarema', city: 'Saquarema', lat: -22.926737, lng: -42.549655, primary: 'place_of_worship', group: 'religious', pl: 3, neighborhood: 'Barra Nova',
    desc: 'Gruta-santuário dedicada a Santa Sara Kali, na Barra Nova, em Saquarema — espaço de fé e devoção associado ao povo cigano.' },
  { name: 'Cachoeira do Tinguí', city: 'Saquarema', lat: -22.837470, lng: -42.607095, primary: 'waterfall', group: 'nature', pl: 3, neighborhood: 'Sampaio Correia',
    desc: 'Cachoeira no distrito de Sampaio Correia, em Saquarema, cercada de vegetação — opção de banho e natureza no interior do município.' },
]

async function adminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  return data?.id ?? null
}
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

async function create(p: P, admin: string | null, existingByCity: Map<string, any[]>) {
  const existing = existingByCity.get(p.city) || []
  const hit = existing.find(e => norm(e.name) === norm(p.name))
  if (hit) { console.log(`  ↷ SKIP (${p.city}: nome existe) — ${p.name}`); return }
  console.log(`  + [${p.city}] ${p.name.padEnd(48)} [${p.primary}/${p.group}] pl${p.pl}`)
  if (DRY) return
  const { data: att, error } = await db.from('attractions').insert({
    name: p.name, city: p.city, state: STATE, country: COUNTRY, entity_kind: 'poi', neighborhood: p.neighborhood || null,
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
  console.log(`\n=== Região dos Lagos — POIs via Google (batch 2) ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  const admin = await adminId()
  const cities = [...new Set(POIS.map(p => p.city))]
  const existingByCity = new Map<string, any[]>()
  for (const c of cities) {
    const { data } = await db.from('attractions').select('id,name').eq('city', c).eq('entity_kind', 'poi')
    existingByCity.set(c, data || [])
  }
  for (const p of POIS) await create(p, admin, existingByCity)
  for (const c of cities) {
    const { count } = await db.from('attractions').select('id', { count: 'exact', head: true }).eq('city', c).eq('entity_kind', 'poi')
    console.log(`\n=== POIs em ${c}: ${count} ===`)
  }
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
