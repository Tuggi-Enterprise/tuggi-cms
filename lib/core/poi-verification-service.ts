/**
 * POI description verification data access — DESCONTINUADO.
 *
 * A feature de verificação/claims foi substituída pelo Google grounding e as
 * tabelas (core.description_scores / description_claims) foram removidas. Esta
 * função vira um stub inerte para não quebrar os callers (POIDetailsModal) —
 * retorna sempre vazio. Remover junto com a UI numa limpeza futura.
 * Ver docs/cleanup-verification-feature-removal.md
 */

type SupabaseLike = any

export interface VerificationRaw {
  descData: any | null
  scoresData: any | null
}

export async function fetchVerificationRaw(
  _supabase: SupabaseLike,
  _poiId: string,
  _language: string,
): Promise<VerificationRaw> {
  // Verificação descontinuada — sem dados.
  return { descData: null, scoresData: null }
}
