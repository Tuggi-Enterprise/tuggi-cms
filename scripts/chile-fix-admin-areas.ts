/**
 * chile-fix-admin-areas.ts (#1203). state = región (OSM admin_level=4), city = comuna (OSM
 * admin_level=8), point in polygon, for every cadastro with country Chile.
 *
 * Touches state and city only: never the coordinate, the name, the country or anything else.
 * A point outside every polygon is not changed; it is listed. Running it twice changes nothing
 * the second time: a row already equal to the plan is skipped.
 *
 * Replaces scripts/reconcile-chile-atacama.ts, which stamped "Antofagasta" on a coordinate box.
 *
 * Usage (from tuggi-cms/):
 *   npx tsx --env-file=.env scripts/chile-fix-admin-areas.ts            # dry run (default)
 *   npx tsx --env-file=.env scripts/chile-fix-admin-areas.ts --apply    # writes
 */
import { createCoreDb } from '../lib/osm-chile/catalogue'
import { loadChileAdminAreas, writeCsv } from '../lib/osm-chile/osm-sources'
import { planAdminFixes } from '../lib/osm-chile/plans'

const APPLY = process.argv.includes('--apply') && !process.argv.includes('--dry-run')
const CONCURRENCY = 8

async function main() {
  const db = createCoreDb()
  const areas = await loadChileAdminAreas()
  const items = await planAdminFixes(db, areas)
  const changes = items.flatMap(i => 'plan' in i && i.plan.status === 'change' ? [{ row: i.row, changes: i.plan.changes }] : [])
  const outside = items.filter(i => i.status === 'outside' || i.status === 'no_coordinate')

  console.log(`\n${APPLY ? '[APPLY]' : '[DRY RUN]'} ${items.length} cadastros with country Chile`)
  console.log(`  to change: ${changes.length} (state ${changes.filter(c => c.changes.state).length}, city ${changes.filter(c => c.changes.city).length})`)
  console.log(`  already right: ${items.filter(i => i.status === 'unchanged').length}`)
  console.log(`  not changed, outside every polygon or without coordinate: ${outside.length}`)
  for (const c of changes.slice(0, 40)) {
    console.log(`  ${c.row.id}  ${c.row.name}: state "${c.row.state ?? ''}" -> "${c.changes.state ?? c.row.state ?? ''}" | city "${c.row.city ?? ''}" -> "${c.changes.city ?? c.row.city ?? ''}"`)
  }
  if (changes.length > 40) console.log(`  ... ${changes.length - 40} more in the csv`)
  const plan = writeCsv('fix-admin-plan.csv', ['id', 'name', 'state', 'city', 'new_state', 'new_city'],
    changes.map(c => [c.row.id, c.row.name, c.row.state, c.row.city, c.changes.state ?? c.row.state, c.changes.city ?? c.row.city]))
  const out = writeCsv('fix-admin-outside.csv', ['id', 'name', 'country', 'state', 'city', 'lat', 'lng', 'status'],
    outside.map(i => [i.row.id, i.row.name, i.row.country, i.row.state, i.row.city, i.row.latitude, i.row.longitude, i.status]))
  console.log(`  csv: ${plan}\n  csv: ${out}`)

  if (!APPLY) { console.log('\nDry run: nothing written. Add --apply to write.\n'); return }

  const failures: string[] = []
  for (let i = 0; i < changes.length; i += CONCURRENCY) {
    await Promise.all(changes.slice(i, i + CONCURRENCY).map(async c => {
      const { error } = await db.from('attractions').update(c.changes).eq('id', c.row.id)
      if (error) failures.push(`${c.row.id}: ${error.message}`)
    }))
    if ((i / CONCURRENCY) % 50 === 0) console.log(`  written ${Math.min(i + CONCURRENCY, changes.length)}/${changes.length}`)
  }

  // Success is the row in the database, not the answer of the update.
  const want = new Map(changes.map(c => [c.row.id, { state: c.changes.state ?? c.row.state, city: c.changes.city ?? c.row.city }]))
  const ids = Array.from(want.keys())
  let confirmed = 0
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await db.from('attractions').select('id, state, city').in('id', ids.slice(i, i + 150))
    if (error) throw new Error(`re-read: ${error.message}`)
    for (const r of (data ?? []) as Array<{ id: string; state: string | null; city: string | null }>) {
      const w = want.get(r.id)!
      if (r.state === w.state && r.city === w.city) confirmed++
    }
  }
  console.log(`\nRe-read: ${confirmed}/${changes.length} rows now carry the new state and city.`)
  if (failures.length) {
    console.error(`${failures.length} updates failed:`)
    failures.slice(0, 20).forEach(f => console.error(`  ${f}`))
    process.exit(1)
  }
  if (confirmed !== changes.length) process.exit(1)
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e instanceof Error ? e.message : e); process.exit(1) })
