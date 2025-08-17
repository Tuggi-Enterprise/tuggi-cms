// Simplified version for Deno Edge Functions
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
  escalated: boolean;
}

const CHECK_CLAIM_PROMPT = `
Você é um especialista em verificar afirmações factuais contra evidências.

Afirmação a verificar: "{claim}"

Contexto disponível:
{context}

Tarefa: Determine se a afirmação é suportada, contradita ou não encontrada no contexto fornecido.

Critérios:
- SUPPORTED: A afirmação é claramente confirmada pelo contexto
- CONTRADICTED: O contexto contradiz diretamente a afirmação
- NOT_FOUND: Não há informações suficientes para confirmar ou contradizer

Responda APENAS em JSON válido com esta estrutura exata:
{
  "status": "supported|contradicted|not_found",
  "confidence": 0.95,
  "reasoning": "explicação breve da decisão"
}

IMPORTANTE:
- Seja conservador: só marque como "supported" se houver evidência clara
- Seja preciso: "contradicted" só quando há contradição direta
- Use "not_found" quando não há informações suficientes
- Confidence deve refletir a certeza da decisão (0-1)
`;

export async function checkClaimWithEscalation(
  claim: string,
  context: string,
  escalateThreshold: number = 0.7
): Promise<ClaimCheckResult> {
  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    // First attempt with Gemini Flash
    const result = await checkClaimWithModel(claim, context, 'gemini-1.5-flash', apiKey);
    
    // Escalate to Gemini Pro if confidence is low
    if (result.confidence < escalateThreshold) {
      console.log(`Escalating claim "${claim}" to Gemini Pro (confidence: ${result.confidence})`);
      const escalatedResult = await checkClaimWithModel(claim, context, 'gemini-1.5-pro', apiKey);
      escalatedResult.escalated = true;
      return escalatedResult;
    }
    
    result.escalated = false;
    return result;
  } catch (error) {
    console.error('Error checking claim:', error);
    return {
      status: 'not_found',
      confidence: 0.0,
      evidence: [],
      escalated: false
    };
  }
}

async function checkClaimWithModel(
  claim: string,
  context: string,
  model: string,
  apiKey: string
): Promise<ClaimCheckResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  const prompt = CHECK_CLAIM_PROMPT
    .replace('{claim}', claim)
    .replace('{context}', context);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: prompt
        }]
      }]
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.candidates[0].content.parts[0].text;
  
  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in response');
  }
  
  const parsed = JSON.parse(jsonMatch[0]);
  
  // Validate response
  if (!['supported', 'contradicted', 'not_found'].includes(parsed.status)) {
    throw new Error('Invalid status in response');
  }
  
  if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
    throw new Error('Invalid confidence in response');
  }
  
  return {
    status: parsed.status,
    confidence: parsed.confidence,
    evidence: [], // Evidence will be added separately
    escalated: false
  };
}

export function validateClaimCheckResult(result: ClaimCheckResult): boolean {
  return (
    ['supported', 'contradicted', 'not_found'].includes(result.status) &&
    typeof result.confidence === 'number' &&
    result.confidence >= 0 &&
    result.confidence <= 1 &&
    Array.isArray(result.evidence) &&
    typeof result.escalated === 'boolean'
  );
}
