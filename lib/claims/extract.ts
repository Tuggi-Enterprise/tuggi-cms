import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export interface Claim {
  text: string;
  type: 'year' | 'person' | 'event' | 'restoration' | 'location' | 'other';
  confidence: number;
}

export interface ExtractClaimsResult {
  claims: Claim[];
  total_claims: number;
}

const EXTRACT_CLAIMS_PROMPT = `
Você é um especialista em extrair afirmações factuais de textos sobre pontos turísticos e atrações.

Analise o texto fornecido e extraia TODAS as afirmações factuais verificáveis. Foque em:
- Anos/datas específicas
- Nomes de pessoas (fundadores, arquitetos, artistas, etc.)
- Eventos históricos
- Restaurações/reformas
- Localizações específicas
- Outras afirmações factuais verificáveis

IMPORTANTE:
- NÃO invente informações
- Extraia APENAS afirmações que estão explicitamente no texto
- Seja preciso e literal
- Não inclua opiniões ou julgamentos subjetivos

Responda APENAS em JSON válido com esta estrutura exata:
{
  "claims": [
    {
      "text": "afirmação literal do texto",
      "type": "year|person|event|restoration|location|other",
      "confidence": 0.95
    }
  ],
  "total_claims": 5
}

Texto para análise:
`;

export async function extractClaims(description: string): Promise<ExtractClaimsResult> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
    
    const prompt = `${EXTRACT_CLAIMS_PROMPT}\n\n"${description}"`;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    
    const parsed = JSON.parse(jsonMatch[0]) as ExtractClaimsResult;
    
    // Validate structure
    if (!parsed.claims || !Array.isArray(parsed.claims)) {
      throw new Error('Invalid claims structure in response');
    }
    
    // Validate each claim
    parsed.claims.forEach((claim, index) => {
      if (!claim.text || typeof claim.text !== 'string') {
        throw new Error(`Invalid claim text at index ${index}`);
      }
      if (!claim.type || !['year', 'person', 'event', 'restoration', 'location', 'other'].includes(claim.type)) {
        throw new Error(`Invalid claim type at index ${index}`);
      }
      if (typeof claim.confidence !== 'number' || claim.confidence < 0 || claim.confidence > 1) {
        throw new Error(`Invalid confidence at index ${index}`);
      }
    });
    
    parsed.total_claims = parsed.claims.length;
    
    return parsed;
  } catch (error) {
    console.error('Error extracting claims:', error);
    
    // Return empty result on error
    return {
      claims: [],
      total_claims: 0
    };
  }
}

export function validateClaim(claim: Claim): boolean {
  return (
    typeof claim.text === 'string' &&
    claim.text.length > 0 &&
    ['year', 'person', 'event', 'restoration', 'location', 'other'].includes(claim.type) &&
    typeof claim.confidence === 'number' &&
    claim.confidence >= 0 &&
    claim.confidence <= 1
  );
}
