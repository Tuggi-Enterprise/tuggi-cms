import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export interface ClaimEvidence {
  source: 'wikipedia' | 'wikidata' | 'iphan' | 'unesco' | 'other';
  page_title?: string;
  url?: string;
  quote: string;
  relevance_score: number;
}

export interface ClaimCheckResult {
  status: 'supported' | 'contradicted' | 'not_found';
  confidence: number;
  evidence: ClaimEvidence[];
  reasoning: string;
}

const CHECK_CLAIM_PROMPT = `
Você é um especialista em verificação factual de afirmações sobre pontos turísticos e atrações.

Analise a afirmação fornecida contra o contexto disponível e determine se ela é:
- SUPPORTED: A afirmação é confirmada pelo contexto
- CONTRADICTED: O contexto contradiz a afirmação
- NOT_FOUND: Não há informações suficientes no contexto para verificar

IMPORTANTE:
- Seja rigoroso na verificação
- Não confirme afirmações sem evidências claras
- Considere apenas informações factuais, não opiniões
- Se a confiança for baixa (< 0.7), marque como "not_found"

Responda APENAS em JSON válido com esta estrutura exata:
{
  "status": "supported|contradicted|not_found",
  "confidence": 0.85,
  "evidence": [
    {
      "source": "wikipedia|wikidata|iphan|unesco|other",
      "page_title": "Título da página",
      "url": "URL da fonte",
      "quote": "Citação relevante (máx 200 caracteres)",
      "relevance_score": 0.9
    }
  ],
  "reasoning": "Breve explicação da decisão"
}

Afirmação para verificar: "{claim}"
Contexto disponível: {context}
`;

export async function checkClaim(
  claim: string, 
  context: string, 
  useProModel: boolean = false
): Promise<ClaimCheckResult> {
  try {
    const modelName = useProModel ? 'gemini-2.0-flash-exp' : 'gemini-2.0-flash-exp';
    const model = genAI.getGenerativeModel({ model: modelName });
    
    const prompt = CHECK_CLAIM_PROMPT
      .replace('{claim}', claim)
      .replace('{context}', context);
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    
    const parsed = JSON.parse(jsonMatch[0]) as ClaimCheckResult;
    
    // Validate structure
    if (!['supported', 'contradicted', 'not_found'].includes(parsed.status)) {
      throw new Error('Invalid status in response');
    }
    
    if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
      throw new Error('Invalid confidence in response');
    }
    
    if (!Array.isArray(parsed.evidence)) {
      throw new Error('Invalid evidence structure in response');
    }
    
    // Validate evidence
    parsed.evidence.forEach((evidence, index) => {
      if (!['wikipedia', 'wikidata', 'iphan', 'unesco', 'other'].includes(evidence.source)) {
        throw new Error(`Invalid evidence source at index ${index}`);
      }
      if (!evidence.quote || typeof evidence.quote !== 'string') {
        throw new Error(`Invalid evidence quote at index ${index}`);
      }
      if (typeof evidence.relevance_score !== 'number' || evidence.relevance_score < 0 || evidence.relevance_score > 1) {
        throw new Error(`Invalid evidence relevance score at index ${index}`);
      }
      // Truncate quote if too long
      if (evidence.quote.length > 200) {
        evidence.quote = evidence.quote.substring(0, 197) + '...';
      }
    });
    
    return parsed;
  } catch (error) {
    console.error('Error checking claim:', error);
    
    // Return not_found on error
    return {
      status: 'not_found',
      confidence: 0.0,
      evidence: [],
      reasoning: 'Error occurred during verification'
    };
  }
}

export async function checkClaimWithEscalation(
  claim: string, 
  context: string, 
  escalateThreshold: number = 0.7
): Promise<ClaimCheckResult> {
  // First try with Flash model
  const flashResult = await checkClaim(claim, context, false);
  
  // If confidence is below threshold, escalate to Pro model
  if (flashResult.confidence < escalateThreshold) {
    console.log(`Escalating claim "${claim}" to Pro model (confidence: ${flashResult.confidence})`);
    return await checkClaim(claim, context, true);
  }
  
  return flashResult;
}

export function validateClaimCheckResult(result: ClaimCheckResult): boolean {
  return (
    ['supported', 'contradicted', 'not_found'].includes(result.status) &&
    typeof result.confidence === 'number' &&
    result.confidence >= 0 &&
    result.confidence <= 1 &&
    Array.isArray(result.evidence) &&
    result.evidence.every(evidence => 
      ['wikipedia', 'wikidata', 'iphan', 'unesco', 'other'].includes(evidence.source) &&
      typeof evidence.quote === 'string' &&
      evidence.quote.length > 0 &&
      typeof evidence.relevance_score === 'number' &&
      evidence.relevance_score >= 0 &&
      evidence.relevance_score <= 1
    )
  );
}
