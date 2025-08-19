import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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

export interface VerificationSettings {
  scorer_weights: ScoreWeights;
  factuality_thresholds: FactualityThresholds;
  batch_size: number;
  escalate_threshold: number;
  cache_ttl_days: number;
}

export async function getVerificationSettings(): Promise<VerificationSettings> {
  try {
    const { data: settings, error } = await supabase
      .schema('core')
      .from('verify_settings')
      .select('key, value')
      .in('key', ['scorer_weights', 'factuality_thresholds', 'batch_size', 'escalate_threshold', 'cache_ttl_days']);
    
    if (error) {
      console.error('Error fetching verification settings:', error);
      return getDefaultSettings();
    }
    
    const settingsMap = new Map(settings?.map(s => [s.key, s.value]) || []);
    
    return {
      scorer_weights: settingsMap.get('scorer_weights') || getDefaultSettings().scorer_weights,
      factuality_thresholds: settingsMap.get('factuality_thresholds') || getDefaultSettings().factuality_thresholds,
      batch_size: parseInt(settingsMap.get('batch_size') || '20'),
      escalate_threshold: parseFloat(settingsMap.get('escalate_threshold') || '0.7'),
      cache_ttl_days: parseInt(settingsMap.get('cache_ttl_days') || '21')
    };
  } catch (error) {
    console.error('Error getting verification settings:', error);
    return getDefaultSettings();
  }
}

function getDefaultSettings(): VerificationSettings {
  return {
    scorer_weights: {
      factuality: 0.5,
      coherence: 0.0,
      tts_clarity: 0.2,
      rules: 0.3
    },
    factuality_thresholds: {
      approve: 90,
      review: 70
    },
    batch_size: 20,
    escalate_threshold: 0.7,
    cache_ttl_days: 21
  };
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

export async function computeVerificationScores(
  descriptionId: string,
  descriptionText: string,
  claims: any[],
  textEvaluation: any
): Promise<VerificationScores> {
  const settings = await getVerificationSettings();
  
  // Count claims by status
  const supportedClaims = claims.filter(c => c.status === 'supported').length;
  const contradictedClaims = claims.filter(c => c.status === 'contradicted').length;
  const notFoundClaims = claims.filter(c => c.status === 'not_found').length;
  const totalClaims = claims.length;
  
  // Calculate individual scores
  const factualityScore = calculateFactualityScore(supportedClaims, contradictedClaims, notFoundClaims);
  const coherenceScore = calculateCoherenceScore(textEvaluation, claims);
  const ttsClarityScore = textEvaluation.tts_clarity_score || 0.0;
  const rulesScore = textEvaluation.rules_score || 0.0;
  
  // Calculate overall score
  const overallScore = computeOverallScore(
    factualityScore,
    coherenceScore,
    ttsClarityScore,
    rulesScore,
    settings.scorer_weights
  );
  
  // Generate flags
  const flags: string[] = [];
  if (contradictedClaims > 0) flags.push('contradiction');
  if (textEvaluation.has_address_info) flags.push('mentions_address');
  if (textEvaluation.has_pricing_info) flags.push('mentions_pricing');
  if (textEvaluation.has_hours_info) flags.push('mentions_hours');
  if (textEvaluation.has_superlatives) flags.push('has_superlatives');
  if (!textEvaluation.starts_directionally) flags.push('not_directional');
  
  return {
    score_overall: Math.round(overallScore * 100),
    subscores: {
      rules: Math.round(rulesScore * 100),
      tts_clarity: Math.round(ttsClarityScore * 100),
      factuality: Math.round(factualityScore * 100),
      coherence: Math.round(coherenceScore * 100)
    },
    flags,
    confidence: overallScore
  };
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
