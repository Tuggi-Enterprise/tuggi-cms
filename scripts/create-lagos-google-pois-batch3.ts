/**
 * create-lagos-google-pois-batch3.ts
 *
 * Terceira leva via Google Places: as três cidades mais turísticas da Região dos
 * Lagos (já bem curadas) — Cabo Frio, Armação dos Búzios e Arraial do Cabo.
 * Só o que faltava (mirantes, praias e marcos ausentes do OSM/banco). Coordenadas
 * do Google. Já ativados. TPs → manuais.
 *
 * Descartados na triagem: "Estátua Flávia Alessandra" (listagem-trote), empresas de
 * barco / listagens-lixo do píer da Prainha, trilhas (viram custom_route) e nomes
 * que parecem negócio (Praça Santos Dumont .111, Vista do Ique & Etty).
 *
 * Uso:  npx tsx --env-file=.env scripts/create-lagos-google-pois-batch3.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')
const STATE = 'Rio de Janeiro', COUNTRY = 'Brazil'

interface P { name: string; city: string; lat: number; lng: number; primary: string; group: string; pl: number; neighborhood?: string; historic?: boolean; desc: string }

const POIS: P[] = [
  // ===================== Cabo Frio =====================
  { name: 'Praia do Florestinha', city: 'Cabo Frio', lat: -22.680499, lng: -41.996103, primary: 'beach', group: 'water', pl: 2, neighborhood: 'Tamoios',
    desc: 'Praia oceânica no distrito de Tamoios, em Cabo Frio, de mar aberto e faixa larga de areia — uma das praias mais movimentadas do litoral norte do município.' },
  { name: 'Duna Preta', city: 'Cabo Frio', lat: -22.881895, lng: -42.009717, primary: 'dune', group: 'nature', pl: 2, neighborhood: 'Passagem',
    desc: 'Duna de areia na região da Passagem, em Cabo Frio — ponto de contemplação da paisagem entre a cidade e o litoral.' },
  { name: 'Charitas', city: 'Cabo Frio', lat: -22.878628, lng: -42.016769, primary: 'attraction', group: 'culture', pl: 2, neighborhood: 'Centro',
    desc: 'Edifício histórico no centro de Cabo Frio, à Avenida Teixeira e Souza, hoje utilizado como espaço cultural da cidade.' },
  { name: 'Praça da Vila Nova', city: 'Cabo Frio', lat: -22.886658, lng: -42.025989, primary: 'park', group: 'parks', pl: 3, neighborhood: 'Centro',
    desc: 'Praça no centro de Cabo Frio, junto à Avenida do Contorno — espaço de convívio urbano.' },
  { name: 'Praia Fofa', city: 'Cabo Frio', lat: -22.881800, lng: -41.991823, primary: 'beach', group: 'water', pl: 3,
    desc: 'Pequena praia de águas claras no litoral oceânico de Cabo Frio, próxima à Praia das Conchas — refúgio tranquilo entre costões.' },
  { name: 'Praia da Pedra Polida', city: 'Cabo Frio', lat: -22.881996, lng: -41.992018, primary: 'beach', group: 'water', pl: 3,
    desc: 'Praia pequena e reservada entre costões rochosos no litoral de Cabo Frio, de águas cristalinas.' },
  { name: 'Mirante de Areia', city: 'Cabo Frio', lat: -22.903036, lng: -42.031778, primary: 'viewpoint', group: 'nature', pl: 3, neighborhood: 'Foguete',
    desc: 'Mirante no bairro Foguete, em Cabo Frio, com vista para a orla e as dunas da região.' },

  // ===================== Armação dos Búzios =====================
  { name: 'Mirante das Ilhas', city: 'Armação dos Búzios', lat: -22.745890, lng: -41.872938, primary: 'viewpoint', group: 'nature', pl: 1, neighborhood: 'Village de Búzios',
    desc: 'Um dos mirantes mais famosos de Búzios, no Village, com vista panorâmica para as praias de João Fernandes e Azeda e as ilhas ao largo da península.' },
  { name: 'Radical Parque', city: 'Armação dos Búzios', lat: -22.760675, lng: -41.889525, primary: 'attraction', group: 'leisure', pl: 2, neighborhood: 'Centro',
    desc: 'Parque de aventura em Armação dos Búzios, na Usina Velha, com atrações de lazer ao ar livre para famílias e grupos.' },
  { name: 'Mirante Serra das Emerências', city: 'Armação dos Búzios', lat: -22.806246, lng: -41.937794, primary: 'viewpoint', group: 'nature', pl: 2,
    desc: 'Mirante na Serra das Emerências, na porção continental de Armação dos Búzios, com vista ampla sobre a península e o litoral.' },
  { name: 'Mirante Praia Brava', city: 'Armação dos Búzios', lat: -22.749987, lng: -41.874624, primary: 'viewpoint', group: 'nature', pl: 2, neighborhood: 'Village de Búzios',
    desc: 'Mirante com vista para a Praia Brava, no Village de Búzios — cenário de falésias e mar aberto.' },
  { name: 'Mirante do Léo', city: 'Armação dos Búzios', lat: -22.763774, lng: -41.877181, primary: 'viewpoint', group: 'nature', pl: 3,
    desc: 'Mirante e ponto de mergulho próximo à Avenida do Forno, em Armação dos Búzios, com vista para o mar.' },
  { name: 'Mirante da Enseada do Gancho', city: 'Armação dos Búzios', lat: -22.759553, lng: -41.908115, primary: 'viewpoint', group: 'nature', pl: 3, neighborhood: 'Ponta de Manguinhos',
    desc: 'Mirante na Ponta de Manguinhos, em Armação dos Búzios, com vista para a Enseada do Gancho e as águas calmas do lado sul da península.' },

  // ===================== Arraial do Cabo =====================
  { name: 'Gruta do Amor', city: 'Arraial do Cabo', lat: -22.986383, lng: -42.009810, primary: 'cave', group: 'nature', pl: 1, neighborhood: 'Pontal do Atalaia',
    desc: 'Gruta à beira-mar próxima às Prainhas do Pontal do Atalaia, em Arraial do Cabo, esculpida pela ação do mar nas rochas — cenário procurado em trilhas e passeios de barco.' },
  { name: 'Praia de Monte Alto', city: 'Arraial do Cabo', lat: -22.949357, lng: -42.117850, primary: 'beach', group: 'water', pl: 2, neighborhood: 'Monte Alto',
    desc: 'Praia oceânica no distrito de Monte Alto, em Arraial do Cabo, de mar aberto e cenário preservado, no litoral oeste do município.' },
  { name: 'Mirante do Forno', city: 'Arraial do Cabo', lat: -22.963188, lng: -42.017438, primary: 'viewpoint', group: 'nature', pl: 2, neighborhood: 'Praia dos Anjos',
    desc: 'Mirante com vista para a Praia do Forno, acessível por trilha a partir da Praia dos Anjos, em Arraial do Cabo — um dos cartões-postais da cidade.' },
  { name: 'Paróquia Sagrado Coração de Jesus', city: 'Arraial do Cabo', lat: -22.966119, lng: -42.028008, primary: 'church', group: 'religious', pl: 2, neighborhood: 'Centro',
    desc: 'Igreja católica no centro de Arraial do Cabo, dedicada ao Sagrado Coração de Jesus.' },
  { name: 'Mirante para as Ilhas dos Franceses', city: 'Arraial do Cabo', lat: -22.978546, lng: -42.034335, primary: 'viewpoint', group: 'nature', pl: 2, neighborhood: 'Praia Grande',
    desc: 'Mirante das Jubartes, na Praia Grande, em Arraial do Cabo, com vista para as Ilhas dos Franceses e o mar aberto — ponto de observação da paisagem litorânea.' },
  { name: 'Mirante da Praia Grande', city: 'Arraial do Cabo', lat: -22.976334, lng: -42.031588, primary: 'viewpoint', group: 'nature', pl: 2, neighborhood: 'Pontal do Atalaia',
    desc: 'Mirante com vista para a extensa Praia Grande, na subida do Pontal do Atalaia, em Arraial do Cabo.' },
  { name: 'Praça do Guarani', city: 'Arraial do Cabo', lat: -22.966829, lng: -42.028104, primary: 'park', group: 'parks', pl: 3, neighborhood: 'Prainha',
    desc: 'Praça no bairro Prainha, em Arraial do Cabo, ponto de encontro próximo à orla.' },
  { name: 'Deck dos Pescadores', city: 'Arraial do Cabo', lat: -22.976789, lng: -42.033889, primary: 'attraction', group: 'leisure', pl: 3, neighborhood: 'Praia Grande',
    desc: 'Deck à beira-mar na Praia Grande, em Arraial do Cabo, usado por pescadores e visitantes para contemplar o mar.' },
  { name: 'Mirante Oscar Corrêa Pita Filho', city: 'Arraial do Cabo', lat: -22.956758, lng: -42.027140, primary: 'viewpoint', group: 'nature', pl: 3, neighborhood: 'Centro',
    desc: 'Mirante conhecido como Pescador Casinho, na entrada de Arraial do Cabo, com vista para a paisagem lagunar e a cidade.' },
  { name: 'Mirante do Coutinho', city: 'Arraial do Cabo', lat: -22.991280, lng: -42.015119, primary: 'viewpoint', group: 'nature', pl: 3, neighborhood: 'Pontal do Atalaia',
    desc: 'Mirante no Pontal do Atalaia, em Arraial do Cabo, com vista para o litoral sul e as praias selvagens da região.' },
  { name: 'Mirante das Antenas', city: 'Arraial do Cabo', lat: -22.949125, lng: -42.027946, primary: 'viewpoint', group: 'nature', pl: 3,
    desc: 'Mirante junto às antenas, em ponto elevado de Arraial do Cabo, com vista ampla sobre a cidade, a Lagoa de Araruama e o mar.' },
  { name: 'Mirante da Barrilha', city: 'Arraial do Cabo', lat: -22.950785, lng: -42.026027, primary: 'viewpoint', group: 'nature', pl: 3,
    desc: 'Mirante da Barrilha, em Arraial do Cabo, com vista panorâmica sobre a cidade e o litoral.' },
  { name: 'Mirante Praia Brava', city: 'Arraial do Cabo', lat: -22.981723, lng: -42.023597, primary: 'viewpoint', group: 'nature', pl: 3,
    desc: 'Mirante com vista para a Praia Brava, no litoral sul de Arraial do Cabo — praia selvagem cercada de costões.' },
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
  console.log(`  + [${p.city}] ${p.name.padEnd(38)} [${p.primary}/${p.group}] pl${p.pl}`)
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
  console.log(`\n=== Região dos Lagos — POIs via Google (batch 3: CF/Búzios/Arraial) ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  const admin = await adminId()
  const cities = [...new Set(POIS.map(p => p.city))]
  const existingByCity = new Map<string, any[]>()
  for (const c of cities) {
    const { data } = await db.from('attractions').select('id,name').eq('city', c).eq('entity_kind', 'poi')
    existingByCity.set(c, data || [])
  }
  for (const p of POIS) await create(p, admin, existingByCity)
  for (const c of cities) {
    const { count } = await db.from('attractions').select('id', { count: 'exact', head: true }).eq('city', c).eq('entity_kind', 'poi').neq('is_active', false)
    console.log(`\n=== ${c}: ${count} POIs ativos ===`)
  }
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
