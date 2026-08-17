// _shared/translationUtility.ts

/**
 * Shared Translation Utility using Gemini
 * Harmonizes translation across different edge functions (static & contextual)
 */
// SSOT de nomes de idioma para os prompts. Cobre os alvos da expansão (Ásia,
// Rússia, Tailândia) com o script explícito quando ajuda o modelo a escolher
// a escrita correta. Exportado p/ reuso (DRY) em outros geradores.
export const getLanguageName = (code: string): string => {
    const names: Record<string, string> = {
        // Ocidentais
        'pt-br': 'Brazilian Portuguese',
        'pt-pt': 'European Portuguese',
        'en-us': 'English (United States)',
        'en-gb': 'English (United Kingdom)',
        'es-es': 'Spanish (Spain)',
        'es-us': 'Spanish (Latin America/United States)',
        'es-mx': 'Spanish (Mexico)',
        'de-de': 'German',
        'fr-fr': 'French',
        'fr-ca': 'French (Canada)',
        'it-it': 'Italian',
        // Asiáticos / Cirílico / Tailandês (expansão)
        'ja-jp': 'Japanese (Japanese script: kanji/kana)',
        'ko-kr': 'Korean (Hangul script)',
        'zh-cn': 'Chinese (Mandarin, Simplified script)',
        'cmn-cn': 'Chinese (Mandarin, Simplified script)',
        'ru-ru': 'Russian (Cyrillic script)',
        'th-th': 'Thai (Thai script)',
        'ar-sa': 'Arabic (Arabic script)',
        // Short codes
        'pt': 'Brazilian Portuguese',
        'en': 'English (United States)',
        'es': 'Spanish',
        'de': 'German',
        'fr': 'French',
        'it': 'Italian',
        'ja': 'Japanese (Japanese script: kanji/kana)',
        'ko': 'Korean (Hangul script)',
        'zh': 'Chinese (Mandarin, Simplified script)',
        'ru': 'Russian (Cyrillic script)',
        'th': 'Thai (Thai script)',
        'ar': 'Arabic (Arabic script)'
    };
    return names[code.toLowerCase()] || code;
};

export interface GeminiUsage {
    input_tokens: number;
    output_tokens: number;
    model: string;
}

export interface GeminiTextResult {
    text: string;
    usage: GeminiUsage | null;
}

/**
 * Thinking control por geração do modelo (boas práticas Gemini: thinking baixo
 * p/ tarefas determinísticas como tradução). Campo enviado dentro de
 * generationConfig.thinkingConfig. Se a API rejeitar (campo desconhecido), o
 * fallback de modelos flash-lite + maxOutputTokens maior já cobre — ver plano.
 *  - gemini-2.5*  → thinkingBudget: 0 (desliga; flash-lite já vem off)
 *  - gemini-3*    → thinkingLevel: 'low'
 */
const buildThinkingConfig = (model: string): Record<string, unknown> | undefined => {
    const m = model.toLowerCase();
    if (m.startsWith('gemini-3')) return { thinkingLevel: 'low' };
    if (m.startsWith('gemini-2.5')) return { thinkingBudget: 0 };
    return undefined;
};

/**
 * Shared Gemini call com fallback de modelos STABLE (2.5 Flash-Lite -> 3.1 Flash-Lite).
 * Retorna texto + usageMetadata. Coleta o motivo de falha de CADA modelo (status
 * HTTP / finishReason) p/ diagnóstico — antes só o erro do último era exposto.
 */
