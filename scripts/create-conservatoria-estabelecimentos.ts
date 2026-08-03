/**
 * create-conservatoria-estabelecimentos.ts
 *
 * Estabelecimentos participantes do Festival Delícias do Vale do Café 2026
 * (Conservatória / Valença-RJ), cadastrados como `place` (entity_kind='place' +
 * place_details), com descrição pt-br. Marcados com a tag do festival.
 * Coordenadas via Google Places. Idempotente por nome. TPs → manuais.
 *
 * Casa Tini e Cachaça da Bisa ficam `pending` até o endereço da single-page do
 * evento (Google não tem ponto confiável). Preencha lat/lng e remova pending.
 *
 * Uso:  npx tsx --env-file=.env scripts/create-conservatoria-estabelecimentos.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')
const CITY = 'Conservatória', STATE = 'Rio de Janeiro', COUNTRY = 'Brazil'
const FEST_TAG = 'delicias-vale-do-cafe-2026'

interface E {
  name: string; lat?: number; lng?: number; place_type: string; address?: string
  pending?: boolean; desc: string
}

const ESTAB: E[] = [
  { name: 'La Serenata', lat: -22.288612, lng: -43.926975, place_type: 'restaurant', address: 'R. Luiz de Almeida Pinto, 67 - Conservatória',
    desc: 'Um dos restaurantes mais tradicionais e badalados de Conservatória, na esquina das serenatas. Cozinha regional farta em ambiente que respira a música da cidade. Participa do Festival Delícias do Vale do Café 2026.' },
  { name: 'Bistrô do Poeta', lat: -22.288755, lng: -43.926940, place_type: 'restaurant', address: 'R. Luiz de Almeida Pinto, 66 - Conservatória',
    desc: 'Bistrô no coração do centro histórico de Conservatória, na movimentada Rua Luiz de Almeida Pinto, com a cozinha afetiva do Vale do Café em clima de seresta. Participante do Festival Delícias do Vale do Café 2026.' },
  { name: 'Dó Ré Mi', lat: -22.288714, lng: -43.926630, place_type: 'restaurant', address: 'Trav. Prof. Geralda da Fonseca, 31 - Conservatória',
    desc: 'Restaurante tradicional de Conservatória cujo nome homenageia a música das serestas, servindo pratos generosos da cozinha mineira e do Vale do Café. Participa do Festival Delícias do Vale do Café 2026.' },
  { name: 'Panela de Pedra', lat: -22.288445, lng: -43.926470, place_type: 'restaurant', address: 'R. Luiz de Almeida Pinto, 131 - Conservatória',
    desc: 'Restaurante de Conservatória especializado na cozinha de panela, com pratos na tradição da comida de fazenda do Vale do Café. Participante do Festival Delícias do Vale do Café 2026.' },
  { name: 'Nossa Esquina Bistrô', lat: -22.288731, lng: -43.927377, place_type: 'cafe', address: 'R. Luiz de Almeida Pinto, 23 - Conservatória',
    desc: 'Café e bistrô numa esquina do centro histórico de Conservatória, com cardápio afetivo e cafés do Vale do Café. Participa do Festival Delícias do Vale do Café 2026.' },
  { name: 'Boteco Tempera', lat: -22.288717, lng: -43.927639, place_type: 'bar', address: 'Praça Getúlio Vargas, 01 - Conservatória',
    desc: 'Boteco à beira da praça das serestas, em Conservatória, com petiscos e temperos da cozinha de boteco em ambiente descontraído. Participante do Festival Delícias do Vale do Café 2026.' },
  { name: 'Du Burguer', lat: -22.288430, lng: -43.925499, place_type: 'restaurant', address: 'R. Oswaldo Fonseca, 190 - Conservatória',
    desc: 'Hamburgueria artesanal no centro de Conservatória, ponto para lanches entre uma seresta e outra. Participa do Festival Delícias do Vale do Café 2026.' },
  { name: 'Malu Estúdio Gastronômico', lat: -22.294989, lng: -43.925745, place_type: 'restaurant', address: 'Rod. Canção do Amor, 13684 - Conservatória',
    desc: 'Estúdio gastronômico em Conservatória, com proposta autoral que une técnica e ingredientes do Vale do Café. Participante do Festival Delícias do Vale do Café 2026.' },
  { name: 'Coronel', lat: -22.304158, lng: -43.934844, place_type: 'restaurant', address: 'R. Dr. Luiz de Almeida, 103 - Conservatória',
    desc: 'Restaurante em Conservatória com pratos da cozinha de fazenda do Vale do Café. Participa do Festival Delícias do Vale do Café 2026.' },
  { name: 'Linda Borboleta', lat: -22.286741, lng: -43.923234, place_type: 'guesthouse', address: 'R. Ludovico Cosate, 54 - Conservatória',
    desc: 'Pousada charmosa em Conservatória, no distrito das serestas, que participa do Festival Delícias do Vale do Café 2026 com sua cozinha.' },

  // ——— endereço confirmado pelo organizador (R. Oswaldo Fonseca, 5, junto à Praça) ———
  { name: 'Casa Tini', lat: -22.289448, lng: -43.927005, place_type: 'restaurant', address: 'R. Oswaldo Fonseca, 5 - Conservatória',
    desc: 'Estabelecimento gastronômico de Conservatória, na esquina da praça das serestas, participante do Festival Delícias do Vale do Café 2026.' },
  { name: 'Cachaça da Bisa', lat: -22.289448, lng: -43.927005, place_type: 'producer', address: 'R. Oswaldo Fonseca, 5 - Conservatória',
    desc: 'Cachaça artesanal de Conservatória, junto à praça das serestas, participante do Festival Delícias do Vale do Café 2026.' },
]

async function adminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  return data?.id ?? null
}
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

async function create(e: E, admin: string | null, existing: any[]) {
  if (e.pending || e.lat == null) { console.log(`  ⏳ PENDENTE (falta endereço) — ${e.name}`); return }
  const hit = existing.find(x => norm(x.name) === norm(e.name))
  if (hit) { console.log(`  ↷ SKIP (existe ${hit.id}) — ${e.name}`); return }
  console.log(`  + ${e.name.padEnd(28)} [${e.place_type}]`)
  if (DRY) return
  const { data: att, error } = await db.from('attractions').insert({
    name: e.name, city: CITY, state: STATE, country: COUNTRY, entity_kind: 'place', neighborhood: 'Conservatória',
    is_active: true, approved: true, category_group: 'place', primary_category: e.place_type,
    priority_level: 2, is_touristic: true, formatted_address: e.address ? `${e.address}, Valença - RJ` : null,
    description: e.desc, import_source: 'manual', source_type: 'manual', created_by: admin, processing_status: 'pending',
  }).select('id').single()
  if (error || !att) { console.error(`      ✗ ${error?.message}`); return }
  const { error: e2 } = await db.rpc('insert_coordinate_safe', { p_attraction_id: att.id, p_latitude: e.lat, p_longitude: e.lng, p_show_in_map: true })
  if (e2) { console.error(`      ✗ coord ${e2.message} — removendo`); await db.from('attractions').delete().eq('id', att.id); return }
  const { error: e3 } = await db.from('place_details').insert({ attraction_id: att.id, place_type: e.place_type, cuisine: [], tags: [FEST_TAG], created_by: admin })
  if (e3) console.error(`      ⚠ place_details: ${e3.message}`)
  await db.from('attraction_descriptions').insert({ attraction_id: att.id, language: 'pt-br', description: e.desc, play_count: 0 })
  console.log(`      ✓ id=${att.id}`)
}

async function main() {
  console.log(`\n=== Conservatória — estabelecimentos do festival ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  const admin = await adminId()
  const { data: existing } = await db.from('attractions').select('id,name').eq('city', CITY).eq('entity_kind', 'place')
  for (const e of ESTAB) await create(e, admin, existing || [])
  const { count } = await db.from('attractions').select('id', { count: 'exact', head: true }).eq('city', CITY).eq('entity_kind', 'place').neq('is_active', false)
  console.log(`\n=== places ativos em Conservatória: ${count} ===\n`)
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
