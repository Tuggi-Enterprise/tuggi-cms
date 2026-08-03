/**
 * create-conservatoria-pois.ts
 *
 * Pontos turísticos de Conservatória (distrito de Valença/RJ, Vale do Café —
 * "Capital da Seresta"), para a ação de patrocínio do Festival Delícias do Vale
 * do Café 2026. Fontes: Google Places + Secretaria de Cultura/Turismo de Valença
 * + guias de turismo do Vale do Café. Coordenadas do Google (sem osm_id).
 * Já ativados. TPs → manuais.
 *
 * Corrige também o "Túnel que Chora" pré-existente (import com rótulo/coord errados).
 *
 * Uso:  npx tsx --env-file=.env scripts/create-conservatoria-pois.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')
const CITY = 'Conservatória', STATE = 'Rio de Janeiro', COUNTRY = 'Brazil'

interface P { name: string; lat: number; lng: number; primary: string; group: string; pl: number; historic?: boolean; desc: string }

const POIS: P[] = [
  { name: 'Praça de Conservatória', lat: -22.289553, lng: -43.927002, primary: 'park', group: 'parks', pl: 1,
    desc: 'Coração de Conservatória, a praça central (Praça Getúlio Vargas) é o palco das serestas que dão fama à cidade. Com coreto, o Caminho Joubert e cercada pelos casarões coloniais, reúne moradores e visitantes ao redor da música — e sedia a abertura do Festival Delícias do Vale do Café.' },
  { name: 'Igreja Matriz de Santo Antônio', lat: -22.289630, lng: -43.927937, primary: 'church', group: 'religious', pl: 1, historic: true,
    desc: 'Igreja matriz de Conservatória, dedicada a Santo Antônio, no conjunto histórico do centro. Marco religioso e arquitetônico que emoldura a praça das serestas.' },
  { name: 'Casa da Cultura de Conservatória', lat: -22.290138, lng: -43.927581, primary: 'museum', group: 'culture', pl: 1,
    desc: 'Casa da Cultura de Conservatória, sede do Museu da Seresta — que guarda o maior acervo de músicas de seresta do país — e ponto de encontro dos seresteiros. Reúne ainda os museus dedicados a Vicente Celestino, Sílvio Caldas, Nelson Gonçalves e outros nomes da música brasileira. Entrada gratuita.' },
  { name: 'Antiga Estação Ferroviária de Conservatória', lat: -22.287198, lng: -43.924469, primary: 'historic_site', group: 'culture', pl: 1, historic: true,
    desc: 'Antiga estação da linha férrea que deu origem a Conservatória, hoje um dos cartões-postais do distrito. Preserva vagões e a memória do ciclo do café e da ferrovia no Vale do Café.' },
  { name: 'Ponte dos Arcos', lat: -22.263559, lng: -43.946484, primary: 'historic_site', group: 'culture', pl: 1, historic: true,
    desc: 'Ponte histórica erguida em pedra, cal e óleo de baleia no século XIX para a passagem da ferrovia. Uma das obras mais fotografadas de Conservatória, testemunho da engenharia do tempo do café.' },
  { name: 'Mirante da Serra da Beleza', lat: -22.259457, lng: -44.000966, primary: 'viewpoint', group: 'nature', pl: 1,
    desc: 'Mirante na Serra da Beleza, às margens da RJ-137, com vista deslumbrante sobre as montanhas e o Vale do Café. Parada obrigatória no caminho de Conservatória a Santa Isabel do Rio Preto.' },
  { name: 'Cachoeira da Índia', lat: -22.287471, lng: -43.914313, primary: 'waterfall', group: 'nature', pl: 2,
    desc: 'Cachoeira em meio à Mata Atlântica próxima ao centro de Conservatória, com poço para banho — refúgio natural a poucos minutos das serestas.' },
  { name: 'Instituto Waldir Azevedo', lat: -22.289573, lng: -43.925844, primary: 'museum', group: 'culture', pl: 2,
    desc: 'Museu que conserva o acervo pessoal de Waldir Azevedo, autor do choro "Brasileirinho", um dos maiores nomes do cavaquinho brasileiro, no centro histórico de Conservatória.' },
  { name: 'Museu Vicente Celestino', lat: -22.290038, lng: -43.927441, primary: 'museum', group: 'culture', pl: 2,
    desc: 'Museu dedicado ao cantor Vicente Celestino, parte do conjunto de museus da seresta de Conservatória, com discos, fotografias e memórias do artista.' },
  { name: 'Monumento à Seresta de Conservatória', lat: -22.288833, lng: -43.926555, primary: 'monument', group: 'culture', pl: 3,
    desc: 'Monumento que homenageia a seresta, tradição musical que consagrou Conservatória como a "Capital da Seresta", no centro do distrito.' },
]

// Correção do Túnel que Chora pré-existente
const TUNNEL_FIX = {
  match_names: ['Túnel que Chora', 'Túnel que Chora (Valença, BH)'],
  name: 'Túnel que Chora',
  lat: -22.291442, lng: -43.925635,
  patch: { name: 'Túnel que Chora', city: CITY, state: STATE, country: COUNTRY, primary_category: 'historic_site', category_group: 'culture', is_historic: true, is_touristic: true, priority_level: 1, is_active: true } as any,
  desc: 'Túnel ferroviário escavado à mão por escravizados no século XIX, com 95 metros de calçamento em pé-de-moleque. Suas paredes úmidas escorrem água o ano todo — daí o nome — e a acústica faz dele um cenário mágico para as serestas. É a atração mais visitada de Conservatória.',
}

async function adminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  return data?.id ?? null
}
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

async function setCoord(id: string, lat: number, lng: number) {
  // manual upsert (sem unique constraint em attraction_id)
  const { data: ex } = await db.from('attraction_coordinate').select('attraction_id').eq('attraction_id', id).maybeSingle()
  if (ex) await db.from('attraction_coordinate').update({ latitude: lat, longitude: lng, show_in_map: true }).eq('attraction_id', id)
  else await db.rpc('insert_coordinate_safe', { p_attraction_id: id, p_latitude: lat, p_longitude: lng, p_show_in_map: true })
}

async function create(p: P, admin: string | null, existing: any[]) {
  const hit = existing.find(e => norm(e.name) === norm(p.name))
  if (hit) { console.log(`  ↷ SKIP (existe ${hit.id}) — ${p.name}`); return }
  console.log(`  + ${p.name.padEnd(42)} [${p.primary}/${p.group}] pl${p.pl}`)
  if (DRY) return
  const { data: att, error } = await db.from('attractions').insert({
    name: p.name, city: CITY, state: STATE, country: COUNTRY, entity_kind: 'poi', neighborhood: 'Conservatória',
    is_active: true, approved: true, primary_category: p.primary, category_group: p.group,
    priority_level: p.pl, is_touristic: p.pl <= 2, is_notable: p.pl <= 2, is_historic: !!p.historic,
    description: p.desc, import_source: 'manual', source_type: 'manual', created_by: admin, processing_status: 'pending',
  }).select('id').single()
  if (error || !att) { console.error(`      ✗ ${error?.message}`); return }
  await setCoord(att.id, p.lat, p.lng)
  await db.from('attraction_descriptions').insert({ attraction_id: att.id, language: 'pt-br', description: p.desc, play_count: 0 })
  console.log(`      ✓ id=${att.id}`)
}

async function fixTunnel(admin: string | null) {
  console.log('\n· Túnel que Chora (correção):')
  // procura em Conservatória e Valença
  const { data: cand } = await db.from('attractions').select('id,name,city').or('city.eq.Conservatória,city.eq.Valença').ilike('name', '%Túnel que Chora%')
  const m = (cand || [])[0]
  if (!m) { console.log('  ? não encontrado — criando novo'); if (!DRY) { const { data: att } = await db.from('attractions').insert({ name: TUNNEL_FIX.name, city: CITY, state: STATE, country: COUNTRY, neighborhood: 'Conservatória', entity_kind: 'poi', is_active: true, approved: true, ...TUNNEL_FIX.patch, description: TUNNEL_FIX.desc, import_source: 'manual', source_type: 'manual', created_by: admin, processing_status: 'pending' }).select('id').single(); if (att) { await setCoord(att.id, TUNNEL_FIX.lat, TUNNEL_FIX.lng); await db.from('attraction_descriptions').insert({ attraction_id: att.id, language: 'pt-br', description: TUNNEL_FIX.desc, play_count: 0 }); console.log(`      ✓ criado ${att.id}`) } } return }
  console.log(`  ✎ ${m.id} (${m.name} / ${m.city}) → corrige nome/cidade/coord`)
  if (DRY) return
  await db.from('attractions').update(TUNNEL_FIX.patch).eq('id', m.id)
  await setCoord(m.id, TUNNEL_FIX.lat, TUNNEL_FIX.lng)
  const { data: d } = await db.from('attraction_descriptions').select('id').eq('attraction_id', m.id).eq('language', 'pt-br').maybeSingle()
  if (d) await db.from('attraction_descriptions').update({ description: TUNNEL_FIX.desc }).eq('id', d.id)
  else await db.from('attraction_descriptions').insert({ attraction_id: m.id, language: 'pt-br', description: TUNNEL_FIX.desc, play_count: 0 })
  console.log('      ✓ corrigido')
}

async function main() {
  console.log(`\n=== Conservatória — POIs ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  const admin = await adminId()
  const { data: existing } = await db.from('attractions').select('id,name').eq('city', CITY).eq('entity_kind', 'poi')
  for (const p of POIS) await create(p, admin, existing || [])
  await fixTunnel(admin)
  const { count } = await db.from('attractions').select('id', { count: 'exact', head: true }).eq('city', CITY).eq('entity_kind', 'poi').neq('is_active', false)
  console.log(`\n=== POIs ativos em Conservatória: ${count} ===\n`)
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
