/**
 * fix-barcelona-pois-ausentes.ts
 *
 * Conserta as lacunas de POI que as rotas de Barcelona expuseram.
 *
 * A lição que gerou este script: buscar por NOME EXATO deu quatro "ausentes" e três eram
 * falso positivo — o POI existia com outro nome, a metros de distância. Sant Pau del Camp
 * estava como "Església de Sant Pau del Camp", o Fossar como "El Fossar de la Pedrera",
 * as Drassanes Reials como "Museu Marítim". A verificação que vale é POR COORDENADA.
 * Só entra em CREATE o que não tem nada equivalente num raio de 120 m.
 *
 * Três operações, todas idempotentes:
 *   CREATE  — 3 POIs sem equivalente nenhum por perto.
 *   RENAME  — "Sant Miguel del Port" está em castelhano; a igreja é Sant Miquel.
 *   PROMOTE — POIs que existem mas estão no nível 2 abaixo do que merecem, com alt_name
 *             para o nome pelo qual o turista realmente procura.
 *
 * Uso:  npx tsx --env-file=.env scripts/fix-barcelona-pois-ausentes.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: 'core' }, auth: { persistSession: false } },
)
const DRY = process.argv.includes('--dry')
const CITY = 'Barcelona', STATE = 'Catalunya', COUNTRY = 'Spain'

interface NewPoi { name: string; lat: number; lng: number; group: string; why: string }

// Verificados um a um: nada equivalente num raio de 120 m. Coordenadas do Nominatim/OSM.
const CREATE: NewPoi[] = [
  {
    name: 'Plaça de Catalunya', lat: 41.387947, lng: 2.170029, group: 'civic',
    why: 'Centro da cidade e ponto de partida das duas linhas do Bus Turístic. Havia 20 POIs num raio de 120 m — as fontes e esculturas da praça — mas a praça não existia.',
  },
  {
    name: 'Parc de la Ciutadella', lat: 41.388416, lng: 2.186254, group: 'parks',
    why: 'Existiam a Cascada e uma dúzia de monumentos dentro do parque, mas não o parque. Foi a cidadela de Felipe V, depois a Exposição Universal de 1888.',
  },
  {
    name: 'Estació de França', lat: 41.385200, lng: 2.184700, group: 'infrastructure',
    why: 'Estação monumental de 1929, marquise de ferro e saguão noucentista. Não havia nada equivalente por perto.',
  },
]

// Nome errado: a igreja da Barceloneta é catalã, "Sant Miquel", não o castelhano "Miguel".
const RENAME: { from: string; to: string; why: string }[] = [
  { from: 'Sant Miguel del Port', to: 'Sant Miquel del Port', why: 'grafia castelhana de igreja catalã' },
]

// Existem, mas subestimados. alt_name = o nome pelo qual o turista procura.
const PROMOTE: { name: string; alt?: string; why: string }[] = [
  { name: 'Església de Sant Pau del Camp', why: 'igreja mais antiga de Barcelona, românica; estava no nível 2' },
  { name: 'Museu Marítim', alt: 'Drassanes Reials de Barcelona', why: 'estaleiros medievais mais bem preservados do mundo' },
  { name: 'Casa Martí', alt: 'Els Quatre Gats', why: 'Puig i Cadafalch; abriga o café onde Picasso fez sua primeira exposição, em 1900' },
]

const RAIO_M = 120

async function nearby(lat: number, lng: number) {
  const { data } = await db.rpc('diag_sql', {
    q: `select a.name, a.priority_level p, round(st_distance(ac.location_geography, st_point(${lng},${lat})::geography)) m
        from core.attraction_coordinate ac join core.attractions a on a.id=ac.attraction_id
        where st_dwithin(ac.location_geography, st_point(${lng},${lat})::geography, ${RAIO_M})
        order by m limit 5`,
  })
  return (data || []) as any[]
}

async function adminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  return data?.id ?? null
}

async function main() {
  console.log(`\n=== POIs de Barcelona ${DRY ? '(DRY RUN)' : '(EXECUTANDO)'} ===\n`)
  const admin = await adminId()

  console.log('— CREATE —')
  for (const p of CREATE) {
    const { data: dup } = await db.from('attractions').select('id')
      .eq('city', CITY).eq('country', COUNTRY).ilike('name', p.name).maybeSingle()
    if (dup) { console.log(`  ↷ SKIP (já existe ${dup.id}) — ${p.name}`); continue }

    const viz = await nearby(p.lat, p.lng)
    console.log(`  + ${p.name}  (${p.lat}, ${p.lng}) [${p.group}]`)
    console.log(`      ${p.why}`)
    console.log(`      vizinhos em ${RAIO_M} m: ${viz.length ? viz.map(v => `${v.name} [p${v.p}/${v.m}m]`).join(' · ') : '(nenhum)'}`)
    if (DRY) continue

    const { data: att, error } = await db.from('attractions').insert({
      name: p.name, city: CITY, state: STATE, country: COUNTRY,
      entity_kind: 'poi', category_group: p.group,
      is_active: true, approved: true,
      priority_level: 1, priority_override: 1, priority_source: 'manual',
      import_source: 'manual', created_by: admin,
    }).select('id').single()
    if (error || !att) { console.error(`      ✗ ${error?.message}`); continue }

    const { error: ec } = await db.rpc('insert_coordinate_safe', {
      p_attraction_id: att.id, p_latitude: p.lat, p_longitude: p.lng, p_show_in_map: true,
    })
    if (ec) console.error(`      ⚠ coord: ${ec.message}`)
    console.log(`      ✓ id=${att.id}`)
  }

  console.log('\n— RENAME —')
  for (const r of RENAME) {
    const { data: hit } = await db.from('attractions').select('id, name')
      .eq('city', CITY).eq('country', COUNTRY).eq('name', r.from).maybeSingle()
    if (!hit) { console.log(`  ↷ SKIP (não achou "${r.from}")`); continue }
    console.log(`  ~ "${r.from}" → "${r.to}"  (${r.why})`)
    if (DRY) continue
    // guarda a grafia antiga em alt_name para a busca continuar achando
    const { error } = await db.from('attractions').update({ name: r.to, alt_name: r.from }).eq('id', hit.id)
    console.log(error ? `      ✗ ${error.message}` : `      ✓ ${hit.id}`)
  }

  console.log('\n— PROMOTE (nível 2 → 1) —')
  for (const p of PROMOTE) {
    const { data: hit } = await db.from('attractions').select('id, name, priority_level, alt_name')
      .eq('city', CITY).eq('country', COUNTRY).eq('name', p.name).maybeSingle()
    if (!hit) { console.log(`  ↷ SKIP (não achou "${p.name}")`); continue }
    if (hit.priority_level === 1 && (!p.alt || hit.alt_name === p.alt)) { console.log(`  ↷ SKIP (já no nível 1) — ${p.name}`); continue }
    console.log(`  ↑ ${p.name}  N${hit.priority_level} → N1${p.alt ? `  · alt_name="${p.alt}"` : ''}`)
    console.log(`      ${p.why}`)
    if (DRY) continue
    const { error } = await db.from('attractions').update({
      priority_level: 1, priority_override: 1, priority_source: 'manual',
      ...(p.alt ? { alt_name: p.alt } : {}),
    }).eq('id', hit.id)
    console.log(error ? `      ✗ ${error.message}` : `      ✓ ${hit.id}`)
  }

  console.log('\n⚠ POIs criados NÃO têm trigger point: precisam passar pelo motor de TP para narrar.')
  console.log('=== fim ===\n')
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
