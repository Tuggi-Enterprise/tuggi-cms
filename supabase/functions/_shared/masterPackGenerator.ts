// _shared/masterPackGenerator.ts

interface MasterPackResult {
    description: string;
    facts_pack_json: any;
}

/**
 * Master Content Generator (Step A)
 * Focus: Static, premium, encyclopedic content.
 * Target: 25-30s audio (approx 65-85 words).
 */
export const generateMasterPack = async (
    poiName: string,
    city: string,
    rawContext: string,
    language: string,
    apiKey: string,
    poiData: any = {}
): Promise<MasterPackResult> => {

    const audioTarget = '15-18s';
    const maxWords = 50; // VERY CONCISE base to avoid exceeding 30s in Step B

    const prompt = `
ROLE: Expert Historian and Professional Travel Writer.
TASK: Write a concise master content summary for "${poiName}" (${city}).
LANGUAGE: ${language} (CRITICAL: Output must be ONLY in ${language}).

CONTENT RULES:
1. Include the name "${poiName}".
2. Write exactly 3-4 concise, elegant sentences.
3. NO mention of city, state or country names as standalone locations.
4. TARGET LENGTH: Max ${maxWords} words for a ${audioTarget} audio narration.
5. Use Google Search to find: Exact foundation date, mission/founders, and one unique historical milestone.

NARRATIVE STRUCTURE:
- Sentence 1: Name and foundation/historical origin.
- Sentence 2: Founding figures or original purpose.
- Sentence 3: Architectural detail or a specific historical milestone (e.g. "Clube dos Escravos").
- Sentence 4: Modern identity or cultural legacy (e.g. "Capital da Linguiça").

OUTPUT FORMAT (XML TAGS):
<master_description>
[Your concise paragraph here]
</master_description>

<master_facts>
[5 atomic facts in Category|Fact format]
</master_facts>

CONTEXT: ${rawContext}
`;

    console.log(`[Master Generator] Generating concise Step A content for: ${poiName}...`);

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 1000
                },
                tools: [{ google_search: {} }]
            })
        }
    );

    if (!response.ok) throw new Error(`Gemini Master Error: ${response.status}`);

    const result = await response.json();
    let rawText = (result.candidates?.[0]?.content?.parts || [])
        .map((p: any) => p.text || "")
        .join("");

    // Resilient Tag Extraction
    const descMatch = rawText.match(/<master_description>([\s\S]*?)<\/master_description>/);
    const factsMatch = rawText.match(/<master_facts>([\s\S]*?)<\/master_facts>/);

    const description = descMatch ? descMatch[1].trim() : "";
    const factsLines = factsMatch ? factsMatch[1].trim().split('\n') : [];

    const facts_pack_json = factsLines.map((line: string) => {
        const [category, ...textParts] = line.split('|');
        return {
            category: (category || 'history').trim().toLowerCase().replace(/[^a-z]/g, ''),
            text: textParts.join('|').trim().replace(/\[cite: \d+\]/g, "").replace(/\[\d+\]/g, "")
        };
    }).filter((f: any) => f.text.length > 5);

    return {
        description: description.replace(/\[cite: \d+\]/g, "").replace(/\[\d+\]/g, ""),
        facts_pack_json: facts_pack_json
    };
};
