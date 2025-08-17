// Simplified version for Deno Edge Functions
export interface VerificationScores {
  score_overall: number;
  subscores: {
    factuality: number;
    coherence: number;
    tts_clarity: number;
    rules: number;
  };
  flags: string[];
  confidence?: number;
}

export interface FactualityThresholds {
  approve: number;
  review: number;
}

export interface ScorerWeights {
  factuality: number;
  coherence: number;
  tts_clarity: number;
  rules: number;
}

export interface VerificationSettings {
  scorer_weights: ScorerWeights;
  factuality_thresholds: FactualityThresholds;
}

const DEFAULT_WEIGHTS: ScorerWeights = {
  factuality: 0.5,
  coherence: 0.0,
  tts_clarity: 0.2,
  rules: 0.3
};

const DEFAULT_THRESHOLDS: FactualityThresholds = {
  approve: 90,
  review: 70
};

export async function getDefaultSettings(): Promise<VerificationSettings> {
  return {
    scorer_weights: DEFAULT_WEIGHTS,
    factuality_thresholds: DEFAULT_THRESHOLDS
  };
}

export async function computeVerificationScores(
  factualityScore: number,
  coherenceScore: number,
  ttsClarityScore: number,
  rulesScore: number,
  supportedClaims: number,
  contradictedClaims: number,
  totalClaims: number
): Promise<VerificationScores> {
  try {
    const settings = await getDefaultSettings();
    
    // Calculate weighted overall score (0-100)
    const overallScore = Math.round(
      (factualityScore * settings.scorer_weights.factuality +
       coherenceScore * settings.scorer_weights.coherence +
       ttsClarityScore * settings.scorer_weights.tts_clarity +
       rulesScore * settings.scorer_weights.rules) * 100
    );
    
    // Generate flags based on issues
    const flags: string[] = [];
    
    if (contradictedClaims > 0) {
      flags.push('contradiction');
    }
    
    if (factualityScore < 0.7) {
      flags.push('low_factuality');
    }
    
    if (rulesScore < 0.6) {
      flags.push('rule_violations');
    }
    
    if (ttsClarityScore < 0.7) {
      flags.push('tts_issues');
    }
    
    // Calculate confidence based on claim coverage
    const confidence = totalClaims > 0 ? (supportedClaims + contradictedClaims) / totalClaims : 0.5;
    
    return {
      score_overall: overallScore,
      subscores: {
        factuality: Math.round(factualityScore * 100),
        coherence: Math.round(coherenceScore * 100),
        tts_clarity: Math.round(ttsClarityScore * 100),
        rules: Math.round(rulesScore * 100)
      },
      flags,
      confidence
    };
  } catch (error) {
    console.error('Error computing verification scores:', error);
    
    // Return default scores on error
    return {
      score_overall: 50,
      subscores: {
        factuality: 50,
        coherence: 50,
        tts_clarity: 50,
        rules: 50
      },
      flags: ['computation_error'],
      confidence: 0.5
    };
  }
}

export async function determineVerificationStatus(
  factualityScore: number,
  flags: string[]
): Promise<'pending' | 'approved' | 'needs_review' | 'rejected'> {
  try {
    const settings = await getDefaultSettings();
    
    // Convert factuality score to percentage
    const factualityPercent = factualityScore * 100;
    
    // Check for contradictions first
    if (flags.includes('contradiction')) {
      return 'rejected';
    }
    
    // Apply thresholds
    if (factualityPercent >= settings.factuality_thresholds.approve) {
      return 'approved';
    } else if (factualityPercent >= settings.factuality_thresholds.review) {
      return 'needs_review';
    } else {
      return 'rejected';
    }
  } catch (error) {
    console.error('Error determining verification status:', error);
    return 'needs_review';
  }
}

export function validateVerificationScores(scores: VerificationScores): boolean {
  return (
    typeof scores.score_overall === 'number' &&
    scores.score_overall >= 0 &&
    scores.score_overall <= 100 &&
    typeof scores.subscores === 'object' &&
    typeof scores.subscores.factuality === 'number' &&
    scores.subscores.factuality >= 0 &&
    scores.subscores.factuality <= 100 &&
    typeof scores.subscores.coherence === 'number' &&
    scores.subscores.coherence >= 0 &&
    scores.subscores.coherence <= 100 &&
    typeof scores.subscores.tts_clarity === 'number' &&
    scores.subscores.tts_clarity >= 0 &&
    scores.subscores.tts_clarity <= 100 &&
    typeof scores.subscores.rules === 'number' &&
    scores.subscores.rules >= 0 &&
    scores.subscores.rules <= 100 &&
    Array.isArray(scores.flags) &&
    (scores.confidence === undefined || (typeof scores.confidence === 'number' && scores.confidence >= 0 && scores.confidence <= 1))
  );
}
