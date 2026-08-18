/**
 * create-tocantins-corredor-pois.ts
 *
 * POIs ausentes no corredor Natividade → Chapada da Natividade → Santa Rosa →
 * Silvanópolis → Porto Nacional → Palmas (TO), levantados por varredura Overpass
 * sobre o bbox do corredor cruzada contra core.attractions.
 *
 * Duas fontes, porque o OSM cobre natureza e não cobre patrimônio:
 *
 *   OSM     — elemento identificado por tipo+id. Coordenada e tags vêm do Overpass;
 *             quando o elemento é `way` fechado, a geometria vira boundary operacional
 *             (core.attraction_coordinate.boundary_geometry, que é quem o motor de
 *             trigger point consulta). Categoria e prioridade saem do SSOT
 *             lib/shared/poi-taxonomy, a partir das tags reais.
 *   GOOGLE  — conjunto tombado de Porto Nacional e Natividade, que não está mapeado
 *             no OSM. Só ponto, sem boundary; a coordenada é validada exigindo que o
 *             endereço devolvido cite o município, senão o item fica em HOLD em vez de
 *             gravar coordenada errada. Categoria é declarada no item (não há tag).
 *
 * Idempotente: pula quem já existe por nome normalizado na mesma cidade.
 * Descrição e áudio NÃO são gerados aqui — o app produz sob demanda.
 * TPs ficam para a geração posterior.
 *
 * Uso:  npx tsx --env-file=.env scripts/create-tocantins-corredor-pois.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'
import { classify, priorityLevel, SPECIFIC_TO_GROUP } from '../lib/shared/poi-taxonomy'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false }, db: { schema: 'core' } },
)
const GKEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!
const DRY = process.argv.includes('--dry')
const STATE = 'Tocantins', COUNTRY = 'Brazil'

/** bbox do corredor — rejeita qualquer coordenada que caia fora dele. */
const REGION = { s: -12.05, n: -9.75, w: -49.3, e: -47.2 }

/** Item vindo do OSM. `name` sobrescreve o nome do OSM quando ele está errado ou truncado. */
interface OsmItem { ref: string; city: string; name?: string }

const OSM_ITEMS: OsmItem[] = [
  // Cachoeiras — Taquaruçu e serra do Lajeado (Palmas)
  { ref: 'n5213302611', city: 'Palmas' },                                     // Cachoeira da Roncadeira (Roncador)
  { ref: 'n7806846593', city: 'Palmas' },                                     // Cachoeira de Taquaruçu
  { ref: 'n9413886695', city: 'Palmas' },                                     // Cachoeira do Evilson
  { ref: 'n11504238569', city: 'Palmas' },                                    // Cachoeira da Arara
  { ref: 'n7518472085', city: 'Palmas' },                                     // Cachoeira da Três Quedas
  { ref: 'n7518472285', city: 'Lajeado' },                                    // Cachoeira da Testa Branca
  // Praias fluviais do lago
  { ref: 'n14039731252', city: 'Palmas' },                                    // Praia Ilha Cotovelo
  { ref: 'n14039731253', city: 'Porto Nacional' },                            // Praia Ilha das Cobras 1
  { ref: 'n14039731256', city: 'Porto Nacional', name: 'Praia Ilha das Cobras 2' }, // OSM grafa "cobreas"
  // Cultura e comércio popular — Palmas
  { ref: 'w254172102', city: 'Palmas' },                                      // Espaço Cultural José Gomes Sobrinho
  { ref: 'w1020541929', city: 'Palmas' },                                     // Feira da 304 Sul
  { ref: 'n1914357426', city: 'Palmas' },                                     // Feira Coberta 307 Norte
  { ref: 'n6414682529', city: 'Palmas' },                                     // Teatro de Bolso
  { ref: 'n10242108888', city: 'Palmas' },                                    // Teatro Sesc Palmas
  { ref: 'w255466336', city: 'Palmas' },                                      // Centro de Convenções Arnaud Rodrigues
  { ref: 'n13946570402', city: 'Palmas' },                                    // Capelinha de Palmas
  { ref: 'n6426347738', city: 'Palmas' },                                     // Fonte Luminosa
  { ref: 'w435344646', city: 'Palmas', name: 'Monumento Jacaré' },            // OSM só grafa "Jacaré"
  { ref: 'w789082280', city: 'Palmas', name: 'Pórtico de Taquaruçu' },        // OSM grafa "Entrada Taquaruçu"
  // Praças centrais e igreja histórica das cidades do corredor
  { ref: 'w1033531684', city: 'Monte do Carmo' },                             // Praça Nossa Senhora do Carmo
  // OSM grafa "Igrejinha"; o nome oficial, conferido no Google Places, é este.
  { ref: 'n7543912512', city: 'Monte do Carmo', name: 'Igreja de Nossa Senhora do Carmo' },
  { ref: 'w1033478516', city: 'Silvanópolis' },                               // Praça Nossa Senhora Santana
  // Praça São Benedito (w1208914004) fica de fora: o polígono dela está a 8 m da
  // Igreja de São Benedito, que entra pelo Google abaixo. Dois registros nesse raio
  // viram duplicata na régua de dedup — vale o atrativo, não o entorno dele.
]

