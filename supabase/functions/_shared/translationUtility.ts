// _shared/translationUtility.ts

/**
 * Shared Translation Utility using Gemini
 * Harmonizes translation across different edge functions (static & contextual)
 */
const getLanguageName = (code: string): string => {
    const names: Record<string, string> = {
        'pt-br': 'Brazilian Portuguese',
        'pt-pt': 'European Portuguese',
        'en-us': 'English (United States)',
        'en-gb': 'English (United Kingdom)',
        'es-es': 'Spanish (Spain)',
        'es-us': 'Spanish (Latin America/United States)',
        'de-de': 'German',
        'fr-fr': 'French',
        'it-it': 'Italian',
        'ja-jp': 'Japanese',
        'cmn-cn': 'Chinese (Mandarin)',
        'ko-kr': 'Korean',
        'ru-ru': 'Russian'
    };
    return names[code.toLowerCase()] || code;
};

/**
 * Shared Gemini call with model fallback (Flash-Lite -> Flash -> 1.5).
 * Both the POI narration translator and the generic text translator use this,
 * so the model list / fallback / error handling stay in one place (DRY).
 */
const runGeminiPrompt = async (
    prompt: string,
    apiKey: string,
    maxOutputTokens = 1024,
    temperature = 0.3
): Promise<string> => {
    const models = [
        'gemini-2.5-flash-lite',
        'gemini-2.5-flash',
        'gemini-1.5-flash'
    ];

    let lastError: Error | null = null;

    for (const model of models) {
        try {
            console.log(`[Translation Utility] Trying model: ${model}`);

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
                        }
                    })
                }
            );

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
                const errorMessage = errorData.error?.message || response.statusText;
                console.error(`[Translation Utility] Model ${model} failed: ${response.status} - ${errorMessage}`);
                lastError = new Error(`Gemini API error (${model}): ${response.status} ${errorMessage}`);
                continue;
            }

            const data = await response.json();

            if (data.candidates?.[0]?.finishReason && data.candidates[0].finishReason !== 'STOP') {
                console.error(`[Translation] Model ${model} blocked content. Reason: ${data.candidates[0].finishReason}`);
                lastError = new Error(`Gemini API blocked content (${model}): ${data.candidates[0].finishReason}`);
                continue;
            }

            if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
                lastError = new Error(`Invalid response from Gemini API (${model})`);
                continue;
            }

            console.log(`[Translation Utility] Successfully generated using ${model}`);
            return data.candidates[0].content.parts[0].text.trim();
        } catch (error) {
            console.error(`[Translation Utility] Error with model ${model}:`, error);
            lastError = error instanceof Error ? error : new Error(String(error));
            continue;
        }
    }

    throw lastError || new Error('All Gemini translation models failed');
};

export const translateWithGemini = async (
    text: string,
    targetLanguage: string,
    apiKey: string
): Promise<string> => {
    // Validate and sanitize input text
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        throw new Error('Invalid or empty text provided for translation');
    }

    const langName = getLanguageName(targetLanguage);

    const prompt = `You are a professional travel assistant specialized in tourism translation.

Translate the following POI (Point of Interest) tour narration and rewrite it in a natural and culturally appropriate way for tourists who speak the target language below.

The translation must:
- Preserve the meaning and structure of the original text.
- Sound natural, fluent, and engaging when read aloud.
- Maintain the EXACT tone, charisma, and spatial directions of the original.
- Avoid overly formal or robotic language.
- Be compatible with audio narration (no abrupt transitions, smooth sentence flow).
- Limit the result to about same amount of words comes from original text.
- IMPORTANT: The output must be EXCLUSIVELY in ${langName}.

ORIGINAL TEXT:
"${text}"

Target Language:
"${langName}" (Code: ${targetLanguage})

Expected output:
Translated text only (no labels, no explanations, no tags).`;

    return runGeminiPrompt(prompt, apiKey, 1024);
};
