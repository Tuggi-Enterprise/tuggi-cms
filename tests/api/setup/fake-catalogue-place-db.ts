/**
 * A stateful fake of what the registration merge (#885) reads and writes, so a case proves what was
 * left on the POI and not which function was called. Nothing here reaches a real database.
 *
 * It models, from the code under test:
 *  - `core.attractions`: read by id (`maybeSingle`), UPDATE applied only when EVERY filter holds
 *    (`eq`, and the `is('partner_client_id', null)` race guard);
 *  - `core.place_details`: UPDATE only touches a row that EXISTS — PostgREST answers 204 and no error
 *    for an UPDATE that matched nothing, which is the whole point of the `place_details` risk case;
 *  - `core.attraction_coordinate`: a head count; `cms_set_attraction_coordinate` makes it 1;
 *  - `partner.place_submissions` / `place_acceptances` / `partner_form_submissions` / `clients`;
 *  - the description rows, through `fake-description-db.ts` (the #888 fake).
 */

import { descriptionRpc, descriptionTable, freshDescWorld, type DescWorld } from './fake-description-db'

export const CLIENT = '44444444-4444-4444-8444-444444444444'
export const OTHER_CLIENT = '55555555-5555-4555-8555-555555555555'
export const POI = '77777777-7777-4777-8777-777777777777'

export interface WriteRecord {
  table: string
  op: 'update'
  patch: Record<string, unknown>
  filters: [string, string, unknown][]
  /** true when a row matched and was changed. */
  touched: boolean
}

export interface World {
  attraction: Record<string, unknown> | null
  /** `null` = the POI has NO `place_details` row. */
  details: Record<string, unknown> | null
  hasCoordinate: boolean
  coordinateWrites: { lat: number; lng: number }[]
  writes: WriteRecord[]
  /** Reads of each table, in order — to prove a path did not read the catalogue. */
  reads: string[]
  portal: { id: string; answers: Record<string, unknown> } | null
  acceptancePlan: string | null
  promotedAnswers: Record<string, unknown> | null
  clientWelcomePoi: string | null
  fail: {
    /** the merge's first read (`select partner_client_id`). */
    mergeOwnerRead?: boolean
    /** the catalogue identity read of `readCataloguePlace`. */
    catalogueRead?: boolean
    portalLookup?: boolean
  }
  /** Another operator links the POI between the route's read and its write. */
  stealOnLinkWrite: boolean
  desc: DescWorld
}

export function freshWorld(over: Partial<World> = {}): World {
  return {
    attraction: {
      id: POI,
      name: 'Baires Bistrô',
      city: 'Búzios',
      state: 'Rio de Janeiro',
      country: 'Brazil',
      entity_kind: 'place',
      approved: true,
      partner_client_id: null,
      formatted_address: null,
      postal_code: null,
      street_name: null,
      house_number: null,
      neighborhood: null,
    },
    details: { tags: [] },
    hasCoordinate: true,
    coordinateWrites: [],
    writes: [],
    reads: [],
    portal: null,
    acceptancePlan: null,
    promotedAnswers: null,
    clientWelcomePoi: null,
    fail: {},
    stealOnLinkWrite: false,
    desc: freshDescWorld({ name: 'Baires Bistrô', partnerClientId: CLIENT }),
    ...over,
  }
}

interface Q {
  table: string
  schema: string
  op: 'select' | 'update'
  cols: string
  patch: Record<string, unknown>
  filters: [string, string, unknown][]
  head: boolean
}

const ok = (data: unknown, extra: Record<string, unknown> = {}) => ({ data, error: null, ...extra })
const bad = (message: string) => ({ data: null, error: { message, code: 'XX000' } })

function holds(row: Record<string, unknown>, filters: Q['filters']): boolean {
  return filters.every(([kind, column, value]) => (kind === 'is' ? row[column] === value : row[column] === value))
}

