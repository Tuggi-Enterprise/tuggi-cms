/**
 * dedupe-trigger-points.ts
 *
 * Finds trigger points that fire over the same ground and removes the redundant ones.
 *
 * A trigger point is a circle (location + radius_meters) PLUS an approach cone
 * (expected_bearing +/- bearing_threshold). All 20.2M rows in the base carry both, so
 * position alone is not enough to call two of them redundant: the same spot with opposite
 * bearings serves drivers coming from opposite directions, and dropping one would silence
 * the narration for that direction. Two trigger points are redundant only when the circles
 * overlap AND the cones overlap.
 *
 * Overlap of the circles is the exact lens area of two intersecting circles, expressed as a
 * fraction of the SMALLER one -- a 15 m circle sitting inside a 50 m circle is 100% covered,
 * which is what redundancy means here.
 *
 * Keeping is greedy over a stable ranking: type (primary > secondary > fallback), then
 * priority, then confidence_score, then radius, then id. A trigger point survives unless it
 * is redundant with one already kept, so the strongest of each cluster stays.
 *
 * DESTRUCTIVE with --execute: deletes rows, after writing a JSON backup.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/dedupe-trigger-points.ts --city Segovia
 *   ... --name "Muralla de Segovia"       scope to one POI name
 *   ... --attraction <uuid>               scope to one POI
 *   ... --min-overlap 0.6                 fraction of the smaller circle covered (default 0.6)
 *   ... --bearing-slack 1.0               cone tolerance; 1.0 = cones must actually intersect
 *   ... --execute                         apply (dry run otherwise)
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'fs'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: 'core' }, auth: { persistSession: false } },
)

const arg = (f: string) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null }
const CITY = arg('--city')
const NAME = arg('--name')
const ATTRACTION = arg('--attraction')
const COUNTRY = arg('--country') || 'Spain'
const MIN_OVERLAP = Number(arg('--min-overlap') ?? 0.6)
const BEARING_SLACK = Number(arg('--bearing-slack') ?? 1.0)
const DROP_INSIDE = process.argv.includes('--drop-inside-boundary')
const MAX_DISTANCE = arg('--max-distance') ? Number(arg('--max-distance')) : null
const EXECUTE = process.argv.includes('--execute')
const OUT = process.env.DEDUPE_OUT || `${process.cwd()}/.dedupe-out`

if (!CITY && !ATTRACTION) {
  console.error('usage: dedupe-trigger-points.ts (--city <city> [--name "<poi>"] | --attraction <uuid>)')
  console.error('       [--min-overlap 0.6] [--bearing-slack 1.0] [--drop-inside-boundary] [--max-distance <m>] [--execute]')
  process.exit(1)
}

interface TP {
  id: string
  attraction_id: string
  lat: number
  lng: number
  radius: number
  bearing: number
  threshold: number
  type: string
  priority: number | null
  confidence: number | null
}

const TYPE_RANK: Record<string, number> = { primary: 0, secondary: 1, fallback: 2 }

/** Metres between two WGS84 points, equirectangular -- exact enough at trigger-point scale. */
function metres(a: TP, b: TP): number {
  const rad = Math.PI / 180
  const latm = ((a.lat + b.lat) / 2) * rad
  const dx = (b.lng - a.lng) * rad * Math.cos(latm) * 6371000
  const dy = (b.lat - a.lat) * rad * 6371000
  return Math.hypot(dx, dy)
}

/** Area shared by two circles, as a fraction of the smaller circle's area. */
function circleOverlap(d: number, r1: number, r2: number): number {
  const rMin = Math.min(r1, r2), rMax = Math.max(r1, r2)
  if (d >= r1 + r2) return 0            // disjoint
  if (d <= rMax - rMin) return 1        // smaller sits entirely inside the bigger
  // classic lens area of two intersecting circles
  const a1 = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1))
  const a2 = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2))
  const a3 = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2))
  return (a1 + a2 - a3) / (Math.PI * rMin * rMin)
}

/** Smallest angle between two bearings, in degrees. */
function bearingGap(a: number, b: number): number {
  const d = Math.abs(((a ?? 0) - (b ?? 0)) % 360)
  return Math.min(d, 360 - d)
}

