/**
 * #1203: reads of the catalogue for the Chile scripts. Read only; the writes live in the scripts,
 * next to the flag that allows them.
 *
 * supabase-js never rejects: every call here checks `error` and throws, so a failed page stops the
 * run instead of looking like an empty answer.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { BBox } from './admin-areas'

// Scripts build an untyped client with db.schema = 'core'.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CoreDb = SupabaseClient<any, any, any>

/** Service client on the core schema, from the .env the script was started with. */
export function createCoreDb(): CoreDb {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required (run with --env-file=.env)')
  return createClient(url, key, { db: { schema: 'core' }, auth: { autoRefreshToken: false, persistSession: false } })
}

const PAGE = 1000
const ID_CHUNK = 150

export interface CoordinateRow { attraction_id: string; latitude: number; longitude: number }

function firstCoordinate(v: unknown): { latitude: number; longitude: number } | null {
  const c = Array.isArray(v) ? v[0] : v
  if (c && typeof c === 'object' && typeof (c as { latitude?: unknown }).latitude === 'number') {
    return c as { latitude: number; longitude: number }
  }
  return null
}

export interface AdminRow {
  id: string
  name: string
  city: string | null
  state: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
}

/**
 * Every cadastro whose country spells Chile ("Chile", "CL", "República de Chile"...), with its
 * coordinate. Keyset pagination on id; the ILIKE is broad on purpose and isChileCountry refines.
 */
export async function fetchChileByCountry(db: CoreDb): Promise<AdminRow[]> {
  const out: AdminRow[] = []
  let last = '00000000-0000-0000-0000-000000000000'
  for (;;) {
    const { data, error } = await db.from('attractions')
      .select('id, name, city, state, country, attraction_coordinate(latitude, longitude)')
      .or('country.ilike.*chile*,country.in.(CL,cl,Cl)')
      .gt('id', last)
      .order('id')
      .limit(PAGE)
    if (error) throw new Error(`attractions by country: ${error.message}`)
    const rows = (data ?? []) as Array<Record<string, unknown>>
    for (const r of rows) {
      const c = firstCoordinate(r.attraction_coordinate)
      out.push({
        id: r.id as string,
        name: r.name as string,
        city: (r.city as string | null) ?? null,
        state: (r.state as string | null) ?? null,
        country: (r.country as string | null) ?? null,
        latitude: c?.latitude ?? null,
        longitude: c?.longitude ?? null,
      })
    }
    if (rows.length < PAGE) break
    last = rows[rows.length - 1].id as string
  }
  return out
}

/**
 * Coordinates inside a box, in latitude bands so each request walks a short stretch of the
 * (latitude, longitude) index idx_attraction_coordinate_viewport_v4.
 */
export async function scanCoordinates(db: CoreDb, box: BBox, bandDeg: number, onBand?: (done: number, total: number) => void): Promise<CoordinateRow[]> {
  const out: CoordinateRow[] = []
  const bands = Math.ceil((box.maxLat - box.minLat) / bandDeg)
  for (let b = 0; b < bands; b++) {
    const lo = box.minLat + b * bandDeg
    const hi = Math.min(box.maxLat, lo + bandDeg)
    for (let from = 0; ; from += PAGE) {
      let q = db.from('attraction_coordinate')
        .select('attraction_id, latitude, longitude')
        .gte('latitude', lo)
        .gte('longitude', box.minLng)
        .lte('longitude', box.maxLng)
      q = b === bands - 1 ? q.lte('latitude', hi) : q.lt('latitude', hi)
      const { data, error } = await q
        .order('latitude').order('longitude').order('attraction_id')
        .range(from, from + PAGE - 1)
      if (error) throw new Error(`attraction_coordinate scan [${lo.toFixed(2)}, ${hi.toFixed(2)}]: ${error.message}`)
      const rows = (data ?? []) as CoordinateRow[]
      out.push(...rows)
      if (rows.length < PAGE) break
    }
    onBand?.(b + 1, bands)
  }
  return out
}

/** core.attractions rows by id, in chunks that keep the URL short; entityKind narrows to one kind. */
export async function fetchAttractionsByIds<T>(db: CoreDb, ids: string[], columns: string, entityKind?: 'poi' | 'place' | 'event'): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const q = db.from('attractions').select(columns).in('id', ids.slice(i, i + ID_CHUNK))
    const { data, error } = await (entityKind ? q.eq('entity_kind', entityKind) : q)
    if (error) throw new Error(`attractions by id: ${error.message}`)
    out.push(...((data ?? []) as T[]))
  }
  return out
}
