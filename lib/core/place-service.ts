/**
 * Place Service — SSOT do módulo Locais/Comércios. Espelha event-service.ts.
 *
 * Locais reusam horário (attractions.opening_hours + is_poi_open_now),
 * acessibilidade e contato de attractions; place_details guarda só o específico
 * de comércio (place_type/cuisine/price_range/reserva/menu/amenities/tags).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
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

  async getDetails(id: string) {
    const { data, error } = await client().schema('core').rpc('get_place_details', { p_place_id: id })
    if (error) throw new Error(error.message)
    return (data?.[0] as any) || null
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
