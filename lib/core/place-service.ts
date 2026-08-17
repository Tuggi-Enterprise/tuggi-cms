/**
 * Place Service — SSOT do módulo Locais/Comércios. Espelha event-service.ts.
 *
 * Locais reusam horário (attractions.opening_hours + is_poi_open_now),
 * acessibilidade e contato de attractions; place_details guarda só o específico
 * de comércio (place_type/cuisine/price_range/reserva/menu/amenities/tags).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PartnerPlaceFacts } from '@/lib/partnerships/place-readiness'
import { getSupabaseClient } from './supabase-client'

/**
 * The catalogue's vocabulary for `core.place_details.place_type`.
 *
 * The column is free text — there is no CHECK behind it — so THIS list is what keeps the CMS
 * from holding a value none of its screens can show. It lived inside `PlaceFormModal` while
 * the modal was the only writer; the partner approval (#360) is the second one, and a second
 * copy of the list is how the two would come to disagree (CLAUDE.md §6, SSOT).
 */
export const PLACE_TYPES = ['restaurant', 'bar', 'cafe', 'shop', 'hotel', 'service', 'other'] as const

export type PlaceType = (typeof PLACE_TYPES)[number]

export interface PlaceListItem {
  id: string
  name: string
  city: string
  state: string | null
  country: string
  approved: boolean
  is_active: boolean
  priority_level: number | null
  image_url: string | null
  created_at: string
  updated_at: string
  latitude: number | null
  longitude: number | null
  place_type: string | null
  price_range: number | null
  tags: string[]
  has_hours: boolean
  description_count: number
  trigger_point_count: number
}

export interface PlaceFilters {
  search?: string
  status?: 'all' | 'approved' | 'pending'
  country?: string | null
  state?: string | null
  city?: string | null
  placeType?: string | null
  page?: number
  pageSize?: number
}

/**
 * WHO A PLACE BELONGS TO, COMMERCIALLY — `core.attractions.partner_client_id`, and this
 * constant is the only place in the CMS that names the column.
 *
 * IT IS NOT `owner_id` AND IT IS NOT `created_by`, and the difference is not stylistic.
 * `owner_id` is import provenance: it has a DEFAULT pointing at Tuggi's own client row and a
 * BEFORE INSERT trigger (`core.set_attraction_owner_on_insert`) that copies
 * `cms_users.client_id` from whoever typed the record, so 2,233,598 of 2,234,095 POIs carry
 * one single value and ZERO POIs belong to a partner through it (measured 2026-08-16,
 * `db-tuggiApp/supabase/migrations/20260816160000_issue358_*`). Scoping a partner's view by
 * `owner_id` would show them either everything or nothing.
 *
 * BR-CMS-002 — the partner sees only the POI of their own client — is written against
 * `owner_id` because it predates this column. The rule aged; the column is the answer, and the
 * divergence is reported to `produto` under the card rather than settled in silence.
 *
 * Cardinality is 1 client : N places (BR-B2B-033, item 3) — never assume one.
 */
export const PLACE_PARTNER_OWNER_COLUMN = 'partner_client_id'

/** A place with the client it belongs to, as `listByPartnerClient` answers. */
export type PartnerPlaceRow = PartnerPlaceFacts & { partnerClientId: string }

/**
 * How many rows of a child table one bulk lookup will read before it stops trusting itself.
 * A POI can carry hundreds of trigger points, so a single greedy row could starve the others
 * out of the page and make this module report "no trigger point" for a place that has one —
 * which is precisely the lie the pendency list exists to avoid. When the cap is reached the
 * lookup re-asks, per place, for the ones it saw nothing of.
 */
const CHILD_ROW_CAP = 2000

export interface PlaceFacets {
  total: number
  approved: number
  pending: number
  withHours: number
  withDescription: number
  withTriggerPoints: number
}

export interface CreatePlaceInput {
  name: string
  city: string
  country: string
  state?: string | null
  latitude?: number | null
  longitude?: number | null
  place_type?: string | null
}

/**
 * WHICH IDENTITY WRITES, and it is not a detail here.
 *
 * By default the browser client of whoever has the CMS open: every screen of this module is a
 * client component. `core.cms_create_place` is `SECURITY DEFINER` gated on
 * `core.is_active_cms_editor_or_admin()`, which reads `auth.jwt() ->> 'email'` — so the call
 * only works with a real CMS session behind it.
 *
 * A SERVER CALLER HAS TO HAND ITS OWN CLIENT OVER (the partner approval, #360). Reaching for
 * `service_role` there would not help and would be the wrong instinct twice: it bypasses RLS,
 * and the service JWT carries no e-mail, so that gate answers `not authorized to create places`.
 */
