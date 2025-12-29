// _shared/translationUtility.ts

/**
 * Shared Translation Utility using Gemini
 * Harmonizes translation across different edge functions (static & contextual)
 */
export const translateWithGemini = async (
    text: string,
    targetLanguage: string,
    apiKey: string
): Promise<string> => {
    // Validate and sanitize input text
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        throw new Error('Invalid or empty text provided for translation');
    }

    const prompt = `You are a professional travel assistant specialized in tourism translation.

Translate the following POI (Point of Interest) tour narration originally written for Brazilian Portuguese tourists, and rewrite it in a natural and culturally appropriate way for international tourists who speak the target language below.

The translation must:
- Preserve the meaning and structure of the original text.
- Sound natural, fluent, and engaging when read aloud.
- Maintain the EXACT tone, charisma, and spatial directions of the original.
- Avoid overly formal or robotic language.
- Be compatible with audio narration (no abrupt transitions, smooth sentence flow).
- Limit the result to about same amount of words comes from original text.

ORIGINAL TEXT (pt-br):
"${text}"

Target Language:
"${targetLanguage}" (e.g., en-us, es-es, fr-fr)

Expected output:
Translated text only (no labels, no explanations, no tags).`;

    // Try Flash-Lite first, then Flash as fallback
    const models = [
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash' // Fallback to 2.0 if 2.5 is unavailable/not yet standard, but keeping 2.5-flash-lite as priority
    ];

    let lastError: Error | null = null;

    for (const model of models) {
        try {
            console.log(`[Translation Utility] Trying model: ${model} for language: ${targetLanguage}`);

            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature: 0.3, // Lower temperature for more accurate translation
                            maxOutputTokens: 1024,
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

            console.log(`[Translation Utility] Successfully translated using ${model}`);
            return data.candidates[0].content.parts[0].text.trim();
        } catch (error) {
            console.error(`[Translation Utility] Error with model ${model}:`, error);
            lastError = error instanceof Error ? error : new Error(String(error));
            continue;
        }
    }

    throw lastError || new Error('All Gemini translation models failed');
};
