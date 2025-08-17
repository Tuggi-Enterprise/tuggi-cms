// Simplified version for Deno Edge Functions
export interface TextEvaluationResult {
  rules_score: number;
  tts_clarity_score: number;
  issues: string[];
  suggestions: string[];
}

const EVALUATE_TEXT_PROMPT = `
Você é um especialista em avaliar textos para guias de áudio turísticos.

Avalie o texto fornecido considerando:

1. REGRAS DE CONTEÚDO (40% do score):
- Máximo 200 palavras
- 2-5 frases
- Sem menções a cidade/endereço/horários/preços
- Sem superlativos excessivos
- Início compatível com áudio direcional

2. CLAREZA PARA TTS (60% do score):
- Frases bem estruturadas
- Vocabulário claro e acessível
- Ritmo adequado para narração
- Transições suaves
- Sem ambiguidades

Responda APENAS em JSON válido com esta estrutura exata:
{
  "rules_score": 0.85,
  "tts_clarity_score": 0.90,
  "issues": ["lista de problemas encontrados"],
  "suggestions": ["sugestões de melhoria"]
}

Texto para avaliação:
`;

export async function evaluateText(text: string): Promise<TextEvaluationResult> {
  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const model = 'gemini-2.0-flash-exp';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    const prompt = `${EVALUATE_TEXT_PROMPT}\n\n"${text}"`;
    
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
    const responseText = data.candidates[0].content.parts[0].text;
    
    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    
    const parsed = JSON.parse(jsonMatch[0]) as TextEvaluationResult;
    
    // Validate structure
    if (typeof parsed.rules_score !== 'number' || parsed.rules_score < 0 || parsed.rules_score > 1) {
      throw new Error('Invalid rules_score in response');
    }
    
    if (typeof parsed.tts_clarity_score !== 'number' || parsed.tts_clarity_score < 0 || parsed.tts_clarity_score > 1) {
      throw new Error('Invalid tts_clarity_score in response');
    }
    
    if (!Array.isArray(parsed.issues)) {
      parsed.issues = [];
    }
    
    if (!Array.isArray(parsed.suggestions)) {
      parsed.suggestions = [];
    }
    
    return parsed;
  } catch (error) {
    console.error('Error evaluating text:', error);
    
    // Return default result on error
    return {
      rules_score: 0.5,
      tts_clarity_score: 0.5,
      issues: ['Erro na avaliação automática'],
      suggestions: ['Revisar manualmente']
    };
  }
}

export function validateTextEvaluationResult(result: TextEvaluationResult): boolean {
  return (
    typeof result.rules_score === 'number' &&
    result.rules_score >= 0 &&
    result.rules_score <= 1 &&
    typeof result.tts_clarity_score === 'number' &&
    result.tts_clarity_score >= 0 &&
    result.tts_clarity_score <= 1 &&
    Array.isArray(result.issues) &&
    Array.isArray(result.suggestions)
  );
}