const runGeminiPromptWithUsage = async (
    prompt: string,
    apiKey: string,
    maxOutputTokens = 2048,
    temperature = 0.3
): Promise<GeminiTextResult> => {
    // Tradução no gemini-2.5-flash-lite (barato: $0.10/$0.40, testado ativo e OK em
    // multiscript). Fallback vivo no 3.1-flash-lite se o 2.5-flash-lite flapar.
    const models = [
        'gemini-2.5-flash-lite',
        'gemini-3.1-flash-lite'
    ];

    let lastError: Error | null = null;
    const attempts: string[] = [];

    for (const model of models) {
        try {
            console.log(`[Translation Utility] Trying model: ${model}`);

            const thinkingConfig = buildThinkingConfig(model);
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature,
                            maxOutputTokens,
                            ...(thinkingConfig ? { thinkingConfig } : {}),
                        }
                    })
                }
            );

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
                const errorMessage = errorData.error?.message || response.statusText;
                console.error(`[Translation Utility] Model ${model} failed: ${response.status} - ${errorMessage}`);
                attempts.push(`${model}: HTTP ${response.status} ${errorMessage}`);
                lastError = new Error(`Gemini API error (${model}): ${response.status} ${errorMessage}`);
                continue;
            }

            const data = await response.json();

            const finishReason = data.candidates?.[0]?.finishReason;
            if (finishReason && finishReason !== 'STOP') {
                console.error(`[Translation Utility] Model ${model} non-STOP finishReason: ${finishReason}`);
                attempts.push(`${model}: finishReason ${finishReason}`);
                lastError = new Error(`Gemini API non-STOP (${model}): ${finishReason}`);
                continue;
            }

            if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
                console.error(`[Translation Utility] Model ${model}: empty/invalid response`);
                attempts.push(`${model}: empty response`);
                lastError = new Error(`Invalid response from Gemini API (${model})`);
                continue;
            }

            const usageMeta = data.usageMetadata || {};
            const usage: GeminiUsage = {
                input_tokens: usageMeta.promptTokenCount ?? 0,
                output_tokens: usageMeta.candidatesTokenCount ?? 0,
                model,
            };

            console.log(`[Translation Utility] Successfully generated using ${model}. Tokens: in=${usage.input_tokens} out=${usage.output_tokens}`);
            return {
                text: data.candidates[0].content.parts[0].text.trim(),
                usage,
            };
        } catch (error) {
            console.error(`[Translation Utility] Error with model ${model}:`, error);
            attempts.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
            lastError = error instanceof Error ? error : new Error(String(error));
            continue;
        }
    }

    // Surface EVERY model's failure (não só o do último) p/ diagnóstico.
    console.error(`[Translation Utility] All models failed: ${attempts.join(' | ')}`);
    throw new Error(`All Gemini translation models failed: ${attempts.join(' | ')}`);
};

const runGeminiPrompt = async (
    prompt: string,
    apiKey: string,
    maxOutputTokens = 1024,
    temperature = 0.3
): Promise<string> => {
    const { text } = await runGeminiPromptWithUsage(prompt, apiKey, maxOutputTokens, temperature);
    return text;
};

const buildPoiTranslationPrompt = (text: string, targetLanguage: string): string => {
    const langName = getLanguageName(targetLanguage);
    return `You are a professional travel assistant specialized in tourism translation.

Translate the following POI (Point of Interest) tour narration and rewrite it in a natural and culturally appropriate way for tourists who speak the target language below.

The translation must:
- Preserve the meaning and structure of the original text.
- Sound natural, fluent, and engaging when read aloud.
- Maintain the EXACT tone, charisma, and spatial directions of the original.
- Avoid overly formal or robotic language.
- Be compatible with audio narration (no abrupt transitions, smooth sentence flow).
- Keep a comparable length to the original (do not count "words" — many scripts like Chinese, Japanese and Thai have no spaces between words).
- IMPORTANT: The output must be written EXCLUSIVELY in ${langName}, using its native script (e.g. kanji/kana for Japanese, Hangul for Korean, Hanzi for Chinese, Cyrillic for Russian, Thai script for Thai). Do not romanize.

ORIGINAL TEXT:
"${text}"

Target Language:
"${langName}" (Code: ${targetLanguage})

Expected output:
Translated text only (no labels, no explanations, no tags).`;
};

export const translateWithGemini = async (
    text: string,
    targetLanguage: string,
    apiKey: string
): Promise<string> => {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        throw new Error('Invalid or empty text provided for translation');
    }
    // 2048 (não 1024): parágrafo traduzido p/ JP/Thai/Cirílico + thinking cabe.
    return runGeminiPrompt(buildPoiTranslationPrompt(text, targetLanguage), apiKey, 2048);
};