function redundant(a: TP, b: TP): boolean {
  const d = metres(a, b)
  if (circleOverlap(d, a.radius, b.radius) < MIN_OVERLAP) return false
  // Cones must intersect. Slack 1.0 = touching cones count; below 1.0 demands more alignment.
  return bearingGap(a.bearing, b.bearing) <= (a.threshold + b.threshold) * BEARING_SLACK
}

function rank(t: TP): number[] {
  return [TYPE_RANK[t.type] ?? 9, -(t.priority ?? 0), -(t.confidence ?? 0), -t.radius]
}

async function load(): Promise<TP[]> {
  let q = db.from('attraction_trigger_points')
    .select('id, attraction_id, radius_meters, expected_bearing, bearing_threshold, type, priority, confidence_score, attractions!inner(id, city, country, name)')
  if (ATTRACTION) q = q.eq('attraction_id', ATTRACTION)
  else {
    q = q.eq('attractions.country', COUNTRY).eq('attractions.city', CITY!)
    if (NAME) q = q.eq('attractions.name', NAME)
  }
  const { data, error } = await q.limit(50000)
  if (error) throw new Error(error.message)

  // location is geography; PostgREST does not hand it over usably, so coordinates come from
  // a scoped diag_sql read keyed by the same ids.
  const ids = (data || []).map((r: any) => r.id)
  const coords = new Map<string, { lat: number; lng: number }>()
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500).map((x: string) => `'${x}'`).join(',')
    const { data: c, error: e } = await db.rpc('diag_sql', {
      q: `select id::text, public.st_y(location::public.geometry) lat, public.st_x(location::public.geometry) lng
          from core.attraction_trigger_points where id in (${chunk})`,
    })
    if (e) throw new Error(e.message)
    for (const r of (c as any[]) || []) coords.set(r.id, { lat: r.lat, lng: r.lng })
  }

  return (data || []).map((r: any) => ({
    id: r.id,
    attraction_id: r.attraction_id,
    lat: coords.get(r.id)!.lat,
    lng: coords.get(r.id)!.lng,
    radius: r.radius_meters ?? 40,
    bearing: r.expected_bearing ?? 0,
    threshold: r.bearing_threshold ?? 30,
    type: r.type ?? 'secondary',
    priority: r.priority,
    confidence: r.confidence_score,
  })).filter(t => coords.has(t.id))
}

/**
 * Position of each trigger point relative to its POI's boundary.
 *
 * Backs the two rules that are about the tourist, not about geometry:
 *
 *   inside  -- BR-AUDIO-013 already fires the POI by boundary there, and BR-AUDIO-014 says the
 *              path that fires decides the directional cue. A trigger point inside the polygon
 *              therefore makes the app announce "on your left, the city wall" to someone
 *              standing inside that wall. The rulebook names removing the trigger point as the
 *              fix, in that exact wording.
 *   dist    -- BR-AUDIO-009 calls a trigger point that fires from far outside the polygon
 *              "defeito de cadastro, não do motor", to be fixed by removing or moving it.
 *
 * POIs with no boundary are returned empty and both rules skip them: there is nothing to
 * measure against, and guessing would delete real coverage.
 */
async function boundaryFacts(ids: string[]): Promise<Map<string, { inside: boolean; dist: number }>> {
  const out = new Map<string, { inside: boolean; dist: number }>()
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500).map(x => `'${x}'`).join(',')
    const { data, error } = await db.rpc('diag_sql', {
      q: `select t.id::text,
                 public.st_intersects(t.location, ac.boundary_geometry) inside,
                 public.st_distance(t.location, ac.boundary_geometry) dist
          from core.attraction_trigger_points t
          join core.attraction_coordinate ac on ac.attraction_id = t.attraction_id
          where t.id in (${chunk}) and ac.boundary_geometry is not null`,
    })
    if (error) throw new Error(error.message)
    for (const r of (data as any[]) || []) out.set(r.id, { inside: r.inside, dist: Number(r.dist) })
  }
  return out
}

