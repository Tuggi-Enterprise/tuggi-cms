/**
 * POI description data access (core.attraction_descriptions).
 * Single source of truth for the Portuguese upsert that was previously
 * duplicated across saveDescription and saveDescriptionAndNextStep.
 *
 * Pure functions taking the authenticated Supabase client; UI side-effects
 * (feedback, local state, verification refresh) stay in the caller.
 */

type SupabaseLike = any

/**
 * Every column of `core.attraction_descriptions` the CMS reads with the operator's session, which
 * is all of them except `generated_by_*`. Those say which person triggered a generation, next to
 * a POI and a timestamp: a trail of where a tourist was (#1014). No screen shows them, and the
 * column grant that takes them away from `anon` and `authenticated` turns a `select('*')` into a
 * 42501, so readers of this table list columns from here instead.
 */
export const DESCRIPTION_COLUMNS = [
  'id',
  'attraction_id',
  'group_id',
  'language',
  'gender',
  'name',
  'description',
  'base_narrative_text',
  'description_hash',
  'is_original',
  'audio_url',
  'play_count',
  'last_played_at',
  'verification_status',
  'last_score_overall',
  'last_score_version',
  'last_verified_at',
  'facts_pack_json',
  'facts_version',
  'grounded',
  'generation_kind',
  'generation_meta',
  'llm_model',
  'input_tokens',
  'output_tokens',
  'created_at',
  'updated_at',
].join(', ')

/** Fetch all descriptions for a POI (and its group, if any). */
export async function fetchDescriptions(
  supabase: SupabaseLike,
  poiId: string,
  groupId?: string,
): Promise<any[]> {
  const { data } = await supabase
    .schema('core')
    .from('attraction_descriptions')
    .select(DESCRIPTION_COLUMNS)
    .or(`attraction_id.eq.${poiId},group_id.in.(${groupId || ''})`)
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false })
  return data || []
}

export interface UpsertDescriptionResult {
  /** True when an existing pt-br description's text actually changed. */
  changed: boolean
}

/**
 * Insert or update the Brazilian Portuguese (pt-br) description for a POI.
 * Returns whether an existing description's text changed (used to offer audio
 * regeneration). New inserts report `changed: false`.
 */
export async function upsertPortugueseDescription(
  supabase: SupabaseLike,
  poiId: string,
  description: string,
): Promise<UpsertDescriptionResult> {
  const { data: existing } = await supabase
    .schema('core')
    .from('attraction_descriptions')
    .select('id, description')
    .eq('attraction_id', poiId)
    .eq('language', 'pt-br')
    .maybeSingle()

  if (existing) {
    const changed = existing.description !== description
    const { error } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .update({ description, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (error) throw error
    return { changed }
  }

  const { error } = await supabase
    .schema('core')
    .from('attraction_descriptions')
    .insert({ attraction_id: poiId, language: 'pt-br', description, play_count: 0 })
  if (error) throw error
  return { changed: false }
}

/**
 * Insert or update the translated POI NAME for a given language.
 * The name is gender-independent, so it is written to EVERY description row
 * for (attraction_id, language). When no description row exists yet for that
 * language, a minimal row is created carrying just the name (description is
 * filled later by generation). Returns the number of rows touched.
 */
export async function upsertPoiName(
  supabase: SupabaseLike,
  poiId: string,
  language: string,
  name: string,
): Promise<number> {
  const { data: rows, error: fetchErr } = await supabase
    .schema('core')
    .from('attraction_descriptions')
    .select('id')
    .eq('attraction_id', poiId)
    .eq('language', language)
  if (fetchErr) throw fetchErr

  if (rows && rows.length > 0) {
    const { error } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('attraction_id', poiId)
      .eq('language', language)
    if (error) throw error
    return rows.length
  }

  const { error } = await supabase
    .schema('core')
    .from('attraction_descriptions')
    .insert({ attraction_id: poiId, language, name, play_count: 0 })
  if (error) throw error
  return 1
}

/** Delete a description record by id (e.g. removing a translation). */
export async function deleteDescription(supabase: SupabaseLike, id: string): Promise<void> {
  const { error } = await supabase
    .schema('core')
    .from('attraction_descriptions')
    .delete()
    .eq('id', id)
  if (error) throw error
}