/**
 * Same as translateWithGemini but also returns Gemini usage metadata so callers
 * can persist token counts for analytics.
 */
export const translateWithGeminiWithUsage = async (
    text: string,
    targetLanguage: string,
    apiKey: string
): Promise<GeminiTextResult> => {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        throw new Error('Invalid or empty text provided for translation');
    }
    return runGeminiPromptWithUsage(buildPoiTranslationPrompt(text, targetLanguage), apiKey, 2048);
};

/**
 * Prompt for translating a POI NAME (not its description). A name is a proper
 * noun, so the rules differ from narration translation: prefer the established
 * exonym, otherwise transliterate into the target script, never invent.
 * `context` is an optional short hint (city and/or first sentence of the
 * translated description) used to disambiguate the place.
 */
const buildPoiNameTranslationPrompt = (
    name: string,
    targetLanguage: string,
    context?: string
): string => {
    const langName = getLanguageName(targetLanguage);
    const contextBlock = context && context.trim().length > 0
        ? `\nCONTEXT (to disambiguate the place, do NOT translate this):\n"${context.trim()}"\n`
        : '';
    return `You are a tourism localization expert. Render the Point of Interest NAME below so a speaker of the target language immediately UNDERSTANDS WHAT KIND OF PLACE it is. The original name is always shown next to your output, so prioritize comprehension over preserving the foreign spelling.

Rules (in priority order):
1. If a well-established name already exists in the target language (an exonym, e.g. "Eiffel Tower" -> "Torre Eiffel", "Christ the Redeemer" -> "Cristo Redentor"), use that exonym.
2. Otherwise, TRANSLATE the generic geographic/descriptive term (the common noun that says what the place is) into the target language, and KEEP the proper name. Examples (FR->PT): "Pointe du Santel" -> "Ponta do Santel", "Col de Rhêmes" -> "Passo de Rhêmes", "Mont Blanc" -> "Monte Branco" only if it's an established exonym (else "Monte Blanc"), "Lac Léman" -> "Lago Léman", "Église Saint-Pierre" -> "Igreja Saint-Pierre", "Pont du Gard" -> "Ponte du Gard". Connectors follow the target language ("du/de la" -> "do/da") when natural.
3. For ANY target language that uses a non-Latin script (Japanese, Korean, Chinese, Thai, Russian/Cyrillic, Arabic, Hindi/Devanagari, etc.), write the WHOLE result in that native script: TRANSLATE the descriptive term and TRANSLITERATE the proper name phonetically into that script, so it is both readable AND understandable. Do not leave Latin letters.
4. Use the CONTEXT/description (when provided) to decide WHAT KIND of place it is, and pick the descriptive term that matches it.
5. NEVER invent facts or change which place is referred to — only translate the descriptor and localize the proper name. Do NOT add the name in other languages or any alternative in parentheses/slashes.
6. Output a single clean name (a title, not a sentence).
${contextBlock}
ORIGINAL NAME:
"${name}"

Target Language:
"${langName}" (Code: ${targetLanguage})

Expected output:
The localized name only — no quotes, labels, explanations, or alternatives.`;
};

/**
 * Translate a POI name into the target language, returning Gemini usage so the
 * caller can persist token counts. Short output budget — names are titles.
 */
export const translatePoiNameWithUsage = async (
    name: string,
    targetLanguage: string,
    apiKey: string,
    context?: string
): Promise<GeminiTextResult> => {
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        throw new Error('Invalid or empty name provided for translation');
    }
    // temperature 0.1: names should be deterministic, not creative.
    // maxOutputTokens 1024 (não 128): os modelos 2.5/3 gastam "thinking tokens"
    // que contam no orçamento — um teto baixo estoura em MAX_TOKENS sem emitir o
    // nome. 1024 dá folga p/ o raciocínio; o nome em si é curto.
    return runGeminiPromptWithUsage(
        buildPoiNameTranslationPrompt(name, targetLanguage, context),
        apiKey,
        1024,
        0.1
    );
};

