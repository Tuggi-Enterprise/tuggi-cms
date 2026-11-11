/**
 * santiago-missing-pois-from-osm.ts (#1203). OSM attractions the catalogue does not have, in
 * central Santiago (Santiago, Providencia, Recoleta, Las Condes and the comunas around them) and in
 * a 2 km band along the six route corridors of the card.
 *
 * Attraction: tourism=attraction|museum|viewpoint|artwork|gallery, historic=*, a large
 * leisure=park, natural=peak|waterfall; always with a name. Missing: no cadastro with the same OSM
 * id or Wikidata item, and none within 150 m with a similar name. A missing element is created as a
 * `poi` only when it has a wikidata or wikipedia tag; the rest is listed for curation.
 *
 * Creation goes through POICreationService, the path the CMS uses for a manual POI (approved =
 * false, waiting for curation). state/city come from resolveAdminArea, the same function as
 * chile-fix-admin-areas.ts. No trigger point, no boundary, no audio: BR-POI-006 item 3, nobody
 * creates trigger configuration by deduction. Running it twice creates nothing the second time:
 * the created row matches its own OSM element by osm_id.
 *
 * Usage (from tuggi-cms/):
 *   npx tsx --env-file=.env scripts/santiago-missing-pois-from-osm.ts            # dry run (default)
 *   npx tsx --env-file=.env scripts/santiago-missing-pois-from-osm.ts --apply    # creates
 */
import { createCoreDb } from '../lib/osm-chile/catalogue'
import { loadChileAdminAreas, writeCsv } from '../lib/osm-chile/osm-sources'
import { CORRIDORS, CENTER_COMUNAS, planMissingPois } from '../lib/osm-chile/plans'
import { classify, priorityLevel } from '../lib/shared/poi-taxonomy'
import { POICreationService } from '../lib/services/poi-creation.service'

const APPLY = process.argv.includes('--apply') && !process.argv.includes('--dry-run')

async function main() {
  const db = createCoreDb()
  const areas = await loadChileAdminAreas()
  console.log(`Scope: comunas ${CENTER_COMUNAS.join(', ')}; corridors ${CORRIDORS.map(c => c.label).join('; ')}`)
  const plan = await planMissingPois(db, areas)
  plan.warnings.forEach(w => console.log(`warning: ${w}`))

  const create = plan.candidates.filter(c => c.action === 'create')
  const list = plan.candidates.filter(c => c.action === 'list')
  console.log(`\n${APPLY ? '[APPLY]' : '[DRY RUN]'} ${plan.candidates.length} OSM attractions in scope`)
  console.log(`  present in the catalogue: ${plan.candidates.length - create.length - list.length}`)
  console.log(`\n  to create: ${create.length}`)
  for (const c of create) {
    const e = c.element
    console.log(`  ${e.osmType}/${e.osmId} | ${e.name} | ${c.resolved?.city}, ${c.resolved?.state} | ${c.scope} | ${e.tags.wikidata ?? e.tags.wikipedia}`)
  }
  console.log(`\n  listed only (no reference, or outside the polygons): ${list.length}, all in the csv`)
  const file = writeCsv('missing-pois-plan.csv', ['osm', 'name', 'scope', 'action', 'reason', 'city', 'state', 'wikidata', 'wikipedia', 'lat', 'lng', 'match_id', 'match_by'],
    plan.candidates.map(c => [`${c.element.osmType}/${c.element.osmId}`, c.element.name, c.scope, c.action, c.reason,
      c.resolved?.city, c.resolved?.state, c.element.tags.wikidata, c.element.tags.wikipedia,
      c.element.lat.toFixed(6), c.element.lng.toFixed(6), c.match?.id, c.match?.by]))
  console.log(`  csv: ${file}`)

  if (!APPLY) { console.log('\nDry run: nothing written. Add --apply to create.\n'); return }

  const created: string[] = []
  const failures: string[] = []
  for (const c of create) {
    const e = c.element
    // Last check against a concurrent run: the OSM identity may have arrived since the plan.
    const { count, error: dupError } = await db.from('attractions').select('id', { count: 'exact', head: true })
      .eq('osm_type', e.osmType).eq('osm_id', String(e.osmId))
    if (dupError) { failures.push(`${e.osmType}/${e.osmId}: ${dupError.message}`); continue }
    if (count) continue

    const input = { osm_tags: e.tags, name: e.name, wikidata: e.tags.wikidata ?? null, wikipedia: e.tags.wikipedia ?? null }
    const cls = classify(input)
    const result = await POICreationService.createPOIWithCoordinates({
      name: e.name,
      city: c.resolved!.city!,
      state: c.resolved!.state,
      country: 'Chile',
      latitude: e.lat,
      longitude: e.lng,
      import_source: 'osm',
      source_type: 'osm',
      additionalFields: {
        entity_kind: 'poi',
        osm_type: e.osmType,
        osm_id: String(e.osmId),
        osm_tags: e.tags,
        wikidata: e.tags.wikidata ?? null,
        wikipedia: e.tags.wikipedia ?? null,
        category: cls.primary_category,
        primary_category: cls.primary_category,
        category_group: cls.category_group,
        priority_level: priorityLevel(cls.primary_category, input),
      },
    })
    if (!result.success || !result.attraction_id) failures.push(`${e.osmType}/${e.osmId}: ${result.error} ${result.details ?? ''}`)
    else created.push(result.attraction_id)
  }

  // Success is the row in the database, not the answer of the insert.
  let confirmed = 0
  for (let i = 0; i < created.length; i += 150) {
    const { data, error } = await db.from('attractions').select('id, attraction_coordinate(latitude)').in('id', created.slice(i, i + 150))
    if (error) throw new Error(`re-read: ${error.message}`)
    confirmed += ((data ?? []) as Array<{ attraction_coordinate: unknown[] | null }>).filter(r => (r.attraction_coordinate ?? []).length > 0).length
  }
  console.log(`\nRe-read: ${confirmed}/${create.length} POIs exist with a coordinate (${create.length - created.length - failures.length} skipped, already present).`)
  if (failures.length) {
    console.error(`${failures.length} creations failed:`)
    failures.slice(0, 20).forEach(f => console.error(`  ${f}`))
    process.exit(1)
  }
  if (confirmed !== created.length) process.exit(1)
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e instanceof Error ? e.message : e); process.exit(1) })
