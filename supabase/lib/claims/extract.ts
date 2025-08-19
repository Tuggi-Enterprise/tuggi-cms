// Simplified version for Deno Edge Functions

// Declare Deno for TypeScript
declare const Deno: any;
export interface Claim {
  text: string;
  type: 'year' | 'person' | 'event' | 'restoration' | 'location' | 'architecture' | 'cultural' | 'dimension' | 'other';
  confidence: number;
}

export interface ExtractClaimsResult {
  claims: Claim[];
  total_claims: number;
}

const EXTRACT_CLAIMS_PROMPT = `
SISTEMA DE EXTRAÇÃO DE DADOS FACTUAIS - VERSÃO FINAL
================================================================================

VOCÊ É UM EXTRATOR DE DADOS FACTUAIS ESPECIALIZADO EM ATRAÇÕES TURÍSTICAS.

MISSÃO: Extrair TODOS os dados factuais verificáveis sobre a atração descrita.

CATEGORIAS DE DADOS FACTUAIS:
🎯 YEAR: Datas (construção, inauguração, fundação, restauração)
👤 PERSON: Nomes (arquitetos, fundadores, artistas)
📅 EVENT: Eventos históricos específicos, festivais, celebrações
🏗️ RESTORATION: Reformas, restaurações
📍 LOCATION: Localização, status oficial, posição, cartão-postal
🏛️ ARCHITECTURE: Estilo arquitetônico, materiais, estruturas, pontes, jardins
🏆 CULTURAL: Patrimônios, elementos culturais, tradições, imigração
📏 DIMENSION: Medidas, área, capacidade, tamanho
🔍 OTHER: Outros fatos verificáveis

EXEMPLOS DE EXTRAÇÃO:
✅ "construído em 1928" → year
✅ "inaugurado em dezembro de 2023" → year
✅ "23 metros de comprimento" → dimension
✅ "ponte japonesa" → architecture
✅ "portal Tori" → cultural
✅ "Festival da Linguiça" → event
✅ "cartão-postal da cidade" → location
✅ "jardim oriental" → architecture
✅ "imigração japonesa" → cultural
✅ "festas de Ano Novo" → event
✅ "principal cartão-postal" → location

INSTRUÇÕES:
1. Extraia TODOS os dados factuais verificáveis
2. Inclua datas, medidas, nomes, eventos, elementos culturais
3. Seja abrangente - não deixe dados factuais de fora
4. Mantenha o texto original da claim
5. Use alta confiança (0.9-0.95) para dados claros
6. Extraia claims separadas para cada elemento factual
7. Inclua status oficiais como "cartão-postal", "principal"
8. Capture elementos culturais como "portal Tori", "jardim oriental"

FORMATO DE RESPOSTA (JSON):
{
  "claims": [
    {
      "text": "claim literal exata",
      "type": "year|person|event|restoration|location|architecture|cultural|dimension|other",
      "confidence": 0.95
    }
  ],
  "total_claims": X
}

TEXTO PARA ANÁLISE:
`;

