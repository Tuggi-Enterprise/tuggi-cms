/**
 * migrate-buzios-lodging-to-places.ts
 *
 * Migra os comércios de hospedagem de Armação dos Búzios que estão como
 * entity_kind='poi' (category_group='lodging') para entity_kind='place' +
 * core.place_details, mantendo coordenada/osm/nome/categoria. Reversível.
 *
 * place_type derivado do osm_category: hotel→hotel, guest_house→guesthouse,
 * hostel→hostel. Idempotente (pula quem já é place). Trigger Points, se houver,
 * permanecem ligados (o app não os busca para places).
 *
 * Uso:  npx tsx --env-file=.env scripts/migrate-buzios-lodging-to-places.ts [--dry] [--revert]
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')
const REVERT = process.argv.includes('--revert')
const CITY = 'Armação dos Búzios'

function placeType(osmCategory: string | null, name: string): string {
  const c = (osmCategory || '').toLowerCase()
  const n = name.toLowerCase()
  // contexto BR: "Pousada" = guesthouse mesmo se o OSM tagueou tourism=hotel
  if (/\bpousada\b/.test(n)) return 'guesthouse'
  if (c.includes('hostel') || /\bhostel\b/.test(n)) return 'hostel'
  if (c.includes('guest')) return 'guesthouse'
  if (c.includes('motel')) return 'motel'
  return 'hotel'
}

async function getAdminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  if (data?.id) return data.id
  const { data: a } = await db.from('cms_users').select('id').eq('role', 'admin').eq('is_active', true).limit(1).maybeSingle()
  return a?.id ?? null
}

async function migrate() {
  const { data: rows } = await db.from('attractions')
    .select('id,name,osm_category')
    .eq('city', CITY).eq('entity_kind', 'poi').eq('category_group', 'lodging')
  console.log(`Hospedagens como POI: ${rows?.length ?? 0}\n`)
  const adminId = await getAdminId()

  for (const r of rows || []) {
    const pt = placeType(r.osm_category, r.name)
    console.log(`  → ${r.name.padEnd(40)} poi → place [${pt}]`)
    if (DRY) continue
    // 1) place_details (idempotente)
    const { data: existing } = await db.from('place_details').select('attraction_id').eq('attraction_id', r.id).maybeSingle()
    if (!existing) {
      const { error: ep } = await db.from('place_details').insert({ attraction_id: r.id, place_type: pt, cuisine: [], tags: [], created_by: adminId })
      if (ep) { console.error(`      ✗ place_details: ${ep.message}`); continue }
    }
    // 2) flip entity_kind
    const { error: eu } = await db.from('attractions').update({ entity_kind: 'place' }).eq('id', r.id)
    if (eu) { console.error(`      ✗ update: ${eu.message}`); continue }
    console.log(`      ✓`)
  }
}

async function revert() {
  // Volta places de hospedagem (que têm place_details.place_type de lodging) para poi.
  const { data: pds } = await db.from('place_details').select('attraction_id,place_type').in('place_type', ['hotel', 'guesthouse', 'hostel', 'motel'])
  const ids = (pds || []).map(p => p.attraction_id)
  const { data: rows } = await db.from('attractions')
    .select('id,name').eq('city', CITY).eq('entity_kind', 'place').eq('category_group', 'lodging').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  console.log(`Reverter ${rows?.length ?? 0} hospedagens place → poi\n`)
  for (const r of rows || []) {
    console.log(`  → ${r.name} place → poi (+ remove place_details)`)
    if (DRY) continue
    await db.from('attractions').update({ entity_kind: 'poi' }).eq('id', r.id)
    await db.from('place_details').delete().eq('attraction_id', r.id)
    console.log('      ✓')
  }
}

async function main() {
  console.log(`\n=== Búzios lodging → places ${REVERT ? 'REVERT ' : ''}${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  if (REVERT) await revert(); else await migrate()
  const { count: poi } = await db.from('attractions').select('id', { count: 'exact', head: true }).eq('city', CITY).eq('entity_kind', 'poi')
  const { count: pl } = await db.from('attractions').select('id', { count: 'exact', head: true }).eq('city', CITY).eq('entity_kind', 'place')
  console.log(`\nBúzios agora: ${poi} POIs | ${pl} locais`)
  console.log('\n=== fim ===\n')
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
