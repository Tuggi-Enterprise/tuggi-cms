/**
 * Event Service — SSOT das operações do módulo Eventos.
 *
 * Espelha o padrão de lib/core/poi-service.ts (getSupabase + .schema('core').rpc),
 * mas enxuto: eventos reusam os satélites de attractions (coordenada, boundary,
 * trigger points, descrições/áudio) via attraction_id. Só o que é específico de
 * evento (calendário, ingressos, etc.) vive em core.event_details e nas RPCs
 * cms_list_events / cms_event_facets / get_event_details / cms_create_event.
 */
import { getSupabase } from './supabase-client'

export interface EventListItem {
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
  starts_at: string | null
  ends_at: string | null
  timezone: string | null
  all_day: boolean
  status: string
  event_category: string | null
  tags: string[]
  is_free: boolean
  price_min: number | null
  price_max: number | null
  description_count: number
  trigger_point_count: number
}

export interface EventFilters {
  search?: string
  status?: 'all' | 'approved' | 'pending'
  country?: string | null
  state?: string | null
  city?: string | null
  eventStatus?: string
  time?: 'all' | 'upcoming' | 'past'
  startsAfter?: string | null
  startsBefore?: string | null
  page?: number
  pageSize?: number
}

export interface EventFacets {
  total: number
  approved: number
  pending: number
  upcoming: number
  past: number
  withDescription: number
  withTriggerPoints: number
}

export interface CreateEventInput {
  name: string
  city: string
  country: string
  state?: string | null
  latitude?: number | null
  longitude?: number | null
  starts_at: string
  ends_at?: string | null
  timezone?: string
  all_day?: boolean
}

function client() {
  return getSupabase(typeof window !== 'undefined' ? 'client' : 'server')
}

export const eventService = {
  async list(filters: EventFilters = {}): Promise<{ items: EventListItem[]; total: number }> {
    const page = filters.page ?? 1
    const pageSize = filters.pageSize ?? 50
    const { data, error } = await client()
      .schema('core')
      .rpc('cms_list_events', {
        search_term: filters.search || null,
        status_filter: filters.status || 'all',
        country_filter: filters.country || null,
        state_filter: filters.state || null,
        city_filter: filters.city || null,
        event_status_filter: filters.eventStatus || 'all',
        time_filter: filters.time || 'all',
        starts_after: filters.startsAfter || null,
        starts_before: filters.startsBefore || null,
        limit_count: pageSize,
        offset_count: (page - 1) * pageSize,
        fetch_all: false,
      })
    if (error) throw new Error(error.message)
    const rows = (data || []) as (EventListItem & { total_count: number })[]
    return { items: rows, total: rows.length > 0 ? Number(rows[0].total_count) : 0 }
  },

  async getFacets(filters: EventFilters = {}): Promise<EventFacets> {
    const { data, error } = await client()
      .schema('core')
      .rpc('cms_event_facets', {
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
      upcoming: Number(f.upcoming_count || 0),
      past: Number(f.past_count || 0),
      withDescription: Number(f.with_description_count || 0),
      withTriggerPoints: Number(f.with_trigger_points_count || 0),
    }
  },

  async getDetails(id: string) {
    const { data, error } = await client().schema('core').rpc('get_event_details', { p_event_id: id })
    if (error) throw new Error(error.message)
    return (data?.[0] as any) || null
  },

  async create(input: CreateEventInput): Promise<string> {
    const { data, error } = await client()
      .schema('core')
      .rpc('cms_create_event', {
        p_name: input.name,
        p_city: input.city,
        p_country: input.country,
        p_state: input.state ?? null,
        p_latitude: input.latitude ?? null,
        p_longitude: input.longitude ?? null,
        p_starts_at: input.starts_at,
        p_ends_at: input.ends_at ?? null,
        p_timezone: input.timezone ?? 'America/Sao_Paulo',
        p_all_day: input.all_day ?? false,
      })
    if (error) throw new Error(error.message)
    return data as string
  },

  /** Update event-specific fields (core.event_details). Attractions fields
   *  (name/city/etc.) update via the shared attractions path. */
  async updateDetails(attractionId: string, patch: Record<string, any>) {
    const { error } = await client()
      .schema('core')
      .from('event_details')
      .update(patch)
      .eq('attraction_id', attractionId)
    if (error) throw new Error(error.message)
  },

  /** Update the base attraction row (name, city, state, country, approved, ...). */
  async updateAttraction(attractionId: string, patch: Record<string, any>) {
    const { error } = await client().schema('core').from('attractions').update(patch).eq('id', attractionId)
    if (error) throw new Error(error.message)
  },

  /** Set/edit the event's coordinate (upsert in core.attraction_coordinate). */
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
