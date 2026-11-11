/**
 * chile-diagnose.ts (#1203). Read only: writes nothing to the database.
 *
 *   (a) cadastros of Chile whose state/city differ from the OSM región/comuna, with 20 examples,
 *       plus the country spellings found on points that fall inside Chile;
 *   (b) lugar candidates in the Santiago area (150 km around Plaza de Armas, inside Chile);
 *   (c) the OSM attractions the catalogue does not have (script 4 in diagnosis mode).
 *
 * The plans come from lib/osm-chile/plans.ts, the same functions the write scripts apply.
 * CSVs go to output/chile-1203/.
 *
 * Usage (from tuggi-cms/):
 *   npx tsx --env-file=.env scripts/chile-diagnose.ts
 *   npx tsx --env-file=.env scripts/chile-diagnose.ts --skip-country-scan   # skips the Chile-wide coordinate scan
 */
import { CHILE_BBOXES, isChileCountry, SANTIAGO_CENTER, SANTIAGO_RADIUS_KM } from '../lib/osm-chile/admin-areas'
import { createCoreDb, fetchAttractionsByIds, scanCoordinates } from '../lib/osm-chile/catalogue'
import { loadChileAdminAreas, writeCsv } from '../lib/osm-chile/osm-sources'
import { inChile, planAdminFixes, planMissingPois, planPoisToPlaces } from '../lib/osm-chile/plans'

const SKIP_COUNTRY_SCAN = process.argv.includes('--skip-country-scan')

async function main() {
  const db = createCoreDb()
  const areas = await loadChileAdminAreas()

  // ── (a) región and comuna ──
  console.log('\n(a) Chile cadastros: state/city against OSM región/comuna')
  const fixes = await planAdminFixes(db, areas)
  const count = (s: string) => fixes.filter(f => f.status === s).length
  const changes = fixes.flatMap(f => f.status === 'change' && 'plan' in f && f.plan.status === 'change' ? [{ f, c: f.plan.changes }] : [])
  console.log(`  ${fixes.length} cadastros with country Chile: ${changes.length} diverge` +
    ` (state ${changes.filter(x => x.c.state).length}, city ${changes.filter(x => x.c.city).length}),` +
    ` ${count('unchanged')} already right, ${count('outside')} outside every polygon, ${count('no_coordinate')} without coordinate`)
  for (const { f, c } of changes.slice(0, 20)) {
    console.log(`  ${f.row.id}  ${f.row.name}: state "${f.row.state ?? ''}" -> "${c.state ?? f.row.state ?? ''}" | city "${f.row.city ?? ''}" -> "${c.city ?? f.row.city ?? ''}"`)
  }
  const fileA = writeCsv('diagnose-admin.csv', ['id', 'name', 'country', 'state', 'city', 'status', 'new_state', 'new_city'],
    fixes.map(f => [f.row.id, f.row.name, f.row.country, f.row.state, f.row.city, f.status,
      'resolved' in f ? f.resolved.state : '', 'resolved' in f ? f.resolved.city : '']))
  console.log(`  csv: ${fileA}`)

  if (!SKIP_COUNTRY_SCAN) {
    console.log('  scanning coordinates inside Chile for other country spellings...')
    const known = new Set(fixes.map(f => f.row.id))
    const coords = []
    for (const box of CHILE_BBOXES) {
      coords.push(...await scanCoordinates(db, box, 0.5, (d, t) => { if (d % 10 === 0 || d === t) console.log(`    band ${d}/${t}`) }))
    }
    const inside = coords.filter(c => inChile({ lat: c.latitude, lng: c.longitude }, areas))
    const unknown = inside.filter(c => !known.has(c.attraction_id)).map(c => c.attraction_id)
    const others = await fetchAttractionsByIds<{ id: string; name: string; country: string | null }>(db, unknown, 'id, name, country')
    const spellings = new Map<string, number>()
    for (const f of fixes) spellings.set(f.row.country ?? '', (spellings.get(f.row.country ?? '') ?? 0) + 1)
    for (const o of others) spellings.set(o.country ?? '', (spellings.get(o.country ?? '') ?? 0) + 1)
    console.log(`  ${inside.length} points inside Chile; country spellings:`)
    Array.from(spellings.entries()).sort((x, y) => y[1] - x[1]).slice(0, 15)
      .forEach(([k, n]) => console.log(`    "${k}"  ${n}${isChileCountry(k) ? '' : '  (not read as Chile by scripts 2 and 3)'}`))
    const fileO = writeCsv('diagnose-country-outside-chile-spelling.csv', ['id', 'name', 'country'], others.map(o => [o.id, o.name, o.country]))
    console.log(`  ${others.length} cadastros inside Chile with another country value; csv: ${fileO}`)
  }

  // ── (b) lugar candidates ──
  console.log(`\n(b) lugar candidates within ${SANTIAGO_RADIUS_KM} km of (${SANTIAGO_CENTER.lat}, ${SANTIAGO_CENTER.lng}), inside Chile`)
  const places = await planPoisToPlaces(db, areas)
  const conv = places.filter(p => p.verdict.decision === 'place')
  const doubt = places.filter(p => p.verdict.decision === 'doubtful')
  console.log(`  ${places.length} poi in the area: ${conv.length} would become place, ${doubt.length} doubtful (stay poi, listed)`)
  const fileB = writeCsv('diagnose-places.csv', ['id', 'name', 'category', 'tag_source', 'osm_ref', 'osm_tag', 'decision', 'reason'],
    places.map(p => [p.id, p.name, p.category, p.tagSource, p.osmRef, p.verdict.tag, p.verdict.decision, p.verdict.reason]))
  console.log(`  csv: ${fileB}`)

  // ── (c) missing OSM attractions ──
  console.log('\n(c) OSM attractions missing from the catalogue (central comunas and 2 km corridors)')
  const missing = await planMissingPois(db, areas)
  missing.warnings.forEach(w => console.log(`  warning: ${w}`))
  const by = (a: string) => missing.candidates.filter(c => c.action === a)
  console.log(`  ${missing.candidates.length} OSM attractions in scope: ${by('present').length} present,` +
    ` ${by('create').length} would be created (wikidata/wikipedia), ${by('list').length} listed only`)
  const fileC = writeCsv('diagnose-missing.csv', ['osm', 'name', 'scope', 'action', 'reason', 'wikidata', 'wikipedia', 'lat', 'lng'],
    missing.candidates.filter(c => c.action !== 'present').map(c => [`${c.element.osmType}/${c.element.osmId}`, c.element.name, c.scope,
      c.action, c.reason, c.element.tags.wikidata, c.element.tags.wikipedia, c.element.lat.toFixed(6), c.element.lng.toFixed(6)]))
  console.log(`  csv: ${fileC}\n`)
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e instanceof Error ? e.message : e); process.exit(1) })
