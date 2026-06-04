/**
 * POI description verification data access (core.v_descriptions_with_last_score
 * + core.description_scores with embedded description_claims).
 *
 * Returns raw rows; the caller interprets score/dates/claims so the UI logic
 * stays where it is during the incremental refactor.
 */

type SupabaseLike = any

export interface VerificationRaw {
  descData: any | null
  scoresData: any | null
}

/**
 * Fetch the latest scored description for a POI/language and its score row
 * (with claims). Either field may be null when nothing exists yet.
 */
export async function fetchVerificationRaw(
  supabase: SupabaseLike,
  poiId: string,
  language: string,
): Promise<VerificationRaw> {
  const { data: descData, error: descError } = await supabase
    .schema('core')
    .from('v_descriptions_with_last_score')
    .select('*')
    .eq('attraction_id', poiId)
    .ilike('language', language) // case-insensitive
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (descError) throw descError
  if (!descData) return { descData: null, scoresData: null }

  const { data: scoresData, error: scoresError } = await supabase
    .schema('core')
    .from('description_scores')
    .select(`
      id,
      description_id,
      attraction_id,
      score_overall,
      subscores,
      flags,
      confidence,
      created_at,
      description_claims (
        id,
        value,
        claim_type,
        status,
        weight
      )
    `)
    .eq('description_id', descData.description_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (scoresError) throw scoresError
  return { descData, scoresData: scoresData ?? null }
}
