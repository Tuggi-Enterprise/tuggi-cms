/**
 * merge-duplicate-pois.ts
 *
 * Merges POIs that share a name into a single one, keeping every boundary and every trigger
 * point. Built for linear or sprawling monuments that OSM maps as many ways: the Muralla de
 * Segovia is 27 rows covering ~1.9 km of wall, each with its own boundary and 5-24 trigger
 * points, 386 in total.
 *
 * What it does:
 *   1. Picks the survivor -- most trigger points, then lowest priority_level, then the
 *      largest boundary. Ties broken by id so a rerun always chooses the same row.
 *   2. Unions every boundary into the survivor via ST_Union.
 *   3. Repoints all trigger points at the survivor. NOTHING is dropped: the goal is to merge,
 *      not to prune. Use --dedupe-tps <meters> to also collapse ones that sit on top of each
 *      other (386 -> 225 at 30 m, -> 162 at 60 m on the Muralla, where the average trigger
 *      radius is 29 m).
 *   4. Backs the losers up to JSON and deletes them through dedup_delete_pois.
 *
 * KNOWN LIMIT -- the union of scattered segments is a MultiPolygon, and the front end does not
 * render MultiPolygon today (proved on the Sagrada Familia: stored boundary, right area,
 * has_boundary=true, nothing drawn). The data is correct and the trigger point engine reads it
 * fine; the drawing only appears once the front handles MultiPolygon. Taking the convex hull
 * instead would render but would claim the wall is the whole old town -- 528,535 m2 against
 * 36,418 -- so it is not offered.
 *
 * DESTRUCTIVE: deletes rows. Dry run by default; --execute to apply.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/merge-duplicate-pois.ts --city Segovia --name "Muralla de Segovia"
 *   ... --execute [--dedupe-tps 30]
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'fs'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: 'core' }, auth: { persistSession: false } },
)

const arg = (flag: string) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : null }
const CITY = arg('--city')
const NAME = arg('--name')
const COUNTRY = arg('--country') || 'Spain'
const EXECUTE = process.argv.includes('--execute')
const DEDUPE_TPS = arg('--dedupe-tps') ? Number(arg('--dedupe-tps')) : null
const OUT = process.env.MERGE_OUT || `${process.cwd()}/.merge-out`

if (!CITY || !NAME) {
  console.error('usage: merge-duplicate-pois.ts --city <city> --name "<name>" [--country X] [--execute] [--dedupe-tps <m>]')
  process.exit(1)
}

/** Reads. core.diag_sql refuses anything that is not SELECT/WITH. */
const sql = async (q: string) => {
  const { data, error } = await db.rpc('diag_sql', { q: q.replace(/\s+/g, ' ').trim() })
  if (error) throw new Error(error.message)
  return (data || []) as any[]
}

/**
 * Writes. Must NOT go through diag_sql: that one raises "só SELECT/WITH" on any
 * insert/update/delete, so every write here would have failed at --execute time while the
 * dry run stayed green. core.exec_sql returns the number of affected rows.
 *
 * Two traps, both hit for real while writing this:
 *   1. core.exec_sql runs with `search_path = core, pg_temp`, and PostGIS lives in `public`.
 *      Every geometry/geography type and every ST_* call passed in here MUST be schema
 *      qualified, or it dies with `type "geometry" does not exist`.
 *   2. A dry run exercises none of this. Validate a write statement by pointing it at an id
 *      that matches nothing: Postgres still resolves every type while affecting zero rows.
 */
const exec = async (q: string): Promise<number> => {
  const { data, error } = await db.rpc('exec_sql', { q: q.replace(/\s+/g, ' ').trim() })
  if (error) throw new Error(`exec_sql: ${error.message}`)
  return typeof data === 'number' ? data : 0
}