function resolve(w: World, q: Q): any {
  if (q.schema === 'core' && q.table === 'cms_users') {
    return ok({ id: 'cms-1', email: 'admin@tuggi.app', role: 'admin', is_active: true })
  }

  if (q.op === 'update') {
    if (q.table === 'attractions' && w.attraction) {
      if (w.stealOnLinkWrite && 'partner_client_id' in q.patch) w.attraction.partner_client_id = OTHER_CLIENT
      const touched = holds(w.attraction, q.filters)
      if (touched) Object.assign(w.attraction, q.patch)
      w.writes.push({ table: q.table, op: 'update', patch: q.patch, filters: q.filters, touched })
      return ok(touched ? [{ id: POI }] : [])
    }
    if (q.table === 'place_details') {
      // UPDATE, not upsert: a POI without the row matches nothing and PostgREST says nothing.
      const touched = w.details !== null
      if (w.details) Object.assign(w.details, q.patch)
      w.writes.push({ table: q.table, op: 'update', patch: q.patch, filters: q.filters, touched })
      return ok(touched ? [{ attraction_id: POI }] : [])
    }
    if (q.table === 'clients') return ok([{ id: CLIENT }])
    return bad(`unexpected update on ${q.table}`)
  }

  w.reads.push(`${q.schema}.${q.table}`)
  switch (q.table) {
    case 'attractions':
      if (q.cols.trim() === 'partner_client_id' && w.fail.mergeOwnerRead) return bad('lookup failed')
      if (q.cols.includes('formatted_address') && !q.cols.includes('entity_kind') && w.fail.catalogueRead) {
        return bad('lookup failed')
      }
      return ok(w.attraction ? { ...w.attraction } : null)
    case 'place_details':
      return ok(w.details ? { tags: w.details.tags ?? null } : null)
    case 'attraction_coordinate':
      return ok(null, { count: w.hasCoordinate ? 1 : 0 })
    case 'place_submissions':
      if (w.fail.portalLookup) return bad('lookup failed')
      return ok(w.portal ? [{ id: w.portal.id, answers: w.portal.answers }] : [])
    case 'place_acceptances':
      return ok(w.acceptancePlan ? { email: 'dono@baires.com.br', plan_choice: w.acceptancePlan } : null)
    case 'partner_form_submissions':
      return ok(w.promotedAnswers ? [{ answers: w.promotedAnswers }] : [])
    case 'clients':
      return ok({ welcome_poi_id: w.clientWelcomePoi })
    default:
      return bad(`unexpected read of ${q.table}`)
  }
}

function from(w: World, schema: string, table: string) {
  if (table === 'attraction_descriptions') return descriptionTable(w.desc)
  const q: Q = { table, schema, op: 'select', cols: '', patch: {}, filters: [], head: false }
  const chain: any = {
    select: (cols = '', opts?: { head?: boolean }) => {
      if (q.op === 'select') q.cols = cols
      q.head = opts?.head === true
      return chain
    },
    update: (patch: Record<string, unknown>) => {
      q.op = 'update'
      q.patch = patch
      return chain
    },
    eq: (column: string, value: unknown) => (q.filters.push(['eq', column, value]), chain),
    is: (column: string, value: unknown) => (q.filters.push(['is', column, value]), chain),
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => resolve(w, q),
    then: (a: (v: unknown) => unknown, b?: (e: unknown) => unknown) => Promise.resolve(resolve(w, q)).then(a, b),
  }
  return chain
}

/** The operator's session client (`auth.supabase` of the routes, and the `operator` of the services). */
export function operatorOf(w: World): any {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: 'auth-op-1', email: 'admin@tuggi.app' } }, error: null }),
    },
    schema: (schema: string) => ({
      from: (table: string) => from(w, schema, table),
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === 'cms_set_attraction_coordinate') {
          w.coordinateWrites.push({ lat: args.p_latitude as number, lng: args.p_longitude as number })
          w.hasCoordinate = true
          return ok(null)
        }
        return descriptionRpc(w.desc, name, args)
      },
    }),
  }
}

/** `getSupabaseService()` — `partner` tables, and the descriptions' `auth.admin` lookup. */
export function serviceOf(w: World): any {
  const op = operatorOf(w)
  return { ...op, auth: { admin: { getUserById: async () => ({ data: null, error: null }) } } }
}
