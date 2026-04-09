// _shared/masterPackGenerator.ts

interface MasterPackResult {
    description: string;
    facts_pack_json: any;
}

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
 * Master Content Generator (Step A)
 * Focus: Static, premium, encyclopedic content.
 * Target: Dynamic duration (e.g., 20s, 30s, etc.)
 */
export const generateMasterPack = async (
    poiName: string,
    city: string,
    rawContext: string,
    language: string,
    apiKey: string,
    poiData: any = {},
    audioDuration: number = 25,
    memberPois: any[] = [],
    referenceLinks: string[] = [] // Links de referência do CMS (Wikipedia, sites oficiais, etc.)
): Promise<MasterPackResult> => {

    const audioTarget = `${audioDuration}s`;
    // We use a safe estimate: ~16 characters per second (including spaces).
    // This provides a firmer constraint for the AI than word count.
    const minChars = Math.floor(audioDuration * 14);
    const maxChars = Math.floor(audioDuration * 18);
    const langName = getLanguageName(language);

    const isComplex = memberPois && memberPois.length > 0;
    const membersSummary = isComplex 
        ? memberPois.map(p => `- ${p.name} (${p.category || p.type || 'highlight'})`).join('\n')
        : '';

    // Google AI Studio Best Practices:
    // - system_instruction: persona, language rules, output format (invariável)
    // - user contents: research task only (clean, no formatting constraints)
    // This split prevents the 'attention conflict' that causes empty grounded responses.
    const hasReferenceLinks = referenceLinks && referenceLinks.length > 0;

    const systemInstruction = [
        // Language is the FIRST instruction — model must not override after reading English sources
        `LANGUAGE RULE (mandatory): Write ALL output exclusively in ${langName}. Do not use English or any other language.`,
        `You are an Expert Historian and Professional Travel Writer.`,
        `Your descriptions are elegant, encyclopedic and culturally rich.`,
        isComplex
            ? `When describing complexes or parks, mention the key internal highlights: ${membersSummary}`
            : ``,
        hasReferenceLinks
            ? `You have been provided with authoritative reference URLs. Prioritize information from these sources in your response.`
            : ``,
        ``,
        `OUTPUT FORMAT — use these exact XML tags. Do NOT use Markdown tables or headers inside the tags:`,
        `<master_description>`,
        `[Narrative paragraph, ~${maxChars} characters, ~${audioTarget} audio. Do not mention standalone city or state names.]`,
        `</master_description>`,
        ``,
        `<master_facts>`,
        `[Write exactly 5 lines. Each line must be in the format: Category|Fact — no Markdown, no table headers, no pipes except as separator]`,
        `Example line: Fundação|Inaugurado em 1991`,
        `Example line: Arquitetura|Estilo colonial com fachada de pedra`,
        `</master_facts>`,
        ``,
        `REMINDER: All text inside the XML tags must be in ${langName}.`,
    ].filter(Boolean).join('\n');

    const userPrompt = [
        `Research and write about: "${poiName}" located in ${city}.`,
        hasReferenceLinks
            ? `Use the provided reference URLs as primary sources. Also use Google Search for any additional foundation date, founding figures, and historical milestones not covered by the references.`
            : `Find using Google Search: foundation date, founding figures, and the most unique historical or architectural milestone.`,
        rawContext ? `Additional context: ${rawContext}` : ``,
    ].filter(Boolean).join('\n');

    // 2026 Model Strategy (Google AI Studio Best Practices):
    // 1. gemini-2.5-flash-lite: fastest & cheapest, works well with system_instruction split
    // 2. gemini-3-flash-preview: Google's officially recommended model for Grounding
    const models = [
        'gemini-2.5-flash-lite',
        'gemini-3-flash-preview'
    ];
    const groundingOptions = [true, false]; // Priority: Grounded, then Non-Grounded

    let lastError: Error | null = null;

    for (const model of models) {
        for (const useGrounding of groundingOptions) {
            const traceId = Math.random().toString(36).substring(7);
            try {
                const modeLabel = useGrounding ? "WITH grounding" : "WITHOUT grounding";
                console.log(`[Master Generator][Trace:${traceId}] Trying model: ${model} ${modeLabel} for POI: ${poiName}...`);

                const fetchBody: any = {
                    system_instruction: {
                        parts: [{ text: systemInstruction.trim() }]
                    },
                    contents: [{ parts: [{ text: userPrompt.trim() }] }],
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: 1200
                    }
                };

                if (useGrounding) {
                    fetchBody.tools = [{ google_search: {} }];

                    // Se o usuário adicionou links de referência no CMS, passamos como URL Context.
                    // O Gemini vai ler o conteúdo das páginas antes de gerar a descrição.
                    if (hasReferenceLinks) {
                        fetchBody.tools.push({ url_context: { urls: referenceLinks.slice(0, 5) } });
                        console.log(`[Master Generator][Trace:${traceId}] Using ${referenceLinks.length} reference URL(s) as context.`);
                    }

                    fetchBody.safetySettings = [
                        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" }
                    ];
                }


                const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(fetchBody)
                    }
                );

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
                    const errorMessage = errorData.error?.message || response.statusText;
                    console.error(`[Master Generator][Trace:${traceId}] ${model} (${modeLabel}) failed: ${response.status} - ${errorMessage}`);
                    lastError = new Error(`Gemini API error (${model} ${modeLabel}): ${response.status} ${errorMessage}`);
                    continue;
                }

                const result = await response.json();
                
                if (result.error) {
                    console.error(`[Master Generator][Trace:${traceId}] API returned error for ${model} (${modeLabel}):`, result.error.message);
                    lastError = new Error(`Gemini API Error (${model} ${modeLabel}): ${result.error.message}`);
                    continue;
                }

                const rawText = (result.candidates?.[0]?.content?.parts || [])
                    .map((p: any) => p.text || "")
                    .join("");

                if (!rawText) {
                    if (useGrounding) {
                        console.warn(`[Master Generator][Trace:${traceId}] Empty grounded response from ${model}. Retrying WITHOUT grounding...`);
                    } else {
                        console.warn(`[Master Generator][Trace:${traceId}] Empty non-grounded response from ${model}.`);
                    }
                    lastError = new Error(`Empty response from ${model} ${modeLabel}`);
                    continue;
                }

                // Ultra-Resilient Tag Extraction (Case Insensitive)
                const descMatch = rawText.match(/<master_description>([\s\S]*?)<\/master_description>/i);
                const factsMatch = rawText.match(/<master_facts>([\s\S]*?)<\/master_facts>/i);

                // Helper: detect if a line looks like a fact (contains | but is not a long sentence)
                const isFactLine = (line: string) => {
                    const trimmed = line.trim();
                    return trimmed.includes('|') && trimmed.length < 200 && !trimmed.startsWith('<');
                };

                let description = descMatch ? descMatch[1].trim() : "";
                let rawFactsText = factsMatch ? factsMatch[1].trim() : "";

                // Fallback: model returned text without XML tags —
                // Separate by detecting lines that look like "Category|Fact"
                if (!description) {
                    const lines = rawText.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
                    const descLines: string[] = [];
                    const factLines: string[] = [];

                    for (const line of lines) {
                        if (isFactLine(line)) {
                            factLines.push(line);
                        } else {
                            // Only add to description if we haven't started collecting facts yet
                            // (avoids mixing facts that appear mid-text)
                            if (factLines.length === 0) {
                                descLines.push(line);
                            }
                        }
                    }

                    description = descLines.join(' ').trim();
                    if (!rawFactsText && factLines.length > 0) {
                        rawFactsText = factLines.join('\n');
                    }

                    if (description) {
                        console.warn(`[Master Generator][Trace:${traceId}] XML tags missing. Recovered description and ${factLines.length} fact lines via fallback parser.`);
                    }
                }

                // If we still have no description, log and skip to next model
                if (!description) {
                    console.warn(`[Master Generator][Trace:${traceId}] Extraction FAILED. Raw snippet (200 chars): ${rawText.substring(0, 200)}`);
                    lastError = new Error(`Failed to extract description from ${model} ${modeLabel}`);
                    continue;
                }

                const factsLines = rawFactsText ? rawFactsText.split('\n') : [];

                const facts_pack_json = factsLines.map((line: string) => {
                    const [category, ...textParts] = line.split('|');
                    return {
                        category: (category || 'history').trim().toLowerCase().replace(/[^a-z]/g, ''),
                        text: textParts.join('|').trim().replace(/\[cite: \d+\]/g, "").replace(/\[\d+\]/g, "")
                    };
                }).filter((f: any) => f.text.length > 5);

                const finalDescription = description.replace(/\[cite: \d+\]/g, "").replace(/\[\d+\]/g, "");

                console.log(`[Master Generator][Trace:${traceId}] SUCCESS with ${model} (${modeLabel}). Score candidate ready.`);
                
                return {
                    description: finalDescription,
                    facts_pack_json: facts_pack_json
                };

            } catch (error) {
                console.error(`[Master Generator][Trace:${traceId}] Exception with ${model}:`, error);
                lastError = error instanceof Error ? error : new Error(String(error));
                continue;
            }
        }
    }

    const finalErrorMessage = lastError ? `All Gemini models failed. Last error: ${lastError.message}` : 'All Gemini generation models failed for an unknown reason';
    console.error(`[Master Generator] ${finalErrorMessage}`);
    throw new Error(finalErrorMessage);
};
