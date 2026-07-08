/**
 * migrate-br-lodging-to-places.ts
 *
 * Varre o Brasil e migra hospedagens que estão como entity_kind='poi'
 * (category_group='lodging') para entity_kind='place' + core.place_details.
 * Mantém coordenada/osm/nome. Idempotente. Tem --revert.
 *
 * EXCLUI 7 registros mal-classificados como lodging (rio/praia/fórum/alojamento/
 * mirantes/reserva) e os RECATEGORIZA pro grupo certo (continuam entity_kind=poi).
 * Matching por substring normalizado (sem acento) + operação por ID (robusto).
 *
 * Uso:  npx tsx --env-file=.env scripts/migrate-br-lodging-to-places.ts [--dry] [--revert]
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')
const REVERT = process.argv.includes('--revert')

const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// 7 mal-classificadas: substring normalizado → grupo/categoria corretos (NÃO migrar).
const RECAT: { pat: string; group: string; primary: string; label: string }[] = [
  { pat: 'tamanduatei', group: 'water', primary: 'river', label: 'Rio Tamanduateí' },
  { pat: 'praia central de rio das ostras', group: 'water', primary: 'beach', label: 'Praia Central de Rio das Ostras' },
  { pat: 'tribunal de justica', group: 'culture', primary: 'historic_site', label: 'Edifício do Tribunal de Justiça de SP' },
  { pat: 'alojamento da universidade federal do para', group: 'civic', primary: 'university', label: 'Alojamento da UFPA' },
  { pat: 'mirante do arvrao', group: 'nature', primary: 'viewpoint', label: 'Mirante do Arvrão' },
  { pat: 'aquarela do leme', group: 'nature', primary: 'viewpoint', label: 'Aquarela do Leme' },
  { pat: 'agua boa do univini', group: 'water', primary: 'river', label: 'Água Boa do Univini' },
]
const recatFor = (name: string) => RECAT.find(r => norm(name).includes(r.pat))

function placeType(osmCategory: string | null, name: string): string {
  const c = (osmCategory || '').toLowerCase(), n = norm(name)
  if (/\bpousada\b/.test(n)) return 'guesthouse'
  if (c.includes('hostel') || /\bhostel\b/.test(n)) return 'hostel'
  if (c.includes('guest') || c.includes('hut') || c.includes('chalet') || /\b(chale|chalet|cabana)\b/.test(n)) return 'guesthouse'
  if (c.includes('motel') || /\bmotel\b/.test(n)) return 'motel'
  return 'hotel'
}

async function getAdminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  if (data?.id) return data.id
  const { data: a } = await db.from('cms_users').select('id').eq('role', 'admin').eq('is_active', true).limit(1).maybeSingle()
  return a?.id ?? null
}

async function fetchLodgingPois() {
  const { data } = await db.from('attractions')
    .select('id,name,city,state,osm_category')
    .eq('country', 'Brazil').eq('entity_kind', 'poi').eq('category_group', 'lodging').limit(2000)
  return data || []
}

async function run() {
  const all = await fetchLodgingPois()
  const toMigrate = all.filter(r => !recatFor(r.name))
  const toRecat = all.filter(r => recatFor(r.name))
  console.log(`Hospedagens POI no Brasil: ${all.length}  →  migrar ${toMigrate.length} | excluir+recategorizar ${toRecat.length}\n`)

  // 1) MIGRAR hospedagens reais → place
  const adminId = await getAdminId()
  const byType: Record<string, number> = {}
  let done = 0
  for (const r of toMigrate) {
    const pt = placeType(r.osm_category, r.name)
    byType[pt] = (byType[pt] || 0) + 1
    if (DRY) continue
    const { data: ex } = await db.from('place_details').select('attraction_id').eq('attraction_id', r.id).maybeSingle()
    if (!ex) {
      const { error: ep } = await db.from('place_details').insert({ attraction_id: r.id, place_type: pt, cuisine: [], tags: [], created_by: adminId })
      if (ep) { console.error(`  ✗ ${r.name}: place_details ${ep.message}`); continue }
    }
    const { error: eu } = await db.from('attractions').update({ entity_kind: 'place' }).eq('id', r.id)
    if (eu) { console.error(`  ✗ ${r.name}: update ${eu.message}`); continue }
    if (++done % 25 === 0) console.log(`  ... migradas ${done}/${toMigrate.length}`)
  }
  console.log(`${DRY ? '[DRY] ' : ''}migradas: ${DRY ? toMigrate.length : done} | place_type: ${JSON.stringify(byType)}`)

  // 2) RECATEGORIZAR as 7 mal-classificadas (continuam poi)
  console.log('\n— Recategorizando (continuam entity_kind=poi) —')
  for (const r of toRecat) {
    const cat = recatFor(r.name)!
    console.log(`  → "${r.name}" (${r.city}/${r.state})  lodging → ${cat.group}/${cat.primary}`)
    if (DRY) continue
    const { error } = await db.from('attractions').update({ category_group: cat.group, primary_category: cat.primary }).eq('id', r.id)
    if (error) console.error(`      ✗ ${error.message}`); else console.log('      ✓')
  }
  const missing = RECAT.filter(rc => !toRecat.some(r => recatFor(r.name)?.pat === rc.pat))
  if (missing.length) console.log(`  (não achadas como lodging, ok se já corrigidas: ${missing.map(m => m.label).join(', ')})`)
}

async function revert() {
  const { data: pds } = await db.from('place_details').select('attraction_id').in('place_type', ['hotel', 'guesthouse', 'hostel', 'motel'])
  const ids = (pds || []).map(p => p.attraction_id)
  if (!ids.length) { console.log('nada a reverter'); return }
  const { data: rows } = await db.from('attractions').select('id,name')
    .eq('country', 'Brazil').eq('entity_kind', 'place').eq('category_group', 'lodging').in('id', ids)
  console.log(`Reverter ${rows?.length ?? 0} hospedagens place → poi`)
  for (const r of rows || []) {
    if (DRY) continue
    await db.from('attractions').update({ entity_kind: 'poi' }).eq('id', r.id)
    await db.from('place_details').delete().eq('attraction_id', r.id)
  }
}

async function main() {
  console.log(`\n=== Brasil lodging → places ${REVERT ? 'REVERT ' : ''}${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  if (REVERT) await revert(); else await run()
  const { count: poi } = await db.from('attractions').select('id', { count: 'exact', head: true }).eq('country', 'Brazil').eq('entity_kind', 'poi').eq('category_group', 'lodging')
  const { count: pl } = await db.from('attractions').select('id', { count: 'exact', head: true }).eq('country', 'Brazil').eq('entity_kind', 'place')
  console.log(`\nBrasil agora: lodging ainda como POI = ${poi} | total places = ${pl}`)
  console.log('\n=== fim ===\n')
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
