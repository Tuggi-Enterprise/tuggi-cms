export interface TextEvaluationResult {
  rules_score: number;
  tts_clarity_score: number;
  word_count: number;
  sentence_count: number;
  has_superlatives: boolean;
  has_address_info: boolean;
  has_pricing_info: boolean;
  has_hours_info: boolean;
  starts_directionally: boolean;
  issues: string[];
}

export interface TextRules {
  max_words: number;
  min_sentences: number;
  max_sentences: number;
  allow_superlatives: boolean;
  allow_address: boolean;
  allow_pricing: boolean;
  allow_hours: boolean;
  require_directional_start: boolean;
}

const DEFAULT_RULES: TextRules = {
  max_words: 200,
  min_sentences: 2,
  max_sentences: 5,
  allow_superlatives: false,
  allow_address: false,
  allow_pricing: false,
  allow_hours: false,
  require_directional_start: true
};

// Portuguese superlatives and intensifiers
const SUPERLATIVES = [
  'mais', 'menos', 'melhor', 'pior', 'maior', 'menor',
  'mais bonito', 'mais feio', 'mais alto', 'mais baixo',
  'mais antigo', 'mais novo', 'mais famoso', 'mais importante',
  'mais conhecido', 'mais visitado', 'mais popular',
  'extremamente', 'incrivelmente', 'absolutamente', 'totalmente',
  'completamente', 'perfeitamente', 'excepcionalmente'
];

// Address patterns
const ADDRESS_PATTERNS = [
  /\b(rua|avenida|av\.|alameda|praça|travessa|vila|bairro|centro)\b/gi,
  /\b(cep|cep:)\s*\d{5}-?\d{3}/gi,
  /\b(telefone|tel\.|fone|phone)\s*:?\s*\d/gi
];

// Pricing patterns
const PRICING_PATTERNS = [
  /\b(grátis|gratuito|free|entrada livre)\b/gi,
  /\b(r\$\s*\d+)/gi,
  /\b(\d+\s*reais?)/gi,
  /\b(preço|valor|custo|ingresso|ticket)\s*:?\s*r?\$?\s*\d/gi
];

// Hours patterns
const HOURS_PATTERNS = [
  /\b(segunda|terça|quarta|quinta|sexta|sábado|domingo)\b/gi,
  /\b(\d{1,2}h\s*às?\s*\d{1,2}h)/gi,
  /\b(aberto|fechado|funcionamento)\b/gi,
  /\b(horário|horários)\s*:?\s*\d/gi
];

// Directional start patterns
const DIRECTIONAL_STARTS = [
  /^aqui\b/i,
  /^neste\b/i,
  /^nesta\b/i,
  /^neste\s+lugar\b/i,
  /^você\s+está\b/i,
  /^você\s+se\s+encontra\b/i,
  /^diante\s+de\s+você\b/i,
  /^à\s+sua\s+frente\b/i,
  /^ao\s+seu\s+lado\b/i,
  /^próximo\s+a\s+você\b/i
];

export function countWords(text: string): number {
  if (!text || typeof text !== 'string') return 0;
  
  // Remove extra whitespace and split by spaces
  const words = text.trim().split(/\s+/);
  
  // Filter out empty strings
  return words.filter(word => word.length > 0).length;
}

export function countSentences(text: string): number {
  if (!text || typeof text !== 'string') return 0;
  
  // Split by sentence endings (., !, ?) and filter empty
  const sentences = text.split(/[.!?]+/).filter(sentence => 
    sentence.trim().length > 0
  );
  
  return sentences.length;
}

export function hasSuperlatives(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  
  const lowerText = text.toLowerCase();
  return SUPERLATIVES.some(superlative => 
    lowerText.includes(superlative.toLowerCase())
  );
}

export function hasAddressInfo(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  
  return ADDRESS_PATTERNS.some(pattern => pattern.test(text));
}

export function hasPricingInfo(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  
  return PRICING_PATTERNS.some(pattern => pattern.test(text));
}

export function hasHoursInfo(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  
  return HOURS_PATTERNS.some(pattern => pattern.test(text));
}

export function startsDirectionally(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  
  return DIRECTIONAL_STARTS.some(pattern => pattern.test(text));
}