function client(db?: SupabaseClient) {
  return db ?? getSupabaseClient()
}

export const placeService = {
  async list(filters: PlaceFilters = {}): Promise<{ items: PlaceListItem[]; total: number }> {
    const page = filters.page ?? 1
    const pageSize = filters.pageSize ?? 50
    const { data, error } = await client()
      .schema('core')
      .rpc('cms_list_places', {
        search_term: filters.search || null,
        status_filter: filters.status || 'all',
        country_filter: filters.country || null,
        state_filter: filters.state || null,
        city_filter: filters.city || null,
        place_type_filter: filters.placeType || null,
        limit_count: pageSize,
        offset_count: (page - 1) * pageSize,
        fetch_all: false,
      })
    if (error) throw new Error(error.message)
    const rows = (data || []) as (PlaceListItem & { total_count: number })[]
    return { items: rows, total: rows.length > 0 ? Number(rows[0].total_count) : 0 }
  },

  async getFacets(filters: PlaceFilters = {}): Promise<PlaceFacets> {
    const { data, error } = await client()
      .schema('core')
      .rpc('cms_place_facets', {
        search_term: filters.search || null,
        country_filter: filters.country || null,
        state_filter: filters.state || null,
        city_filter: filters.city || null,
      })
    if (error) throw new Error(error.message)
    const f = (data?.[0] || {}) as Record<string, number>
    return {
      total: Number(f.total_count || 0),
      approved: Number(f.approved_count || 0),
      pending: Number(f.pending_count || 0),
      withHours: Number(f.with_hours_count || 0),
      withDescription: Number(f.with_description_count || 0),
      withTriggerPoints: Number(f.with_trigger_points_count || 0),
    }
  },

  /**
   * The place, as the detail screen reads it — plus the one column the RPC does not return.
   *
   * `core.get_place_details` (`supabase/migrations/20260703_07_places_rpcs.sql`) answers with 19
   * columns and `formatted_address` is not among them, even though the CMS itself writes it: the
   * partner-approval prefill does (`lib/partner-form/place-prefill.ts`, `PLACE_PREFILL_COLUMNS`).
   * The map of #371 opens over that address, so it has to arrive here. WIDENING THE RPC IS THE
   * RIGHT FIX and it is a requirement written back to the `data` (#371); until then this is one
   * extra bounded read, and a failed one is `null` — the map falls back and nothing blocks.
   */
  async getDetails(id: string) {
    const { data, error } = await client().schema('core').rpc('get_place_details', { p_place_id: id })
    if (error) throw new Error(error.message)
    const place = (data?.[0] as any) || null
    if (!place) return null
    return { ...place, formatted_address: await placeService.getFormattedAddress(id) }
  },

  /**
   * The address on the record, for CENTRING A MAP and for nothing else (#371).
   *
   * It is read from `core.attractions` with the caller's identity, the same way
   * `listByPartnerClient` reads the pipeline's places. It never becomes a coordinate: the only
   * writer of one is `setCoordinate`, and it is called from the save path of a human click.
   */
  async getFormattedAddress(attractionId: string, db?: SupabaseClient): Promise<string | null> {
    const { data, error } = await client(db)
      .schema('core')
      .from('attractions')
      .select('formatted_address')
      .eq('id', attractionId)
      .maybeSingle()
    if (error) return null
    return ((data as { formatted_address: string | null } | null)?.formatted_address ?? null) || null
  },

  async create(input: CreatePlaceInput, db?: SupabaseClient): Promise<string> {
    const { data, error } = await client(db)
      .schema('core')
      .rpc('cms_create_place', {
        p_name: input.name,
        p_city: input.city,
        p_country: input.country,
        p_state: input.state ?? null,
        p_latitude: input.latitude ?? null,
        p_longitude: input.longitude ?? null,
        p_place_type: input.place_type ?? null,
      })
    if (error) throw new Error(error.message)
    return data as string
  },

  async updateDetails(attractionId: string, patch: Record<string, any>) {
    const { error } = await client()
      .schema('core')
      .from('place_details')
      .update(patch)
      .eq('attraction_id', attractionId)
    if (error) throw new Error(error.message)
  },

  async updateAttraction(attractionId: string, patch: Record<string, any>, db?: SupabaseClient) {
    const { error } = await client(db).schema('core').from('attractions').update(patch).eq('id', attractionId)
    if (error) throw new Error(error.message)
  },

  /**
   * The places of one or more partner clients, with every fact the pendency report needs.
   *
   * WHY NOT `cms_list_places`: that RPC does not return `partner_client_id` and cannot filter
   * by it, and the two counts it does return are the wrong ones here — `trigger_point_count`
   * counts INACTIVE trigger points too, and `description_count` counts descriptions with no
   * audio. Both would report a place as working when it is mute. Widening the RPC is a
   * requirement written back to `data`; until then the Locais module reads the link here, and
   * `/places` keeps its own list.
   *
   * FOUR ROUND TRIPS AND NOT ONE JOIN: PostgREST embeds would return the whole child rows, and
   * `boundary_geometry` alone is a polygon per place. What comes back here is bounded.
   *
   * `entity_kind` IS NOT FILTERED, deliberately. The link is the link: an operator who tied an
   * `event` to a client would see it here rather than watch it vanish from the pipeline — and
   * one of the 6 clients measured in #356 had exactly that.
   */
  async listByPartnerClient(clientIds: string[], db?: SupabaseClient): Promise<PartnerPlaceRow[]> {
    if (clientIds.length === 0) return []
    const core = client(db).schema('core')

    const { data: places, error } = await core
      .from('attractions')
      // `entity_kind` and `is_active` are not decoration: they decide WHICH visibility
      // predicate applies and whether the place is in the app at all. See the header of
      // `lib/partnerships/place-readiness.ts`.
      .select('id, name, city, state, approved, is_active, entity_kind, partner_client_id')
      .in(PLACE_PARTNER_OWNER_COLUMN, clientIds)
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)

    const rows = (places ?? []) as {
      id: string
      name: string | null
      city: string | null
      state: string | null
      approved: boolean | null
      is_active: boolean | null
      entity_kind: string | null
      partner_client_id: string
    }[]
    if (rows.length === 0) return []

    const ids = rows.map((row) => row.id)

    const { data: coordinates, error: coordinateError } = await core
      .from('attraction_coordinate')
      // `location_geography` is GENERATED from lat/lng (declared in
      // `supabase/migrations/20260706_06_backfill_event_coordinates.sql`), so the pair answers
      // the read model's `location_geography IS NOT NULL` and is the thing a screen can show.
      .select('attraction_id, latitude, longitude, show_in_map, boundary_type, boundary_area_m2')
      .in('attraction_id', ids)
    if (coordinateError) throw new Error(coordinateError.message)

    interface CoordinateRow {
      attraction_id: string
      latitude: number | null
      longitude: number | null
      show_in_map: boolean | null
      boundary_type: string | null
      boundary_area_m2: number | null
    }

    const byId = new Map<string, CoordinateRow>()
    for (const row of (coordinates ?? []) as CoordinateRow[]) {
      byId.set(row.attraction_id, row)
    }

    const withTriggerPoint = await anyChildRow(core, 'attraction_trigger_points', ids, (query) =>
      query.eq('is_active', true)
    )
    const withAudio = await anyChildRow(core, 'attraction_descriptions', ids, (query) =>
      query.not('audio_url', 'is', null)
    )

    return rows.map((row) => {
      const coordinate = byId.get(row.id)
      return {
        attractionId: row.id,
        name: row.name ?? '',
        city: row.city,
        region: row.state,
        // `cms_create_place` writes `'place'`, so that is what a partner's place is; a POI the
        // team catalogued by hand and linked afterwards is `'poi'`. Unknown reads as `'place'`
        // — never as `'poi'`, because `'poi'` is the predicate with the EXTRA condition and
        // guessing it would invent a pendency.
        entityKind: row.entity_kind ?? 'place',
        approved: row.approved === true,
        // Absent reads as active: `core.attractions.is_active` is NOT NULL with a default of
        // true, and answering `false` for a missing value would report every place as out of
        // the app.
        isActive: row.is_active !== false,
        latitude: coordinate?.latitude ?? null,
        longitude: coordinate?.longitude ?? null,
        // No coordinate row at all reads `true`, exactly like the read model's
        // `COALESCE(attraction_coordinate.show_in_map, true)`. What hides such a place is the
        // absent coordinate, and that is already its own pendency.
        showInMap: coordinate?.show_in_map ?? true,
        activeTriggerPointCount: withTriggerPoint.has(row.id) ? 1 : 0,
        audioDescriptionCount: withAudio.has(row.id) ? 1 : 0,
        hasBoundary:
          (coordinate?.boundary_type ?? null) !== null ||
          (coordinate?.boundary_area_m2 ?? null) !== null,
        partnerClientId: row.partner_client_id,
      }
    })
  },

  /**
   * THE one writer of `core.attractions.approved`, in both directions — `approvePoi` in
   * `lib/core/poi-mutations-service.ts` delegates its core branch here, so the shape of this
   * write cannot differ between the partnership pipeline and the POI screen.
   *
   * WHAT IT WRITES IS THE PUBLICATION AND NOTHING ELSE: the three columns that carry it, named
   * literally here and never through a patch object the call site can grow a fourth key into.
   * `commission_rate`, `monthly_fee_cents`, `is_courtesy`, `status` and `slug` have no way in
   * (criterion 18, #359).
   *
   * `approved_at`/`approved_by` ARE the schema's home for "who put this in front of tourists,
   * and when", and leaving them null is how a column that exists comes to hold no data — the
   * `data` measured 136 filled rows in ~2.23 M approved ones on 2026-08-16, and zero among
   * `place` and `event`. `approved_by` is a FK to `drive.profiles(id)`, which every Supabase
   * Auth user has (trigger `on_auth_user_created`), so the operator's auth id is what goes in
   * — the same identity `approvePoi` has always written. Taking a place out of the app clears
   * both: `approved = false` next to `approved_by = <somebody>` would say a row was published
   * by a person while it is not published at all.
   *
   * The screen still READS the publication trail from `core.audit_logs`, which is the source
   * that carries a legible name and the history of every publication, not just the last one —
   * see `PartnershipPlace.publishedBy`.
   *
   * It is idempotent at the destination (DS-COMPONENTE-021, 2nd edge case), which is why the
   * screen may offer `Tentar de novo` after a network error: publishing the same place twice
   * is the same state. The promotion of a proposal is not, and still has no retry.
   */
  async setApproved(
    attractionId: string,
    approved: boolean,
    approvedBy: string | null,
    db?: SupabaseClient
  ) {
    const { error } = await client(db)
      .schema('core')
      .from('attractions')
      .update({
        approved,
        approved_at: approved ? new Date().toISOString() : null,
        approved_by: approved ? approvedBy : null,
      })
      .eq('id', attractionId)
    if (error) throw new Error(error.message)
  },

  /** Set/edit the place's coordinate (upsert in core.attraction_coordinate). */
  async setCoordinate(attractionId: string, latitude: number, longitude: number) {
    const { error } = await client()
      .schema('core')
      .rpc('cms_set_attraction_coordinate', {
        p_attraction_id: attractionId,
        p_latitude: latitude,
        p_longitude: longitude,
      })
    if (error) throw new Error(error.message)
  },
}