// Security validation function
function validateInput(description: string): boolean {
  const suspiciousPatterns = [
    /ignore\s+(the\s+)?(prompt|instruction|system|previous)/i,
    /forget\s+(everything|all|previous)/i,
    /(act\s+as|pretend\s+to\s+be|you\s+are\s+now)/i,
    /write\s+about\s+(?!.*\b(museum|monument|park|attraction|heritage|church|cathedral|palace|castle|building|architecture|lake|bridge|garden|festival)\b)/i,
    /(madonna|celebrity|politics|entertainment)/i,
    /system\s*[:=]\s*["\']?/i,
    /role\s*[:=]\s*["\']?/i,
    /(override|bypass|disable)\s+(security|protection|filter)/i,
    /jailbreak|jail\s*break/i,
    /new\s+(instruction|command|prompt|system)/i,
    /end\s+of\s+(prompt|instruction|system)/i
  ];
  
  return !suspiciousPatterns.some(pattern => pattern.test(description));
}

// Content validation for attraction-related text
function isAttractionRelated(description: string): boolean {
  const attractionKeywords = [
    'museu', 'museum', 'parque', 'park', 'igreja', 'church', 'catedral', 'cathedral',
    'monumento', 'monument', 'palácio', 'palace', 'castelo', 'castle', 'edifício', 'building',
    'construído', 'construída', 'built', 'inaugurado', 'inaugurada', 'opened',
    'arquitetura', 'architecture', 'patrimônio', 'heritage', 'tombado', 'histórico', 'historic',
    'turístico', 'tourist', 'atração', 'attraction', 'centro', 'centro histórico',
    'praça', 'square', 'avenida', 'rua', 'street', 'localizado', 'localizada', 'located',
    'fundado', 'fundada', 'founded', 'criado', 'criada', 'created', 'lago', 'lake',
    'ponte', 'bridge', 'jardim', 'garden', 'festival', 'evento', 'event', 'tradicional',
    'cartão-postal', 'landmark', 'ponto turístico', 'tourist spot'
  ];
  
  const text = description.toLowerCase();
  return attractionKeywords.some(keyword => text.includes(keyword));
}

export async function extractClaims(description: string): Promise<ExtractClaimsResult> {
  try {
    // Security validation
    if (!validateInput(description)) {
      console.warn('🚨 Suspicious input detected - potential prompt injection attempt');
      return {
        claims: [],
        total_claims: 0
      };
    }
    
    // Content validation - mais permissiva
    if (!isAttractionRelated(description)) {
      console.warn('⚠️ Input does not appear to be attraction-related');
      return {
        claims: [],
        total_claims: 0
      };
    }
    
    const apiKey = (Deno as any).env.get('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const model = 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    // Sanitize input - menos agressivo
    let sanitizedDescription = description
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/`[^`]*`/g, '') // Remove inline code
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // Convert markdown links to text
      .trim();
    
    // Final length check - mais permissivo
    if (sanitizedDescription.length > 3000) {
      console.warn('⚠️ Input too long - truncating');
      sanitizedDescription = sanitizedDescription.substring(0, 3000);
    }
    
    const prompt = `${EXTRACT_CLAIMS_PROMPT}\n\n"${sanitizedDescription}"`;
    
    console.log(`🛡️ Processing description (${sanitizedDescription.length} chars)`);
    
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
        }],
        generationConfig: {
          temperature: 0.2, // Mais determinístico
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 800, // Mais espaço para claims
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates[0].content.parts[0].text;
    
    console.log(`📝 Raw response: ${text.substring(0, 200)}...`);
    
    // Extract JSON from response - mais robusto
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('❌ No JSON found in response');
      console.error('Full response:', text);
      throw new Error('No JSON found in response');
    }
    
    const parsed = JSON.parse(jsonMatch[0]) as ExtractClaimsResult;
    
    // Validate structure
    if (!parsed.claims || !Array.isArray(parsed.claims)) {
      throw new Error('Invalid claims structure in response');
    }
    
    // Validate each claim - mais permissivo
    parsed.claims.forEach((claim, index) => {
      if (!claim.text || typeof claim.text !== 'string') {
        throw new Error(`Invalid claim text at index ${index}`);
      }
      if (!claim.type || !['year', 'person', 'event', 'restoration', 'location', 'architecture', 'cultural', 'dimension', 'other'].includes(claim.type)) {
        throw new Error(`Invalid claim type at index ${index}`);
      }
      if (typeof claim.confidence !== 'number' || claim.confidence < 0 || claim.confidence > 1) {
        // Ajustar confiança se inválida
        claim.confidence = 0.9;
      }
    });
    
    parsed.total_claims = parsed.claims.length;
    
    console.log(`✅ Successfully extracted ${parsed.total_claims} claims`);
    
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
    ['year', 'person', 'event', 'restoration', 'location', 'architecture', 'cultural', 'dimension', 'other'].includes(claim.type) &&
    typeof claim.confidence === 'number' &&
    claim.confidence >= 0 &&
    claim.confidence <= 1
  );
}
