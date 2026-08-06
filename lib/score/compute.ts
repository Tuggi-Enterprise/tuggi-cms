/**
 * Scoring helpers for description quality.
 *
 * SEC-37 removed `getVerificationSettings()` and `computeVerificationScores()` from
 * this module. They read `core.verify_settings` through `getSupabase('server')` —
 * the publishable key with no session, i.e. `anon` — and this file is imported by
 * browser components, so that client shipped in the bundle. Neither function had a
 * caller: the fact-checking feature they belonged to was replaced by Google
 * grounding (`docs/cleanup-verification-feature-removal.md`). What is used here is
 * `getScoreDescription`, `getScoreColor` and `getScoreBackgroundColor`.
 */

export interface ScoreWeights {
  factuality: number;
  coherence: number;
  tts_clarity: number;
  rules: number;
}

export interface FactualityThresholds {
  approve: number;
  review: number;
}

export interface VerificationScores {
  score_overall: number;
  subscores: {
    rules: number;
    tts_clarity: number;
    factuality: number;
    coherence: number;
  };
  flags: string[];
  confidence?: number;
}

export function calculateFactualityScore(
  supportedClaims: number,
  contradictedClaims: number,
  notFoundClaims: number
): number {
  const totalClaims = supportedClaims + contradictedClaims + notFoundClaims;
  
  if (totalClaims === 0) {
    return 1.0; // No claims to verify, assume factual
  }
  
  // Calculate weighted score
  const supportedWeight = 1.0;
  const contradictedWeight = -1.0;
  const notFoundWeight = 0.0; // Neutral weight for not found
  
  const weightedScore = (
    (supportedClaims * supportedWeight) +
    (contradictedClaims * contradictedWeight) +
    (notFoundClaims * notFoundWeight)
  ) / totalClaims;
  
  // Normalize to 0-1 range
  return Math.max(0.0, Math.min(1.0, (weightedScore + 1) / 2));
}

export function calculateCoherenceScore(
  textEvaluation: any,
  claims: any[]
): number {
  let score = 1.0;
  
  // Penalize for too many issues in text evaluation
  if (textEvaluation.issues && textEvaluation.issues.length > 0) {
    score -= textEvaluation.issues.length * 0.1;
  }
  
  // Penalize for claims that are too similar (potential redundancy)
  const claimTexts = claims.map(c => c.text.toLowerCase());
  const uniqueClaims = new Set(claimTexts);
  const redundancyPenalty = (claimTexts.length - uniqueClaims.size) * 0.1;
  score -= redundancyPenalty;
  
  // Bonus for good sentence structure
  if (textEvaluation.sentence_count >= 2 && textEvaluation.sentence_count <= 5) {
    score += 0.1;
  }
  
  return Math.max(0.0, Math.min(1.0, score));
}

export function computeOverallScore(
  factualityScore: number,
  coherenceScore: number,
  ttsClarityScore: number,
  rulesScore: number,
  weights: ScoreWeights
): number {
  const weightedSum = (
    factualityScore * weights.factuality +
    coherenceScore * weights.coherence +
    ttsClarityScore * weights.tts_clarity +
    rulesScore * weights.rules
  );
  
  return Math.max(0.0, Math.min(1.0, weightedSum));
}

export function determineVerificationStatus(
  overallScore: number,
  factualityScore: number,
  thresholds: FactualityThresholds
): 'pending' | 'approved' | 'needs_review' | 'rejected' {
  // If factuality is poor, reject
  if (factualityScore < thresholds.review) {
    return 'rejected';
  }
  
  // If overall score is excellent and factuality is good, approve
  if (overallScore >= thresholds.approve && factualityScore >= thresholds.approve) {
    return 'approved';
  }
  
  // If factuality is acceptable or better, needs review
  if (factualityScore >= thresholds.review) {
    return 'needs_review';
  }
  
  // Otherwise, reject
  return 'rejected';
}

export function validateVerificationScores(scores: VerificationScores): boolean {
  return (
    typeof scores.score_overall === 'number' &&
    scores.score_overall >= 0 &&
    scores.score_overall <= 100 &&
    typeof scores.subscores?.factuality === 'number' &&
    scores.subscores.factuality >= 0 &&
    scores.subscores.factuality <= 100 &&
    typeof scores.subscores?.coherence === 'number' &&
    scores.subscores.coherence >= 0 &&
    scores.subscores.coherence <= 100 &&
    typeof scores.subscores?.tts_clarity === 'number' &&
    scores.subscores.tts_clarity >= 0 &&
    scores.subscores.tts_clarity <= 100 &&
    typeof scores.subscores?.rules === 'number' &&
    scores.subscores.rules >= 0 &&
    scores.subscores.rules <= 100 &&
    Array.isArray(scores.flags)
  );
}

export function getScoreDescription(score: number): string {
  if (score >= 0.9) return 'Excelente';
  if (score >= 0.7) return 'Bom';
  if (score >= 0.5) return 'Aceitável';
  if (score >= 0.3) return 'Ruim';
  return 'Muito Ruim';
}

export function getScoreColor(score: number): string {
  if (score >= 0.7) return 'text-green-600';
  if (score >= 0.5) return 'text-yellow-600';
  return 'text-red-600';
}

export function getScoreBackgroundColor(score: number): string {
  if (score >= 0.7) return 'bg-green-100';
  if (score >= 0.5) return 'bg-yellow-100';
  return 'bg-red-100';
}
