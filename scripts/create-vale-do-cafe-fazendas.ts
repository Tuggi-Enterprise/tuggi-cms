/**
 * create-vale-do-cafe-fazendas.ts
 *
 * Fazendas históricas do ciclo do café + casarões/solares/museus do Vale do Café (RJ),
 * levantados por pesquisa multi-fonte (Instituto Preservale, IPHAN/INEPAC via
 * ipatrimonio.org, visitevassouras.com, portalvaledocafe, prefeituras) e verificados.
 * Geocode via Google Places (rejeita hit fora da região / fora do município).
 * Descrição = síntese factual da fonte. Idempotente (dedup por nome+cidade). POIs.
 * Já ativados. TPs → manuais.
 *
 * Fora de escopo: Fazenda Santa Clara (fica em MG) e Museu da Seresta (já cadastrado
 * como "Casa da Cultura de Conservatória").
 *
 * Uso:  npx tsx --env-file=.env scripts/create-vale-do-cafe-fazendas.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false }, db: { schema: 'core' } })
const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!
const DRY = process.argv.includes('--dry')
const STATE = 'Rio de Janeiro', COUNTRY = 'Brazil'
// bbox amplo da região do Vale do Café (RJ)
const REGION = { s: -23.05, n: -21.85, w: -44.75, e: -43.10 }

type Vis = 'sim' | 'eventos' | 'desconhecido' | 'nao'
interface F { name: string; city: string; neighborhood?: string; kind: 'fazenda' | 'casarao' | 'museu'; vis: Vis; desc: string }

// city = município (Conservatória tratada como cidade própria)
const ITEMS: F[] = [
  // Barra do Piraí
  { name: 'Fazenda Arvoredo', city: 'Barra do Piraí', kind: 'fazenda', vis: 'sim', desc: 'Fazenda cafeeira fundada em 1818 e reconstruída em 1858 por José Luiz Gomes, Barão de Mambucaba. Desde 1991 funciona como hotel-fazenda, preservando a arquitetura do ciclo do café no Vale do Paraíba.' },
  { name: 'Fazenda da Taquara', city: 'Barra do Piraí', kind: 'fazenda', vis: 'sim', desc: 'Fazenda cafeeira fundada em 1830 pelo Comendador João Pereira da Silva, tombada pelo INEPAC em 1987. Ainda produz café na sexta geração e abriga restaurante e visitas guiadas.' },
  { name: 'Fazenda São João da Prosperidade', city: 'Barra do Piraí', kind: 'fazenda', vis: 'sim', desc: 'Fazenda cafeeira de 1820-1830 cujo primeiro dono foi Antonio Gonçalves de Morais, o "Capitão Mata Gente". Hoje é destino turístico com acervo original e visitas agendadas.' },
  { name: 'Fazenda Alliança', city: 'Barra do Piraí', neighborhood: 'RJ-145', kind: 'fazenda', vis: 'eventos', desc: 'Sede cafeeira de 1863 restaurada a partir de 2007, na estrada Barra do Piraí–Valença. Hoje é fazenda orgânica certificada, com café especial e búfalas, e circuito histórico e agroecológico.' },
  { name: 'Fazenda Ponte Alta', city: 'Barra do Piraí', kind: 'fazenda', vis: 'eventos', desc: 'Fazenda do século XIX ligada a encontros políticos de Getúlio Vargas nos anos 1950. Hoje sedia eventos culturais, como o Sarau Getúlio Vargas.' },
  { name: 'Fazenda da Bocaina', city: 'Barra do Piraí', kind: 'fazenda', vis: 'nao', desc: 'Propriedade rural com cerca de 160 a 180 anos, restaurada e mantida pela família proprietária, testemunho da arquitetura rural do ciclo do café.' },
  // Sapucaia (município vizinho do Vale do Paraíba fluminense) — indicada pelo operador
  { name: 'Fazenda da Bocaina', city: 'Sapucaia', neighborhood: 'Nossa Senhora da Aparecida', kind: 'fazenda', vis: 'desconhecido', desc: 'Fazenda histórica no distrito de Nossa Senhora da Aparecida, em Sapucaia, na região serrana do Vale do Paraíba fluminense ligada ao ciclo do café.' },
  // Engenheiro Paulo de Frontin
  { name: 'Fazenda das Palmas', city: 'Engenheiro Paulo de Frontin', neighborhood: 'Sacra Família do Tinguá', kind: 'fazenda', vis: 'desconhecido', desc: 'Fazenda do ciclo do café surgida entre o fim do século XVIII e o início do XIX, fundada por Bento Luiz de Oliveira Braga, em Sacra Família do Tinguá.' },
  // Mendes
  { name: 'Fazenda da Taquara', city: 'Mendes', neighborhood: 'zona rural', kind: 'fazenda', vis: 'sim', desc: 'Fazenda cafeeira cuja casa-sede foi construída por volta da década de 1830, na zona rural de Mendes. Oferece visitas guiadas ao casarão, ao cafezal e degustação de café.' },
  // Miguel Pereira
  { name: 'Fazenda Santa Cecília', city: 'Miguel Pereira', kind: 'fazenda', vis: 'desconhecido', desc: 'Fazenda de café de 1780 (antiga Fazenda da Piedade), originalmente de Manuel Azevedo Matos e depois do Barão de Paty do Alferes, a cerca de 15 km da sede de Miguel Pereira.' },
  // Paraíba do Sul
  { name: 'Fazenda Maravilha', city: 'Paraíba do Sul', neighborhood: 'zona rural', kind: 'fazenda', vis: 'desconhecido', desc: 'Sede rural cafeeira de meados do século XIX, de Joaquim Antônio Pereira da Cunha. Foi visitada por D. Pedro II e fotografada por Victor Frond em 1858; tombamento provisório pelo INEPAC (2008).' },
  { name: 'Fazenda Santo André', city: 'Paraíba do Sul', neighborhood: 'zona rural', kind: 'fazenda', vis: 'desconhecido', desc: 'Fazenda de café fundada por volta de 1840 por Carlos Pereira Nunes, Barão de São Carlos, com tombamento provisório pelo INEPAC (2008).' },
  { name: 'Palacete Barão Ribeiro de Sá', city: 'Paraíba do Sul', neighborhood: 'Centro', kind: 'casarao', vis: 'eventos', desc: 'Palacete histórico da elite cafeeira que hoje abriga a sede da Prefeitura Municipal de Paraíba do Sul.' },
  // Paty do Alferes
  { name: 'Parque Municipal Fazenda Monte Alegre', city: 'Paty do Alferes', neighborhood: 'RJ-125', kind: 'museu', vis: 'sim', desc: 'Sede do século XIX onde residiu e morreu, em 1861, Francisco Peixoto de Lacerda Werneck, o Barão de Paty do Alferes. Hoje é o Parque Municipal Fazenda Monte Alegre, aberto ao público.' },
  { name: 'Fazenda Maravilha', city: 'Paty do Alferes', neighborhood: 'Sesmaria do Governo', kind: 'fazenda', vis: 'desconhecido', desc: 'Fazenda cafeeira do século XIX (antiga Fazenda do Governo), em processo de tombamento provisório, ainda em atividade com café e gado leiteiro.' },
  { name: 'Fazenda Santa Tereza', city: 'Paty do Alferes', neighborhood: 'zona rural', kind: 'fazenda', vis: 'nao', desc: 'Fazenda de café de 1822 pertencente ao Barão de Paty do Alferes (família Werneck); hoje é sede do Haras da Aldeia, com criação de cavalos Mangalarga Marchador.' },
  { name: 'Câmara Municipal de Paty do Alferes', city: 'Paty do Alferes', neighborhood: 'Centro', kind: 'casarao', vis: 'desconhecido', desc: 'Edifício de 1881 notável pelos azulejos portugueses, tombado pelo INEPAC, no centro de Paty do Alferes.' },
  // Pinheiral
  { name: 'Fazenda Santo Antônio das Palmeiras', city: 'Pinheiral', kind: 'fazenda', vis: 'desconhecido', desc: 'Uma das mais antigas fazendas de Pinheiral (originalmente Fazenda das Palmeiras). Preserva mobiliário de época e capela com imagens sacras.' },
  { name: 'Fazenda São José do Pinheiro', city: 'Pinheiral', kind: 'fazenda', vis: 'sim', desc: 'Antiga fazenda cafeeira que pertenceu ao Comendador Joaquim José de Souza Breves. Desde 1910 sedia escola agrícola — hoje o IFRJ Campus Pinheiral —, com visitas às instalações históricas.' },
  // Piraí
  { name: 'Centro Histórico de Piraí', city: 'Piraí', neighborhood: 'Centro', kind: 'casarao', vis: 'sim', desc: 'Conjunto de casarões coloniais, igrejas e prédios históricos do ciclo do café, tombado pelo INEPAC, visitável em passeios guiados.' },
  { name: 'Casa de Cultura de Piraí', city: 'Piraí', neighborhood: 'Centro', kind: 'museu', vis: 'sim', desc: 'Instalada em antiga cadeia do século XIX, abriga museu, biblioteca, teatro e sala de exposições, no centro de Piraí.' },
  { name: 'Casarão Cultural de Arrozal', city: 'Piraí', neighborhood: 'Arrozal', kind: 'casarao', vis: 'sim', desc: 'Edifício do século XIX no distrito de Arrozal que hoje abriga museu, biblioteca e espaço para eventos culturais.' },
  { name: 'Paço Municipal de Piraí', city: 'Piraí', neighborhood: 'Centro', kind: 'casarao', vis: 'sim', desc: 'Edifício neoclássico de 1880, sede da prefeitura de Piraí, tombado pelo patrimônio municipal em 1986.' },
  // Rio das Flores
  { name: 'Fazenda União', city: 'Rio das Flores', neighborhood: 'Abarracamento', kind: 'fazenda', vis: 'sim', desc: 'Sede de 1836 construída pelo Visconde de Rio Preto, com mobiliário original, na Estrada do Abarracamento (RJ-135). Hoje é hotel-fazenda histórico com acervo imperial e visitas guiadas.' },
  { name: 'Fazenda do Paraízo', city: 'Rio das Flores', kind: 'museu', vis: 'sim', desc: 'Sede erguida entre 1845 e 1853 por Domingos Custódio Guimarães, Barão e depois Visconde de Rio Preto. Hoje é residência-museu da família Belfort, com visitas guiadas.' },
  { name: 'Fazenda Santo Inácio', city: 'Rio das Flores', kind: 'fazenda', vis: 'sim', desc: 'Fazenda cafeeira do século XIX com mobiliário de época, próxima à divisa com Valença. Hoje funciona como restaurante e propriedade histórica visitável mediante contato.' },
  // Três Rios
  { name: 'Fazenda Bemposta', city: 'Três Rios', neighborhood: 'Bemposta', kind: 'fazenda', vis: 'nao', desc: 'Fazenda de 1805, símbolo do ciclo do café no Vale do Paraíba, tombada pelo INEPAC em 2012 e em processo de restauração, no distrito de Bemposta.' },
  { name: 'Fazenda São Lourenço', city: 'Três Rios', neighborhood: 'zona rural', kind: 'fazenda', vis: 'desconhecido', desc: 'Casa-sede cafeeira do século XIX erguida pelo Barão de Entre-Rios, destacada pela excelência arquitetônica e pelo estado de conservação.' },
  { name: 'Casarão Generoso Portela', city: 'Três Rios', neighborhood: 'Centro', kind: 'casarao', vis: 'desconhecido', desc: 'Casarão urbano histórico na Rua da Maçonaria, reconhecido como patrimônio cultural do estado do Rio de Janeiro.' },
  // Valença
  { name: 'Fazenda Santo Antônio do Paiol', city: 'Valença', neighborhood: 'zona rural', kind: 'fazenda', vis: 'sim', desc: 'Fazenda cafeeira fundada em 1852, com casa-sede neoclássica de 1850, pioneira em turismo cultural desde os anos 1960. Hoje une agropecuária, visitação guiada e o centro de espiritualidade Dom Orione.' },
  { name: 'Fazenda Vista Alegre', city: 'Valença', neighborhood: 'zona rural', kind: 'fazenda', vis: 'sim', desc: 'Fazenda cafeeira do século XIX que abrigou uma Escola de Ingênuos, para filhos de escravizados e crianças pobres. Hoje funciona como guest house, com visitação guiada.' },
  { name: 'Fazenda Campo Alegre', city: 'Valença', neighborhood: 'zona rural', kind: 'fazenda', vis: 'eventos', desc: 'Fazenda com origem no século XVIII e auge no Ciclo do Café, detentora do maior terreiro de café registrado no estado do Rio de Janeiro. Hoje restaurada e usada como espaço de eventos, a poucos minutos do centro de Valença.' },
  { name: 'Fazenda Santa Mônica', city: 'Valença', neighborhood: 'Barão de Juparanã', kind: 'fazenda', vis: 'nao', desc: 'Maior fazenda do Marquês de Baependy, fundada por volta de 1820, onde o Duque de Caxias viveu seus últimos anos e faleceu em 1880. Desde 1912 é campo experimental federal (Embrapa), em Barão de Juparanã.' },
  { name: 'Solar da Fazenda Monte Scylene', city: 'Valença', neighborhood: 'Barão de Juparanã', kind: 'casarao', vis: 'desconhecido', desc: 'Solar oitocentista que foi residência da Princesa Isabel e do Conde d’Eu, onde por volta de 1886 o casal instalou um internato para menores. Em processo de restauração, em Barão de Juparanã.' },
  { name: 'Antigo Palacete Visconde do Rio Preto', city: 'Valença', neighborhood: 'Centro', kind: 'casarao', vis: 'nao', desc: 'Palacete do século XIX tombado pelo INEPAC, na praça ajardinada por Auguste Glaziou (1884). Hoje é ocupado pelo Colégio Estadual Theodorico Fonseca.' },
  { name: 'Antigo Solar Nicolau Leoni', city: 'Valença', neighborhood: 'Centro', kind: 'casarao', vis: 'nao', desc: 'Solar do século XIX tombado pelo INEPAC, na Rua Domingos Mariano, no Centro Histórico de Valença.' },
  // Vassouras
  { name: 'Museu Casa da Hera', city: 'Vassouras', neighborhood: 'Centro', kind: 'museu', vis: 'sim', desc: 'Casa-museu da primeira metade do século XIX, residência de Joaquim José Teixeira Leite, importante comerciante de café, e depois de sua filha Eufrásia Teixeira Leite. Preserva o acervo original.' },
  { name: 'Fazenda Santa Eufrásia', city: 'Vassouras', neighborhood: 'zona rural', kind: 'fazenda', vis: 'sim', desc: 'Única fazenda histórica de Vassouras tombada pelo IPHAN, do ciclo do café do século XIX, aberta a visitas guiadas.' },
  { name: 'Fazenda São Luiz da Boa Sorte', city: 'Vassouras', neighborhood: 'zona rural', kind: 'fazenda', vis: 'sim', desc: 'Sede cafeeira construída em 1835 que abriga o único Museu do Café da região, aberta a visitas com foco na história do café.' },
  { name: 'Fazenda Cachoeira do Mato Dentro', city: 'Vassouras', neighborhood: 'zona rural', kind: 'fazenda', vis: 'sim', desc: 'Fazenda cafeeira do século XIX que pertenceu ao Barão do Ribeirão e preserva o banheiro de pedra dos escravizados.' },
  { name: 'Fazenda São Fernando', city: 'Vassouras', neighborhood: 'zona rural', kind: 'fazenda', vis: 'sim', desc: 'Fundada no início do século XIX por Luis dos Santos Werneck; hoje pioneira em agricultura orgânica e caprinocultura, aberta a visitas.' },
  { name: 'Fazenda Mulungu Vermelho', city: 'Vassouras', neighborhood: 'zona rural', kind: 'fazenda', vis: 'sim', desc: 'Sede cafeeira construída em 1831 que chegou a cultivar cerca de 280 mil pés de café, aberta a visitas.' },
  { name: 'Fazenda São Roque', city: 'Vassouras', neighborhood: 'zona rural', kind: 'fazenda', vis: 'sim', desc: 'Uma das mais antigas fazendas de Vassouras, do ciclo do café. Hoje oferece apresentações de teatro histórico e visitas guiadas.' },
  { name: 'Fazenda do Secretário', city: 'Vassouras', neighborhood: 'zona rural', kind: 'fazenda', vis: 'sim', desc: 'Sede neoclássica construída em 1830 por Laureano Corrêa e Castro, Barão de Campo Belo, com jardins à francesa e pinturas de época. Cenário de produções cinematográficas, aberta a visitas.' },
  // Conservatória (distrito de Valença — cidade própria no cadastro)
  { name: 'Fazenda Florença', city: 'Conservatória', kind: 'fazenda', vis: 'sim', desc: 'Fazenda histórica do século XIX com casarão de influência neoclássica, em Conservatória. Hoje é hotel-fazenda, com visita guiada e o Sarau Imperial.' },
]

function pl(vis: Vis): number { return vis === 'sim' ? 1 : vis === 'nao' ? 3 : 2 }
function primary(kind: F['kind']): string { return kind === 'museu' ? 'museum' : 'historic_site' }
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').trim()

async function adminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  return data?.id ?? null
}

// Coords recuperadas à mão (Google só devolve homônimo de outro município pela busca direta).
const COORD_OVERRIDE: Record<string, { lat: number; lng: number }> = {
  'Fazenda São José do Pinheiro|Pinheiral': { lat: -22.518444, lng: -43.995083 }, // = IFRJ Campus Pinheiral
  'Fazenda Bemposta|Três Rios': { lat: -22.161160, lng: -43.098722 },              // distrito de Bemposta
  'Fazenda das Palmas|Engenheiro Paulo de Frontin': { lat: -22.478365, lng: -43.651610 },
  'Fazenda da Bocaina|Sapucaia': { lat: -21.970801, lng: -42.792058 },             // Nossa Sra. da Aparecida, Sapucaia
}
// HOLD: nunca geocodar/criar sem coord verificada (Google devolve resultado errado —
// ex.: Bocaina/Barra do Piraí colou no ponto da Fazenda Alliança). Geocode manual pendente.
const HOLD = new Set(['Fazenda da Bocaina|Barra do Piraí', 'Fazenda da Taquara|Mendes'])

async function geocode(f: F): Promise<{ lat: number; lng: number; matched: boolean } | null> {
  const ov = COORD_OVERRIDE[`${f.name}|${f.city}`]
  if (ov) return { ...ov, matched: true }
  const q = `${f.name} ${f.city} RJ`
  const u = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&region=br&language=pt-BR&key=${KEY}`
  const d: any = await (await fetch(u)).json()
  const cityN = norm(f.city)
  const inRegion = (r: any) => { const l = r.geometry.location; return l.lat >= REGION.s && l.lat <= REGION.n && l.lng >= REGION.w && l.lng <= REGION.e }
  const results = (d.results || []).filter(inRegion)
  // preferir resultado cujo endereço cita o município
  // exige que o endereço cite o município — homônimos e vazamentos são rejeitados
  // (ficam para geocode manual) em vez de gravar coordenada errada.
  const byCity = results.find((r: any) => norm(r.formatted_address || '').includes(cityN))
  if (!byCity) return null
  const l = byCity.geometry.location
  return { lat: +l.lat.toFixed(6), lng: +l.lng.toFixed(6), matched: true }
}

async function main() {
  console.log(`\n=== Vale do Café — fazendas & casarões ${DRY ? '(DRY)' : '(EXECUTANDO)'} — ${ITEMS.length} itens ===\n`)
  const admin = await adminId()
  // cache de existentes por cidade
  const cities = [...new Set(ITEMS.map(i => i.city))]
  const existing = new Map<string, any[]>()
  for (const c of cities) { const { data } = await db.from('attractions').select('id,name').eq('city', c).eq('entity_kind', 'poi'); existing.set(c, data || []) }

  let created = 0, skipped = 0, nocoord = 0
  const noCoordList: string[] = []
  for (const f of ITEMS) {
    const ex = existing.get(f.city) || []
    if (ex.find(e => norm(e.name) === norm(f.name))) { console.log(`  ↷ existe — ${f.name} (${f.city})`); skipped++; continue }
    if (HOLD.has(`${f.name}|${f.city}`)) { console.log(`  ⏸ HOLD (coord manual) — ${f.name} (${f.city})`); noCoordList.push(`${f.name} (${f.city})`); nocoord++; continue }
    const geo = await geocode(f)
    await new Promise(r => setTimeout(r, 350))
    if (!geo) { console.log(`  ⚠ SEM COORD — ${f.name} (${f.city})`); noCoordList.push(`${f.name} (${f.city})`); nocoord++; continue }
    const p = pl(f.vis)
    console.log(`  + ${f.name.padEnd(38)} ${f.city.padEnd(22)} [${primary(f.kind)}/pl${p}] ${geo.matched ? '' : '≈'}(${geo.lat},${geo.lng})`)
    if (DRY) { created++; continue }
    const { data: att, error } = await db.from('attractions').insert({
      name: f.name, city: f.city, state: STATE, country: COUNTRY, neighborhood: f.neighborhood || null,
      entity_kind: 'poi', is_active: true, approved: true, primary_category: primary(f.kind), category_group: 'culture',
      priority_level: p, is_touristic: f.vis === 'sim' || f.vis === 'eventos', is_notable: p === 1, is_historic: true,
      description: f.desc, import_source: 'manual', source_type: 'manual', created_by: admin, processing_status: 'pending',
    }).select('id').single()
    if (error || !att) { console.error(`      ✗ ${error?.message}`); continue }
    const { error: e2 } = await db.rpc('insert_coordinate_safe', { p_attraction_id: att.id, p_latitude: geo.lat, p_longitude: geo.lng, p_show_in_map: true })
    if (e2) { console.error(`      ✗ coord ${e2.message} — removendo`); await db.from('attractions').delete().eq('id', att.id); continue }
    await db.from('attraction_descriptions').insert({ attraction_id: att.id, language: 'pt-br', description: f.desc, play_count: 0 })
    created++
  }
  console.log(`\n=== criados: ${created} | já existiam: ${skipped} | sem coord (manual): ${nocoord} ===`)
  if (noCoordList.length) { console.log('\nSem coordenada (Google não achou — precisa geocode manual):'); noCoordList.forEach(n => console.log(`  · ${n}`)) }
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