export function evaluateText(text: string, rules: Partial<TextRules> = {}): TextEvaluationResult {
  const finalRules = { ...DEFAULT_RULES, ...rules };
  const issues: string[] = [];
  
  // Basic counts
  const wordCount = countWords(text);
  const sentenceCount = countSentences(text);
  
  // Check word count
  if (wordCount > finalRules.max_words) {
    issues.push(`Texto muito longo: ${wordCount} palavras (máximo: ${finalRules.max_words})`);
  }
  
  // Check sentence count
  if (sentenceCount < finalRules.min_sentences) {
    issues.push(`Poucas frases: ${sentenceCount} (mínimo: ${finalRules.min_sentences})`);
  }
  
  if (sentenceCount > finalRules.max_sentences) {
    issues.push(`Muitas frases: ${sentenceCount} (máximo: ${finalRules.max_sentences})`);
  }
  
  // Check content restrictions
  const hasSuperlativesFlag = hasSuperlatives(text);
  const hasAddressFlag = hasAddressInfo(text);
  const hasPricingFlag = hasPricingInfo(text);
  const hasHoursFlag = hasHoursInfo(text);
  const startsDirectionallyFlag = startsDirectionally(text);
  
  if (!finalRules.allow_superlatives && hasSuperlativesFlag) {
    issues.push('Contém superlativos ou intensificadores');
  }
  
  if (!finalRules.allow_address && hasAddressFlag) {
    issues.push('Contém informações de endereço');
  }
  
  if (!finalRules.allow_pricing && hasPricingFlag) {
    issues.push('Contém informações de preço');
  }
  
  if (!finalRules.allow_hours && hasHoursFlag) {
    issues.push('Contém informações de horário');
  }
  
  if (finalRules.require_directional_start && !startsDirectionallyFlag) {
    issues.push('Não inicia com linguagem direcional');
  }
  
  // Calculate scores
  const rulesScore = calculateRulesScore(issues, finalRules);
  const ttsClarityScore = calculateTTSClarityScore(text, wordCount, sentenceCount);
  
  return {
    rules_score: rulesScore,
    tts_clarity_score: ttsClarityScore,
    word_count: wordCount,
    sentence_count: sentenceCount,
    has_superlatives: hasSuperlativesFlag,
    has_address_info: hasAddressFlag,
    has_pricing_info: hasPricingFlag,
    has_hours_info: hasHoursFlag,
    starts_directionally: startsDirectionallyFlag,
    issues
  };
}

function calculateRulesScore(issues: string[], rules: TextRules): number {
  if (issues.length === 0) return 1.0;
  
  // Weight different types of issues
  const criticalIssues = issues.filter(issue => 
    issue.includes('muito longo') || 
    issue.includes('Poucas frases') || 
    issue.includes('Muitas frases')
  );
  
  const contentIssues = issues.filter(issue => 
    issue.includes('superlativos') ||
    issue.includes('endereço') ||
    issue.includes('preço') ||
    issue.includes('horário')
  );
  
  const directionalIssues = issues.filter(issue => 
    issue.includes('direcional')
  );
  
  // Calculate penalty
  const criticalPenalty = criticalIssues.length * 0.3;
  const contentPenalty = contentIssues.length * 0.15;
  const directionalPenalty = directionalIssues.length * 0.1;
  
  const totalPenalty = Math.min(criticalPenalty + contentPenalty + directionalPenalty, 1.0);
  
  return Math.max(0.0, 1.0 - totalPenalty);
}

function calculateTTSClarityScore(text: string, wordCount: number, sentenceCount: number): number {
  if (!text || wordCount === 0 || sentenceCount === 0) return 0.0;
  
  let score = 1.0;
  
  // Penalize very short or very long texts
  if (wordCount < 20) score -= 0.2;
  if (wordCount > 150) score -= 0.1;
  
  // Penalize very short or very long sentences
  const avgWordsPerSentence = wordCount / sentenceCount;
  if (avgWordsPerSentence < 5) score -= 0.2;
  if (avgWordsPerSentence > 25) score -= 0.2;
  
  // Penalize for complex punctuation
  const complexPunctuation = (text.match(/[;:()]/g) || []).length;
  if (complexPunctuation > sentenceCount) score -= 0.1;
  
  // Penalize for numbers (harder to pronounce naturally)
  const numbers = (text.match(/\d+/g) || []).length;
  if (numbers > 3) score -= 0.1;
  
  // Bonus for good sentence variety
  if (sentenceCount >= 3 && sentenceCount <= 5) score += 0.1;
  
  return Math.max(0.0, Math.min(1.0, score));
}

export function validateTextEvaluationResult(result: TextEvaluationResult): boolean {
  return (
    typeof result.rules_score === 'number' &&
    result.rules_score >= 0 &&
    result.rules_score <= 1 &&
    typeof result.tts_clarity_score === 'number' &&
    result.tts_clarity_score >= 0 &&
    result.tts_clarity_score <= 1 &&
    typeof result.word_count === 'number' &&
    result.word_count >= 0 &&
    typeof result.sentence_count === 'number' &&
    result.sentence_count >= 0 &&
    Array.isArray(result.issues)
  );
}