/**
 * Tradutor genérico de marketing/email (assunto, título, parágrafos, CTA).
 * Tom neutro, preserva intenção, URLs e placeholders {{ }}. Reusa o mesmo
 * fallback de modelos do tradutor de POI (DRY).
 */
export const translateText = async (
    text: string,
    targetLanguage: string,
    apiKey: string
): Promise<string> => {
    if (!text || typeof text !== 'string' || text.trim().length === 0) return '';

    const langName = getLanguageName(targetLanguage);
    const prompt = `You are a professional marketing copy translator for a travel app called Tuggi.

Translate the marketing/email snippet below into the target language.

Rules:
- Keep the marketing tone: clear, friendly and engaging.
- Preserve meaning, intent and any call-to-action.
- Do NOT translate brand names, URLs, or placeholders wrapped in {{ }}.
- Keep markdown like **bold** and [text](url) intact.
- Output ONLY the translated snippet — no labels, quotes, or explanations.

TARGET LANGUAGE: ${langName} (code: ${targetLanguage})

SNIPPET:
${text}`;

    return runGeminiPrompt(prompt, apiKey, 2048);
};

/** Que tipo de fala é a linha — muda o registro esperado na tradução. */
export type SystemAudioLineKind = 'direction' | 'notice';

/**
 * Prompt de tradução das linhas faladas de sistema (direções e avisos).
 *
 * Existe porque `translateText` **não serve** aqui, e o defeito foi ao ar: aquele
 * prompt é de copy de marketing e manda *não traduzir nome de marca*. Com a fonte
 * `logo à frente`, o modelo leu o "logo" português como **logotipo**, preservou a
 * palavra e o inglês saiu falando *"Logo ahead"*. Falso amigo mais uma regra de
 * preservação de marca dá exatamente isso.
 *
 * Aqui não há marca, não há markdown, não há placeholder e não há tom de campanha:
 * é uma frase curta que uma voz vai dizer dentro de um carro. Tudo se traduz.
 *
 * Exportado separado da chamada para poder ser verificado por teste — o que o
 * modelo devolve não é determinístico, mas o que a gente pede é.
 */
export const buildSystemAudioPrompt = (
    text: string,
    targetLanguage: string,
    kind: SystemAudioLineKind
): string => {
    const langName = getLanguageName(targetLanguage);
    const context = kind === 'direction'
        ? `This line is a SPOKEN DIRECTION CUE played in a car right before the guide narrates a place — the equivalent of "on your left" or "just ahead". It must be the short, natural phrase a native driver would expect to hear, not a literal word-by-word rendering.`
        : `This line is a SPOKEN NOTICE from the guide to the driver (about remaining hours, connection or permissions). It must sound calm and natural read aloud, never like written UI text.`;

    return `You are translating short spoken lines for a car audio guide called Tuggi.

${context}

Rules:
- TRANSLATE EVERY WORD. There are no brand names, no product names, no URLs and no
  placeholders in this text — treat every word as ordinary language.
- Beware of false friends with the source language. In Portuguese, "logo" means
  "right/just" (as in "right ahead"), NEVER the English word "logo".
- Keep it as short as the original. These clips play while someone is driving.
- Natural spoken register for a native speaker of the target language.
- Do not add greetings, quotes, punctuation marks or explanations that are not in
  the source.
- Output ONLY the translated line.

TARGET LANGUAGE: ${langName} (code: ${targetLanguage})

LINE:
${text}`;
};

/** Traduz uma linha falada de sistema. Ver `buildSystemAudioPrompt`. */
export const translateSystemAudioLine = async (
    text: string,
    targetLanguage: string,
    apiKey: string,
    kind: SystemAudioLineKind
): Promise<string> => {
    if (!text || typeof text !== 'string' || text.trim().length === 0) return '';
    return runGeminiPrompt(buildSystemAudioPrompt(text, targetLanguage, kind), apiKey, 512);
};