/**
 * Patrimônio ausente do OSM. `cat` é a folha do SSOT de taxonomia — declarada aqui
 * porque não há tag de onde derivar. `query` só quando o nome sozinho não localiza.
 */
interface GoogleItem { name: string; city: string; cat: string; query?: string; historic?: boolean }

const GOOGLE_ITEMS: GoogleItem[] = [
  { name: 'Palácio Araguaia', city: 'Palmas', cat: 'attraction' },
  // Nome oficial da ponte Palmas–Luzimangues; "Ponte Fernando Henrique Cardoso" é
  // como ela é chamada na região, e é por esse nome que o Places a localiza.
  { name: 'Ponte Governador José Wilson Siqueira Campos', city: 'Palmas', cat: 'bridge', query: 'Ponte Fernando Henrique Cardoso Palmas Luzimangues' },
  { name: 'Catedral Nossa Senhora das Mercês', city: 'Porto Nacional', cat: 'cathedral', historic: true },
  { name: 'Centro Histórico de Porto Nacional', city: 'Porto Nacional', cat: 'historic_site', historic: true, query: 'Centro Histórico de Porto Nacional TO' },
  { name: 'Museu Histórico de Porto Nacional', city: 'Porto Nacional', cat: 'museum', historic: true, query: 'Museu Histórico e Cultural de Porto Nacional TO' },
  { name: 'Seminário São José', city: 'Porto Nacional', cat: 'historic_site', historic: true },
  { name: 'Praia da Ilha Porto Real', city: 'Porto Nacional', cat: 'beach', query: 'Praia do Porto Real Porto Nacional TO' },
  { name: 'Museu de Natividade', city: 'Natividade', cat: 'museum', historic: true },
  { name: 'Casa do Patrimônio de Natividade', city: 'Natividade', cat: 'museum', historic: true, query: 'Casa do Patrimônio de Natividade IPHAN TO' },
  { name: 'Igreja de São Benedito', city: 'Natividade', cat: 'church', historic: true },
  { name: 'Cachoeira Poções', city: 'Natividade', cat: 'waterfall', query: 'Cachoeira Poções Natividade TO' },
]

/*
 * Fora da lista, e por quê:
 *   Centro Cultural Dom Alano Maria Du Noday — o Places devolve o CEACDAN, um centro
 *     de ação comunitária em outro bairro. Instituição diferente; nome mentiria.
 *   Centro Histórico de Natividade — o Places resolve para o mesmo ponto do Museu de
 *     Natividade (25 m). Seria duplicata.
 *   Igreja Matriz de Chapada da Natividade — o Places devolve dois pontos distintos a
 *     2 km ("Paróquia Santa Ana" e "Igreja Nossa Senhora de Santana"). Sem fonte que
 *     desempate, não entra.
 *   Praça Nossa Senhora das Mercês (Porto Nacional) — Places classifica como `route`;
 *     o Centro Histórico já cobre o ponto.
 */

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const inRegion = (lat: number, lng: number) => lat >= REGION.s && lat <= REGION.n && lng >= REGION.w && lng <= REGION.e

/**
 * Overpass público devolve "Dispatcher_Client::request_read_and_idx::timeout" sob carga
 * — por isso a lista de espelhos. A resposta de erro vem em HTML, não JSON.
 */
const OVERPASS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
]

async function overpass(query: string): Promise<any[]> {
  for (const url of OVERPASS) {
    try {
      // corpo tem que ir como `data=` urlencoded: com o texto cru o Overpass devolve 406.
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'User-Agent': 'TuggiCMS/1.0 (suporte@tuggi.app)' },
        body: `data=${encodeURIComponent(query)}`,
      })
      const txt = await r.text()
      if (!txt.trimStart().startsWith('{')) { console.warn(`  ⚠ overpass ${url} devolveu não-JSON`); continue }
      return JSON.parse(txt).elements || []
    } catch (e: any) { console.warn(`  ⚠ overpass ${url}: ${e.message}`) }
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error('todos os espelhos do Overpass falharam')
}

