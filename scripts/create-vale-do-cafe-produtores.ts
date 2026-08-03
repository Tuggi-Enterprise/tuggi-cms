/**
 * create-vale-do-cafe-produtores.ts
 *
 * Produtores visitáveis da Rota da Cachaça e da Rota do Queijo do Vale do Café (RJ),
 * levantados por pesquisa multi-fonte (Rota do Queijo/Cachaça, Instituto Preservale,
 * Mapa da Cachaça, sites dos produtores) e verificados. Cachaçarias/queijarias como
 * `place` (place_type='producer', tag da rota); Museu da Cachaça como POI museu.
 * Geocode via Google Places (rejeita hit fora do município) + overrides conhecidos.
 * Descrição = síntese factual da fonte (sem telefones). Idempotente. TPs → manuais.
 *
 * Uso:  npx tsx --env-file=.env scripts/create-vale-do-cafe-produtores.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false }, db: { schema: 'core' } })
const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!
const DRY = process.argv.includes('--dry')
const STATE = 'Rio de Janeiro', COUNTRY = 'Brazil'
const REGION = { s: -23.05, n: -21.85, w: -44.75, e: -43.10 }

interface P { name: string; city: string; neighborhood?: string; type: 'cachaca' | 'queijo'; kind: 'place' | 'museu'; place_type: string; desc: string; hold?: boolean }

const PRODUCERS: P[] = [
  // ——— Cachaça ———
  { name: 'Cachaçaria Werneck', city: 'Rio das Flores', neighborhood: 'zona rural', type: 'cachaca', kind: 'place', place_type: 'producer',
    desc: 'Alambique premiado de Rio das Flores que produz cachaça artesanal de cana orgânica, da tradicional em inox à envelhecida em carvalho francês — já laureada com ouro no concurso de Bruxelas. Visitas aos sábados, com agendamento.' },
  { name: 'Alambique Vieira & Castro', city: 'Rio das Flores', neighborhood: 'RJ-135', type: 'cachaca', kind: 'place', place_type: 'producer',
    desc: 'Alambique na estrada da Fazenda União (RJ-135), em Rio das Flores, que produz cachaça de cana própria cultivada sem adubo químico, com destilação lenta. Oferece visita gratuita com degustação.' },
  { name: 'Cachaça Pindorama - Fazenda das Palmas', city: 'Engenheiro Paulo de Frontin', neighborhood: 'Barão do Amparo', type: 'cachaca', kind: 'place', place_type: 'producer',
    desc: 'Cachaça branca orgânica produzida na histórica Fazenda das Palmas, em Barão do Amparo, com alambique de 1855 restaurado e premiado. A cana é cortada e moída no mesmo dia. Visita com agendamento.' },
  { name: 'Cachaça Magnífica - Alambique Alegria', city: 'Vassouras', neighborhood: 'Divisa', type: 'cachaca', kind: 'place', place_type: 'producer',
    desc: 'Alambique artesanal na Fazenda do Anil, no distrito da Divisa, em Vassouras (na fronteira com Miguel Pereira), com alambique de cobre de três estágios e cana própria. Produção aberta a visitas de turistas.' },
  { name: 'Museu da Cachaça de Paty do Alferes', city: 'Paty do Alferes', neighborhood: 'Mantiquira', type: 'cachaca', kind: 'museu', place_type: 'museum',
    desc: 'Primeiro museu da cachaça do país, inaugurado em 1991, no distrito de Mantiquira, em Paty do Alferes. Reúne alambique artesanal, duas caves e bar de degustação. Aberto de terça a domingo.' },
  { name: 'Hotel Fazenda Vilarejo', city: 'Conservatória', neighborhood: 'Conservatória', type: 'cachaca', kind: 'place', place_type: 'producer',
    desc: 'Hotel-fazenda em Conservatória com produção própria de cachaça tipo exportação, além de licores, rapadura e melado.' },
  // ——— Queijo ———
  { name: 'Empório Rural de Valença', city: 'Valença', neighborhood: 'Centro', type: 'queijo', kind: 'place', place_type: 'shop',
    desc: 'Loja-cooperativa no centro de Valença que reúne queijos e laticínios de cerca de 60 produtores do Vale do Café. É a porta de entrada da Rota do Queijo.' },
  { name: "Du'Vale Queijaria", city: 'Valença', neighborhood: 'Pedro Carlos', type: 'queijo', kind: 'place', place_type: 'producer',
    desc: 'Queijaria que produz queijos de leite cru curados em cave escavada na rocha — como o Pérola, o Ouro e o Serenata —, premiada internacionalmente, no distrito de Pedro Carlos, em Valença. Visita com agendamento.' },
  { name: 'Sítio Vale do Vento', city: 'Valença', neighborhood: 'zona rural', type: 'queijo', kind: 'place', place_type: 'producer',
    desc: 'Sítio produtor de queijos artesanais de leite de vaca, integrante da Rota do Queijo de Valença. Visita com agendamento.' },
  { name: 'Ateliê du Leite', city: 'Valença', neighborhood: 'Fazenda Vista Alegre', type: 'queijo', kind: 'place', place_type: 'producer',
    desc: 'Produtor do Queijo Prato Valenciano, com tradição de família dinamarquesa desde os anos 1920, na Fazenda Vista Alegre, em Valença. Oferece visitação rural e gastronômica.' },
  { name: 'Capril do Lago', city: 'Valença', neighborhood: 'RJ-145', type: 'queijo', kind: 'place', place_type: 'producer',
    desc: 'Produtor de queijos de leite de cabra com maturação de no mínimo um ano, às margens da RJ-145, em Valença. Na visita é possível ordenhar as cabras.' },
  { name: 'Rancho Latte Buono', city: 'Valença', neighborhood: 'Sítio Boa Esperança', type: 'queijo', kind: 'place', place_type: 'producer',
    desc: 'Produtor de laticínios de leite de búfala — queijos, iogurte, manteiga, doce de leite e sorvete — em Valença. O visitante pode fazer o próprio queijo de búfala.' },
  // hold: Google geocodou no ponto do Latte Buono (coord errada) → coord manual pendente
  { name: 'Ecoleite', city: 'Valença', neighborhood: 'zona rural', type: 'queijo', kind: 'place', place_type: 'producer', hold: true,
    desc: 'Produtor de queijos premiados e laticínios agroecológicos, em Valença. Visitas com agendamento prévio.' },
]

// coords conhecidas (produtor coincide com POI já cadastrado / listagem já vista)
const COORD_OVERRIDE: Record<string, { lat: number; lng: number }> = {
  'Hotel Fazenda Vilarejo|Conservatória': { lat: -22.288499, lng: -43.915075 },                       // = Cachaçaria Vilarejo (Estr. Rosinha de Valença)
  'Cachaça Pindorama - Fazenda das Palmas|Engenheiro Paulo de Frontin': { lat: -22.478365, lng: -43.651610 }, // = Fazenda das Palmas
  'Ateliê du Leite|Valença': { lat: -22.296747, lng: -43.779711 },                                    // = Fazenda Vista Alegre
  'Cachaça Magnífica - Alambique Alegria|Vassouras': { lat: -22.421725, lng: -43.519789 },            // Fazenda do Anil, Estrada do Anil 4000, Divisa
  'Rancho Latte Buono|Valença': { lat: -22.310645, lng: -43.721271 },                                 // Rua Sítio Boa Esperança 1000
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').trim()

async function adminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  return data?.id ?? null
}

async function geocode(p: P): Promise<{ lat: number; lng: number } | null> {
  const ov = COORD_OVERRIDE[`${p.name}|${p.city}`]
  if (ov) return ov
  const u = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(`${p.name} ${p.city} RJ`)}&region=br&language=pt-BR&key=${KEY}`
  const d: any = await (await fetch(u)).json()
  const cityN = norm(p.city)
  const hit = (d.results || []).find((r: any) => { const l = r.geometry.location; return l.lat >= REGION.s && l.lat <= REGION.n && l.lng >= REGION.w && l.lng <= REGION.e && norm(r.formatted_address || '').includes(cityN) })
  if (!hit) return null
  const l = hit.geometry.location
  return { lat: +l.lat.toFixed(6), lng: +l.lng.toFixed(6) }
}

async function main() {
  console.log(`\n=== Vale do Café — produtores (cachaça & queijo) ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  const admin = await adminId()
  const cities = [...new Set(PRODUCERS.map(p => p.city))]
  const existing = new Map<string, any[]>()
  for (const c of cities) { const { data } = await db.from('attractions').select('id,name').eq('city', c); existing.set(c, data || []) }

  let ok = 0, dup = 0, nogeo = 0
  const noGeoList: string[] = []
  for (const p of PRODUCERS) {
    if (p.hold) { console.log(`  ⏸ HOLD (coord manual) — ${p.name}`); noGeoList.push(`${p.name} (${p.city}) [hold]`); nogeo++; continue }
    if ((existing.get(p.city) || []).find(e => norm(e.name) === norm(p.name))) { console.log(`  ↷ existe — ${p.name}`); dup++; continue }
    const geo = await geocode(p)
    if (!COORD_OVERRIDE[`${p.name}|${p.city}`]) await new Promise(r => setTimeout(r, 350))
    if (!geo) { console.log(`  ⚠ SEM COORD — ${p.name} (${p.city})`); noGeoList.push(`${p.name} (${p.city})`); nogeo++; continue }
    const isPoi = p.kind === 'museu'
    console.log(`  + ${p.name.padEnd(38)} ${p.city.padEnd(24)} [${p.type}/${isPoi ? 'poi-museu' : p.place_type}] (${geo.lat},${geo.lng})`)
    if (DRY) { ok++; continue }
    const { data: att, error } = await db.from('attractions').insert({
      name: p.name, city: p.city, state: STATE, country: COUNTRY, neighborhood: p.neighborhood || null,
      entity_kind: isPoi ? 'poi' : 'place', is_active: true, approved: true,
      category_group: isPoi ? 'culture' : 'place', primary_category: isPoi ? 'museum' : p.place_type,
      priority_level: 2, is_touristic: true, is_historic: isPoi ? true : false,
      description: p.desc, import_source: 'manual', source_type: 'manual', created_by: admin, processing_status: 'pending',
    }).select('id').single()
    if (error || !att) { console.error(`      ✗ ${error?.message}`); continue }
    const { error: e2 } = await db.rpc('insert_coordinate_safe', { p_attraction_id: att.id, p_latitude: geo.lat, p_longitude: geo.lng, p_show_in_map: true })
    if (e2) { console.error(`      ✗ coord ${e2.message} — removendo`); await db.from('attractions').delete().eq('id', att.id); continue }
    if (!isPoi) await db.from('place_details').insert({ attraction_id: att.id, place_type: p.place_type, cuisine: [], tags: [`rota-${p.type}`], created_by: admin })
    await db.from('attraction_descriptions').insert({ attraction_id: att.id, language: 'pt-br', description: p.desc, play_count: 0 })
    ok++
  }
  console.log(`\n=== criados: ${ok} | já existiam: ${dup} | sem coord (manual): ${nogeo} ===`)
  if (noGeoList.length) { console.log('\nSem coordenada:'); noGeoList.forEach(n => console.log(`  · ${n}`)) }
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
