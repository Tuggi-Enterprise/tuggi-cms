/**
 * santiago-pois-to-places.ts (#1203). In the Santiago area (150 km around Plaza de Armas, inside
 * Chile), entity_kind 'poi' becomes 'place' for lodging (hotel, hostel, guest house, apartment,
 * motel) and commerce (restaurant, bar, café, pub, fast food, any shop, mall).
 *
 * The criterion is the OSM tag of the element matched to the cadastro: its own osm_tags when it has
 * them, otherwise the nearest OSM element within 150 m with a similar name. The cadastro category
 * is the second signal. An attraction stays poi even with commerce inside (Mercado Central); a
 * doubtful case is not converted and is listed.
 *
 * Only entity_kind changes. BR-POI-006 items 3 and 5: trigger points, boundary and audio are left
 * as they are; entity_kind only changes the door the tourist finds the cadastro through (item 6).
 * Running it twice converts nothing the second time: only rows still 'poi' are read and updated.
 *
 * Usage (from tuggi-cms/):
 *   npx tsx --env-file=.env scripts/santiago-pois-to-places.ts            # dry run (default)
 *   npx tsx --env-file=.env scripts/santiago-pois-to-places.ts --apply    # writes
 */
import { createCoreDb } from '../lib/osm-chile/catalogue'
import { loadChileAdminAreas, writeCsv } from '../lib/osm-chile/osm-sources'
import { type PlaceCandidate, planPoisToPlaces } from '../lib/osm-chile/plans'

const APPLY = process.argv.includes('--apply') && !process.argv.includes('--dry-run')

function line(p: PlaceCandidate): string {
  return `  ${p.id} | ${p.name} | ${p.category ?? '-'} | ${p.verdict.tag ?? '-'} (${p.tagSource}${p.osmRef ? ` ${p.osmRef}` : ''}) | ${p.verdict.decision}: ${p.verdict.reason}`
}

async function main() {
  const db = createCoreDb()
  const areas = await loadChileAdminAreas()
  const items = await planPoisToPlaces(db, areas)
  const convert = items.filter(i => i.verdict.decision === 'place')
  const doubtful = items.filter(i => i.verdict.decision === 'doubtful')

  console.log(`\n${APPLY ? '[APPLY]' : '[DRY RUN]'} ${items.length} poi in the Santiago area`)
  console.log('  id | name | current category | OSM tag (source) | decision')
  console.log(`\n  convert to place: ${convert.length}`)
  convert.forEach(p => console.log(line(p)))
  console.log(`\n  doubtful, stay poi: ${doubtful.length}`)
  doubtful.forEach(p => console.log(line(p)))
  console.log(`\n  stay poi (attraction or no lugar tag): ${items.length - convert.length - doubtful.length}, all in the csv`)
  const file = writeCsv('pois-to-places-plan.csv', ['id', 'name', 'category', 'tag_source', 'osm_ref', 'osm_tag', 'decision', 'reason'],
    items.map(p => [p.id, p.name, p.category, p.tagSource, p.osmRef, p.verdict.tag, p.verdict.decision, p.verdict.reason]))
  console.log(`  csv: ${file}`)

  if (!APPLY) { console.log('\nDry run: nothing written. Add --apply to write.\n'); return }

  const ids = convert.map(p => p.id)
  for (let i = 0; i < ids.length; i += 150) {
    const { error } = await db.from('attractions').update({ entity_kind: 'place' })
      .in('id', ids.slice(i, i + 150)).eq('entity_kind', 'poi')
    if (error) throw new Error(`update entity_kind: ${error.message}`)
  }

  // Success is the row in the database, not the answer of the update.
  let confirmed = 0
  for (let i = 0; i < ids.length; i += 150) {
    const { count, error } = await db.from('attractions').select('id', { count: 'exact', head: true })
      .in('id', ids.slice(i, i + 150)).eq('entity_kind', 'place')
    if (error) throw new Error(`re-read: ${error.message}`)
    confirmed += count ?? 0
  }
  console.log(`\nRe-read: ${confirmed}/${ids.length} rows are now entity_kind = 'place'.`)
  if (confirmed !== ids.length) process.exit(1)
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e instanceof Error ? e.message : e); process.exit(1) })