/** Centroide do anel por média aritmética dos vértices — o mesmo critério do enrich-poi-from-osm. */
function centroid(g: { lat: number; lon: number }[]) {
  return { lat: g.reduce((s, p) => s + p.lat, 0) / g.length, lng: g.reduce((s, p) => s + p.lon, 0) / g.length }
}
function isClosed(g: { lat: number; lon: number }[]) {
  return g.length > 3 && Math.abs(g[0].lat - g[g.length - 1].lat) < 1e-9 && Math.abs(g[0].lon - g[g.length - 1].lon) < 1e-9
}

async function adminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  return data?.id ?? null
}

/**
 * Google Places text search. Exige que o endereço devolvido cite o município e que o
 * ponto caia no bbox do corredor — homônimo de outro estado é rejeitado, não gravado.
 */
async function geocode(it: GoogleItem): Promise<{ lat: number; lng: number } | null> {
  const q = it.query || `${it.name} ${it.city} Tocantins`
  const u = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&region=br&language=pt-BR&key=${GKEY}`
  const d: any = await (await fetch(u)).json()
  const cityN = norm(it.city)
  const hit = (d.results || []).find((r: any) => {
    const l = r.geometry?.location
    return l && inRegion(l.lat, l.lng) && norm(r.formatted_address || '').includes(cityN)
  })
  if (!hit) return null
  return { lat: +hit.geometry.location.lat.toFixed(6), lng: +hit.geometry.location.lng.toFixed(6) }
}

interface Ready {
  name: string; city: string; lat: number; lng: number
  primary_category: string | null; category_group: string | null; priority: 1 | 2 | 3
  is_historic: boolean; source: 'osm' | 'google'
  osm_type?: string; osm_id?: string; osm_tags?: Record<string, any>
  boundary?: { geojson: string; centroid: { lat: number; lng: number } }
}

async function fromOsm(): Promise<Ready[]> {
  const nodes = OSM_ITEMS.filter(i => i.ref[0] === 'n').map(i => i.ref.slice(1))
  const ways = OSM_ITEMS.filter(i => i.ref[0] === 'w').map(i => i.ref.slice(1))
  const q = `[out:json][timeout:180];(node(id:${nodes.join(',')});way(id:${ways.join(',')}););out geom tags;`
  const els = await overpass(q)
  const byRef = new Map(els.map((e: any) => [`${e.type[0]}${e.id}`, e]))

  const out: Ready[] = []
  for (const it of OSM_ITEMS) {
    const e = byRef.get(it.ref)
    if (!e) { console.warn(`  ⚠ ${it.ref} não voltou do Overpass`); continue }
    const tags = e.tags || {}
    const name = it.name || tags.name
    if (!name) { console.warn(`  ⚠ ${it.ref} sem nome`); continue }

    let lat: number, lng: number, boundary: Ready['boundary']
    if (e.type === 'node') { lat = e.lat; lng = e.lon }
    else {
      const g: { lat: number; lon: number }[] = e.geometry || []
      if (!g.length) { console.warn(`  ⚠ ${it.ref} sem geometria`); continue }
      const c = centroid(g)
      lat = c.lat; lng = c.lng
      if (isClosed(g)) {
        boundary = {
          geojson: JSON.stringify({ type: 'Polygon', coordinates: [g.map(p => [p.lon, p.lat])] }),
          centroid: c,
        }
      } else console.warn(`  ⚠ ${it.ref} é linha aberta — entra sem boundary`)
    }
    if (!inRegion(lat, lng)) { console.warn(`  ⚠ ${it.ref} (${name}) fora do bbox do corredor — pulado`); continue }

    // categoria e prioridade saem do SSOT, a partir das tags reais do OSM
    const cls = classify({ osm_tags: tags, name, ...tags })
    const priority = priorityLevel(cls.primary_category, { osm_tags: tags, name, ...tags })
    out.push({
      name, city: it.city, lat: +lat.toFixed(7), lng: +lng.toFixed(7),
      primary_category: cls.primary_category, category_group: cls.category_group, priority,
      is_historic: !!tags.historic, source: 'osm',
      osm_type: e.type, osm_id: String(e.id), osm_tags: tags, boundary,
    })
  }
  return out
}

async function fromGoogle(): Promise<{ ready: Ready[]; hold: string[] }> {
  const ready: Ready[] = [], hold: string[] = []
  for (const it of GOOGLE_ITEMS) {
    const geo = await geocode(it)
    await new Promise(r => setTimeout(r, 350))
    if (!geo) { hold.push(`${it.name} (${it.city})`); continue }
    ready.push({
      name: it.name, city: it.city, lat: geo.lat, lng: geo.lng,
      primary_category: it.cat, category_group: SPECIFIC_TO_GROUP[it.cat] ?? null,
      priority: priorityLevel(it.cat, { name: it.name, is_historic: it.historic }),
      is_historic: !!it.historic, source: 'google',
    })
  }
  return { ready, hold }
}

async function main() {
  console.log(`\n=== Corredor Natividade → Palmas (TO) ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  const admin = await adminId()

  console.log('· OSM (Overpass)')
  const osm = await fromOsm()
  console.log(`· Google Places (${GOOGLE_ITEMS.length} itens de patrimônio)`)
  const { ready: google, hold } = await fromGoogle()
  const items = [...osm, ...google]

  // cache do que já existe, por cidade
  const cities = [...new Set(items.map(i => i.city))]
  const existing = new Map<string, Set<string>>()
  for (const c of cities) {
    const { data } = await db.from('attractions').select('name').eq('city', c).eq('state', STATE)
    existing.set(c, new Set((data || []).map(r => norm(r.name))))
  }

  let created = 0, skipped = 0
  const createdIds: string[] = []
  console.log('')
  for (const i of items) {
    if (existing.get(i.city)?.has(norm(i.name))) { console.log(`  ↷ existe — ${i.name} (${i.city})`); skipped++; continue }
    const b = i.boundary ? 'boundary' : 'ponto'
    console.log(`  + ${i.name.padEnd(40)} ${i.city.padEnd(16)} [${i.primary_category ?? '?'}/pl${i.priority}] ${b} (${i.lat},${i.lng})`)
    if (DRY) { created++; continue }

    const { data: att, error } = await db.from('attractions').insert({
      name: i.name, city: i.city, state: STATE, country: COUNTRY,
      entity_kind: 'poi', is_active: true, approved: true,
      primary_category: i.primary_category, category_group: i.category_group,
      priority_level: i.priority, priority_source: 'algorithm',
      is_touristic: true, is_notable: i.priority === 1, is_historic: i.is_historic,
      import_source: i.source === 'osm' ? 'osm' : 'google_places',
      source_type: 'manual', source: i.source,
      osm_type: i.osm_type ?? null, osm_id: i.osm_id ?? null, osm_tags: i.osm_tags ?? null,
      created_by: admin, processing_status: 'pending',
    }).select('id').single()
    if (error || !att) { console.error(`      ✗ ${error?.message}`); continue }

    const { error: e2 } = await db.rpc('insert_coordinate_safe', {
      p_attraction_id: att.id, p_latitude: i.lat, p_longitude: i.lng, p_show_in_map: true,
      // boundary_area_m2 fica nulo de propósito: quem sabe medir área em geography é o
      // PostGIS, e o backfill roda em SQL logo depois (ver README no fim da execução).
      p_boundary_geometry_geojson: i.boundary?.geojson ?? null,
      p_boundary_type: i.boundary ? 'polygon' : null,
      p_boundary_source: i.boundary ? 'osm' : null,
      p_boundary_confidence: i.boundary ? 1.0 : null,
      p_boundary_area_m2: null,
      p_boundary_centroid_lat: i.boundary?.centroid.lat ?? null,
      p_boundary_centroid_lng: i.boundary?.centroid.lng ?? null,
    })
    if (e2) { console.error(`      ✗ coord ${e2.message} — removendo POI`); await db.from('attractions').delete().eq('id', att.id); continue }
    createdIds.push(att.id)
    created++
  }

  console.log(`\n=== criados: ${created} | já existiam: ${skipped} | em HOLD: ${hold.length} ===`)
  if (hold.length) {
    console.log('\nHOLD — Google não devolveu resultado dentro do município (precisa coordenada manual):')
    hold.forEach(h => console.log(`  · ${h}`))
  }
  if (createdIds.length) {
    console.log('\nFalta rodar, no painel SQL:')
    console.log("  update core.attraction_coordinate set boundary_area_m2 = st_area(boundary_geometry)")
    console.log("   where boundary_geometry is not null and boundary_area_m2 is null;")
    console.log('\nE depois gerar trigger points para os IDs criados.')
  }
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
