/**
 * POI write operations (save / approve / toggle-active / delete / garbage).
 *
 * Single source of truth for the homolog-vs-core branching that was previously
 * duplicated across five handlers in POIDetailsModal. Homolog POIs (rows carrying
 * `_homologData`, from `homolog.pois`) go through API routes; regular POIs hit
 * `core.attractions` directly via the authenticated Supabase client.
 *
 * Pure functions: they take the Supabase client so auth context is the caller's.
 * UI side-effects (feedback, cache invalidation, optimistic updates) stay in the
 * caller — see lib/hooks/usePoiMutations.ts for the bound hook surface.
 */

// The app uses an untyped client (useSupabaseClient<any>()); keep it permissive.
type SupabaseLike = any

export function isHomologPoi(poi: any): boolean {
  return !!poi?._homologData
}

async function putHomolog(id: string, updates: Record<string, unknown>): Promise<void> {
  const response = await fetch('/api/supabase/pois/update', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, updates }),
  })
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || 'Update failed')
  }
}

async function deleteHomolog(ids: string[]): Promise<void> {
  const response = await fetch('/api/supabase/pois/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || 'Delete failed')
  }
}

/** Persist edits to a POI's core fields. */
export async function savePoiChanges(
  supabase: SupabaseLike,
  poi: any,
  editedPoi: any,
  referenceLinks: string[],
): Promise<void> {
  if (isHomologPoi(poi)) {
    // homolog.pois keeps both `category` and `primary_category` in sync.
    const updates: Record<string, unknown> = {
      name: editedPoi.name,
      city: editedPoi.city,
      country: editedPoi.country,
      state: editedPoi.state,
      updated_at: new Date().toISOString(),
    }
    if (editedPoi.category) {
      updates.category = editedPoi.category
      updates.primary_category = editedPoi.category
    } else if (poi?._homologData?.primary_category) {
      updates.primary_category = poi._homologData.primary_category
    }
    await putHomolog(poi.id, updates)
    return
  }

  const { error } = await supabase
    .schema('core')
    .from('attractions')
    .update({
      name: editedPoi.name,
      // category is the 'record type' (point_of_interest / geofence)
      category: editedPoi.record_type === 'geofence' ? 'geofence' : 'point_of_interest',
      // osm_category is the specific category (museum, restaurant, or 'geofence')
      osm_category: editedPoi.category,
      // primary_category kept for backward compatibility with search filters
      primary_category: editedPoi.record_type === 'geofence' ? 'geofence' : (editedPoi.category || 'point_of_interest'),
      city: editedPoi.city,
      state: editedPoi.state,
      country: editedPoi.country,
      updated_at: new Date().toISOString(),
      reference_links: referenceLinks.filter((link) => !!link.trim()),
      owner_id: editedPoi.owner_id || null,
      business_status: editedPoi.business_status || null,
    })
    .eq('id', poi.id)
  if (error) throw error
}

/** Approve a POI. */
export async function approvePoi(supabase: SupabaseLike, poi: any, userId?: string | null): Promise<void> {
  if (isHomologPoi(poi)) {
    // homolog.pois only has the boolean `approved` column.
    await putHomolog(poi.id, { approved: true })
    return
  }
  const { error } = await supabase
    .schema('core')
    .from('attractions')
    .update({
      approved: true,
      approved_by: userId ?? null,
      approved_at: new Date().toISOString(),
    })
    .eq('id', poi.id)
  if (error) throw error
}

/** Toggle a core POI's active flag (homolog POIs have no is_active). */
export async function setPoiActive(supabase: SupabaseLike, poiId: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .schema('core')
    .from('attractions')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', poiId)
  if (error) throw error
}

/** Hard-delete a POI. */
export async function deletePoi(supabase: SupabaseLike, poi: any): Promise<void> {
  if (isHomologPoi(poi)) {
    await deleteHomolog([poi.id])
    return
  }
  const { error } = await supabase
    .schema('core')
    .from('attractions')
    .delete()
    .eq('id', poi.id)
  if (error) throw error
}

/** Mark a POI as garbage (excluded from re-import). */
export async function garbagePoi(supabase: SupabaseLike, poi: any): Promise<void> {
  if (isHomologPoi(poi)) {
    await deleteHomolog([poi.id])
    return
  }
  const response = await fetch(`/api/pois/${poi.id}/garbage`, { method: 'POST' })
  if (!response.ok) throw new Error('Failed to mark core POI as garbage')
}