async function main() {
  const scope = ATTRACTION ? `attraction ${ATTRACTION}` : `${CITY}/${COUNTRY}${NAME ? ` "${NAME}"` : ''}`
  console.log(`\n=== dedupe trigger points -- ${scope} ${EXECUTE ? '(EXECUTING)' : '(DRY RUN)'} ===`)
  console.log(`min-overlap ${MIN_OVERLAP}  bearing-slack ${BEARING_SLACK}\n`)

  const all = await load()
  if (!all.length) { console.log('no trigger points in scope.'); return }

  // Boundary rules run FIRST: a trigger point that should not exist must never be the one
  // kept as "best" of an overlap cluster.
  const doomed: TP[] = []
  const reason = new Map<string, string>()
  let noBoundary = 0
  if (DROP_INSIDE || MAX_DISTANCE !== null) {
    const facts = await boundaryFacts(all.map(t => t.id))
    noBoundary = all.length - facts.size
    for (const t of all) {
      const f = facts.get(t.id)
      if (!f) continue
      if (DROP_INSIDE && f.inside) { doomed.push(t); reason.set(t.id, 'inside boundary'); continue }
      if (MAX_DISTANCE !== null && !f.inside && f.dist > MAX_DISTANCE) {
        doomed.push(t); reason.set(t.id, `${Math.round(f.dist)} m from boundary`)
      }
    }
    const inside = [...reason.values()].filter(r => r === 'inside boundary').length
    console.log(`boundary rules: ${inside} inside, ${reason.size - inside} beyond ${MAX_DISTANCE} m`)
    if (noBoundary) console.log(`  (${noBoundary} trigger points skipped: their POI has no boundary)`)
  }

  const survivors = all.filter(t => !reason.has(t.id))
  const byPoi = new Map<string, TP[]>()
  for (const t of survivors) {
    if (!byPoi.has(t.attraction_id)) byPoi.set(t.attraction_id, [])
    byPoi.get(t.attraction_id)!.push(t)
  }

  for (const [, list] of byPoi) {
    // Redundancy is only ever judged inside one POI: two different POIs may legitimately
    // trigger from the same stretch of road.
    list.sort((a, b) => {
      const ra = rank(a), rb = rank(b)
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i]
      return a.id < b.id ? -1 : 1
    })
    const kept: TP[] = []
    for (const t of list) {
      if (kept.some(k => redundant(k, t))) { doomed.push(t); reason.set(t.id, 'overlaps a stronger one') }
      else kept.push(t)
    }
  }

  console.log(`\n${all.length} trigger points across ${byPoi.size} POI(s)`)
  const byReason = new Map<string, number>()
  for (const r of reason.values()) {
    const k = r.endsWith('m from boundary') ? `beyond ${MAX_DISTANCE} m` : r
    byReason.set(k, (byReason.get(k) ?? 0) + 1)
  }
  for (const [r, n] of [...byReason].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${r}`)
  console.log(`removing ${doomed.length}  ->  keeping ${all.length - doomed.length}`)

  if (doomed.length) {
    const perPoi = new Map<string, number>()
    for (const t of doomed) perPoi.set(t.attraction_id, (perPoi.get(t.attraction_id) ?? 0) + 1)
    const worst = [...perPoi.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    console.log('\nmost affected POIs:')
    // Denominator must be everything the POI had, not just what reached the overlap pass:
    // byPoi already excludes what the boundary rules removed.
    const totalPerPoi = new Map<string, number>()
    for (const t of all) totalPerPoi.set(t.attraction_id, (totalPerPoi.get(t.attraction_id) ?? 0) + 1)
    for (const [aid, n] of worst) {
      console.log(`  ${aid}  ${n}/${totalPerPoi.get(aid)} removed`)
    }
  }

  if (!EXECUTE) { console.log('\n[DRY RUN] nothing deleted. Add --execute to apply.\n'); return }
  if (!doomed.length) { console.log('\nnothing to do.\n'); return }

  mkdirSync(OUT, { recursive: true })
  const ids = doomed.map(t => t.id)
  const backup: any[] = []
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await db.from('attraction_trigger_points').select('*').in('id', ids.slice(i, i + 500))
    backup.push(...(data || []))
  }
  const file = `${OUT}/dedupe_${(ATTRACTION || `${CITY}_${NAME ?? 'all'}`)}.json`.replace(/\s+/g, '_')
  writeFileSync(file, JSON.stringify(backup, null, 2))
  console.log(`\nbackup: ${file} (${backup.length} trigger points)`)

  let deleted = 0
  for (let i = 0; i < ids.length; i += 500) {
    const { error } = await db.from('attraction_trigger_points').delete().in('id', ids.slice(i, i + 500))
    if (error) { console.error(`FAIL at chunk ${i}: ${error.message}`); break }
    deleted += Math.min(500, ids.length - i)
  }
  console.log(`${deleted} trigger points deleted\n`)
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