/**
 * Which of `ids` have at least one child row satisfying `narrow` — presence, never a count.
 *
 * The pendency copy is `Nenhum ponto de disparo ativo` and `Nenhuma descrição com áudio`, so a
 * boolean is the whole answer and pulling thousands of rows to compute it would be paying for
 * precision nobody displays.
 *
 * THE CAP IS THE INTERESTING PART. One bulk read with a cap can be exhausted by a single POI
 * with hundreds of trigger points, and the rows it did not reach would look ABSENT — the
 * pendency list would then tell the operator to go and create a trigger point that already
 * exists, which is worse than showing nothing. So when the cap is reached, every id with no
 * hit is asked again on its own, where a `limit(1)` cannot be starved.
 */
async function anyChildRow(
  core: { from: (table: string) => any },
  table: 'attraction_trigger_points' | 'attraction_descriptions',
  ids: string[],
  narrow: (query: any) => any
): Promise<Set<string>> {
  const found = new Set<string>()

  const { data, error } = await narrow(
    core.from(table).select('attraction_id').in('attraction_id', ids)
  ).limit(CHILD_ROW_CAP)
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as { attraction_id: string }[]
  for (const row of rows) found.add(row.attraction_id)

  if (rows.length < CHILD_ROW_CAP) return found

  const unseen = ids.filter((id) => !found.has(id))
  const answers = await Promise.all(
    unseen.map(async (id) => {
      const { data: one, error: oneError } = await narrow(
        core.from(table).select('attraction_id').eq('attraction_id', id)
      ).limit(1)
      if (oneError) throw new Error(oneError.message)
      return { id, present: ((one ?? []) as unknown[]).length > 0 }
    })
  )
  for (const answer of answers) if (answer.present) found.add(answer.id)

  return found
}