const esc = (s: string) => s.replace(/'/g, "''")

async function main() {
  console.log(`\n=== merge "${NAME}" in ${CITY}/${COUNTRY} ${EXECUTE ? '(EXECUTING)' : '(DRY RUN)'} ===\n`)

  const rows = await sql(`
    select a.id,
           a.priority_level,
           coalesce(round(st_area(ac.boundary_geometry)::numeric), 0) area,
           (select count(*) from core.attraction_trigger_points t where t.attraction_id = a.id) tps
    from core.attractions a
    left join core.attraction_coordinate ac on ac.attraction_id = a.id
    where a.city = '${esc(CITY!)}' and a.country = '${esc(COUNTRY)}' and a.name = '${esc(NAME!)}'
    order by tps desc, a.priority_level nulls last, area desc, a.id
  `)

  if (rows.length < 2) { console.log(`nothing to merge: found ${rows.length} row(s).`); return }

  const survivor = rows[0]
  const losers = rows.slice(1)
  const totalTps = rows.reduce((s, r) => s + Number(r.tps), 0)
  console.log(`${rows.length} rows, ${totalTps} trigger points total`)
  console.log(`survivor: ${survivor.id}  (level ${survivor.priority_level}, ${survivor.tps} tps, ${survivor.area} m2)`)
  console.log(`losers:   ${losers.length} rows, ${totalTps - Number(survivor.tps)} tps to repoint\n`)

  const [u] = await sql(`
    select st_geometrytype(st_union(ac.boundary_geometry::geometry)) tipo,
           st_numgeometries(st_union(ac.boundary_geometry::geometry)) partes,
           round(st_area(st_union(ac.boundary_geometry::geometry)::geography)::numeric) area
    from core.attractions a join core.attraction_coordinate ac on ac.attraction_id = a.id
    where a.city = '${esc(CITY!)}' and a.country = '${esc(COUNTRY)}' and a.name = '${esc(NAME!)}'
      and ac.boundary_geometry is not null
  `)
  console.log(`merged boundary: ${u?.tipo} with ${u?.partes} part(s), ${u?.area} m2`)
  if (String(u?.tipo).includes('Multi')) {
    console.log('  WARNING: MultiPolygon -- correct in the database, but the front end does not')
    console.log('  draw it yet. Same limitation seen on the Sagrada Familia.')
  }

  if (DEDUPE_TPS) {
    const [d] = await sql(`
      with tp as (
        select t.id, t.location from core.attraction_trigger_points t
        join core.attractions a on a.id = t.attraction_id
        where a.city = '${esc(CITY!)}' and a.country = '${esc(COUNTRY)}' and a.name = '${esc(NAME!)}'
      )
      select count(*) total,
             (select count(*) from (select distinct on (public.st_snaptogrid(location::public.geometry, ${DEDUPE_TPS / 111000})) id from tp) x) kept
      from tp
    `)
    console.log(`trigger points: ${d?.total} -> ${d?.kept} after collapsing within ${DEDUPE_TPS} m`)
  } else {
    console.log(`trigger points: keeping all ${totalTps} (pass --dedupe-tps <m> to collapse)`)
  }

  if (!EXECUTE) { console.log('\n[DRY RUN] nothing written. Add --execute to apply.\n'); return }

  mkdirSync(OUT, { recursive: true })
  const ids = losers.map(l => l.id)
  const backup: any[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await db.from('attractions').select('*').in('id', ids.slice(i, i + 100))
    backup.push(...(data || []))
  }
  const { data: coords } = await db.from('attraction_coordinate').select('*').in('attraction_id', ids)
  const { data: tps } = await db.from('attraction_trigger_points').select('*').in('attraction_id', ids)
  const file = `${OUT}/merge_${CITY}_${NAME}.json`.replace(/\s+/g, '_')
  writeFileSync(file, JSON.stringify({ survivor: survivor.id, attractions: backup, coordinates: coords, trigger_points: tps }, null, 2))
  console.log(`\nbackup: ${file} (${backup.length} attractions, ${tps?.length ?? 0} trigger points)`)

  // 1. union every boundary into the survivor, before the losers disappear
  const nBnd = await exec(`
    with u as (
      select public.st_union(ac.boundary_geometry::public.geometry) g
      from core.attractions a join core.attraction_coordinate ac on ac.attraction_id = a.id
      where a.city = '${esc(CITY!)}' and a.country = '${esc(COUNTRY)}' and a.name = '${esc(NAME!)}'
        and ac.boundary_geometry is not null
    )
    update core.attraction_coordinate ac
    set boundary_geometry = u.g::public.geography,
        boundary_type = 'polygon',
        boundary_source = 'osm',
        boundary_area_m2 = round(public.st_area(u.g::public.geography)::numeric),
        boundary_centroid_lat = round(public.st_y(public.st_centroid(u.g))::numeric, 7),
        boundary_centroid_lng = round(public.st_x(public.st_centroid(u.g))::numeric, 7),
        updated_at = now()
    from u where ac.attraction_id = '${survivor.id}'
  `)
  console.log(`boundary merged into survivor (${nBnd} row)`)

  // 2. repoint every trigger point at the survivor
  const nTp = await exec(`
    update core.attraction_trigger_points
    set attraction_id = '${survivor.id}'
    where attraction_id in (${ids.map(i => `'${i}'`).join(',')})
  `)
  console.log(`${nTp} trigger points repointed`)

  if (DEDUPE_TPS) {
    const nDel = await exec(`
      delete from core.attraction_trigger_points t
      where t.attraction_id = '${survivor.id}'
        and t.id not in (
          select distinct on (public.st_snaptogrid(location::public.geometry, ${DEDUPE_TPS / 111000})) id
          from core.attraction_trigger_points where attraction_id = '${survivor.id}'
          order by public.st_snaptogrid(location::public.geometry, ${DEDUPE_TPS / 111000}), priority nulls last, id
        )
    `)
    console.log(`${nDel} trigger points removed by the ${DEDUPE_TPS} m collapse`)
  }

  // 3. drop the losers
  const rpc = await db.rpc('dedup_delete_pois', { p_ids: ids })
  if (rpc.error) {
    const del = await db.from('attractions').delete().in('id', ids)
    if (del.error) { console.error(`FAIL delete: ${del.error.message}`); return }
    console.log(`${ids.length} rows deleted (direct)`)
  } else {
    console.log(`${ids.length} rows deleted (rpc)`)
  }

  const [after] = await sql(`
    select count(*) rows,
           (select count(*) from core.attraction_trigger_points where attraction_id = '${survivor.id}') tps
    from core.attractions
    where city = '${esc(CITY!)}' and country = '${esc(COUNTRY)}' and name = '${esc(NAME!)}'
  `)
  console.log(`\nafter: ${after?.rows} row, ${after?.tps} trigger points on ${survivor.id}\n`)
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
