/**
 * create-madrid-pois.ts
 *
 * Creates the Madrid POIs that the route work exposed as missing.
 *
 * Every entry was checked BY COORDINATE, not by name -- the Barcelona pass taught that an
 * exact-name search reports "missing" for POIs that sit right there under another label. Each
 * one below has nothing equivalent within 100 m, and the neighbours found are listed so the
 * judgement can be re-checked.
 *
 * Usage:  npx tsx --env-file=.env scripts/create-madrid-pois.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: 'core' }, auth: { persistSession: false } },
)
const DRY = process.argv.includes('--dry')
const CITY = 'Madrid', STATE = 'Madrid', COUNTRY = 'Spain'

interface NewPoi { name: string; lat: number; lng: number; group: string; why: string }

const CREATE: NewPoi[] = [
  {
    name: 'Catedral de la Almudena', lat: 40.41571, lng: -3.71459, group: 'religious',
    why: 'Cathedral of Madrid, facing the Palacio Real. Only its museum existed (level 2), plus the statues around it.',
  },
  {
    name: 'Museo Nacional Thyssen-Bornemisza', lat: 40.41600, lng: -3.69460, group: 'culture',
    why: 'Third museum of the Paseo del Arte triangle, with Prado and Reina Sofia. Only the gardens and a bust of Thyssen were in the base.',
  },
  {
    name: 'Plaza de la Villa', lat: 40.41522, lng: -3.71040, group: 'civic',
    why: 'Medieval square of the old town hall. Every building around it exists -- Casa de la Villa, Torre de los Lujanes, Casa de Cisneros -- but not the square.',
  },
  {
    name: 'Pradera de San Isidro', lat: 40.39773, lng: -3.72792, group: 'parks',
    why: 'Where the San Isidro festivities happen, and the subject of the Goya painting. Nothing at all within 100 m.',
  },
]

async function adminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  return data?.id ?? null
}

async function main() {
  console.log(`\n=== Madrid POIs ${DRY ? '(DRY RUN)' : '(EXECUTING)'} ===\n`)
  const admin = await adminId()

  for (const p of CREATE) {
    const { data: dup } = await db.from('attractions').select('id')
      .eq('country', COUNTRY).ilike('name', p.name).maybeSingle()
    if (dup) { console.log(`  skip (already exists ${dup.id}) -- ${p.name}`); continue }

    console.log(`  + ${p.name}  (${p.lat}, ${p.lng}) [${p.group}]`)
    console.log(`      ${p.why}`)
    if (DRY) continue

    const { data: att, error } = await db.from('attractions').insert({
      name: p.name, city: CITY, state: STATE, country: COUNTRY,
      entity_kind: 'poi', category_group: p.group,
      is_active: true, approved: true,
      priority_level: 1, priority_override: 1, priority_source: 'manual',
      import_source: 'manual', created_by: admin,
    }).select('id').single()
    if (error || !att) { console.error(`      FAIL ${error?.message}`); continue }

    const { error: ec } = await db.rpc('insert_coordinate_safe', {
      p_attraction_id: att.id, p_latitude: p.lat, p_longitude: p.lng, p_show_in_map: true,
    })
    if (ec) console.error(`      WARN coordinate: ${ec.message}`)
    console.log(`      ok id=${att.id}`)
  }

  console.log('\nNote: new POIs have no trigger point yet, and insert_coordinate_safe leaves a')
  console.log('synthetic octagon boundary tagged source=manual. Run enrich-poi-from-osm.ts to')
  console.log('replace it with the real OSM footprint.')
  console.log('=== done ===\n')
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
