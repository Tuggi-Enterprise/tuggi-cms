// _shared/contextualGenerator.ts

interface UserContext {
    location: {
        latitude: number;
        longitude: number;
    };
    speed: number;
    heading: number;
    travel_mode: string;
    language: string;
    previous_poi?: {
        name: string;
        type: string;
        played_at: string; // ISO string
    };
    next_poi?: {
        name: string;
        type: string;
    };
}

interface PoiFacts {
    description: string;
    facts_pack_json: any;
}

/**
 * Contextual Narration Script (Step B)
 * Takes the high-quality Step A Master Description and adds a navigational "hook".
 */
export const generateNarrativeScript = async (
    context: UserContext,
    facts: PoiFacts,
    targetPoi: { name: string, type: string, bearing: number, distance: number },
    apiKey: string
): Promise<string> => {

    const directionDiff = targetPoi.bearing - context.heading;
    const normalizedDiff = ((directionDiff + 180) % 360) - 180;

    let directionBucket = "à frente";
    if (normalizedDiff > 45 && normalizedDiff < 135) directionBucket = "à sua direita";
    else if (normalizedDiff < -45 && normalizedDiff > -135) directionBucket = "à sua esquerda";
    else if (Math.abs(normalizedDiff) >= 135) directionBucket = "atrás de você";

    // Calculate time since last POI to help AI decide on transition strength
    let timeSinceLastPoiStr = "unknown";
    if (context.previous_poi?.played_at) {
        const ms = Date.now() - new Date(context.previous_poi.played_at).getTime();
        const mins = Math.floor(ms / 60000);
        const secs = Math.floor((ms % 60000) / 1000);
        timeSinceLastPoiStr = mins > 0 ? `${mins} minutes and ${secs} seconds` : `${secs} seconds`;
    }

    const prompt = `
ROLE: Expert Travel Guide (Narration Layer).
TONE: Premium, Professional, Engaging, Vivid.

JOURNAL CONTEXT:
- Traveling by: ${context.travel_mode === 'drive' ? 'Car/Driving' : 'Walking'}.
- LANGUAGE: ${context.language}.

CURRENT TARGET (The POI we are approaching):
- Name: "${targetPoi.name}" (${targetPoi.type})
- Location: ${directionBucket}
- Proximity: ${targetPoi.distance} meters. 
  IMPORTANT: Use natural expressions like "logo ali", "em instantes", or "à sua frente". NEVER mention exact meters/kilometers.

STRICT SOURCE MATERIAL (Rules for current POI):
- Use ONLY the following information for historical/factual content:
  "${facts.description}"
- Bonus details from Fact Pack (if relevant):
  ${JSON.stringify(facts.facts_pack_json)}
- CRITICAL: Do NOT include external facts about the city, region, or general history ("Clube dos Escravos", "Capital da Linguiça", etc) UNLESS they are explicitly present in the texts above. Stay focused ONLY on this specific POI.

HISTORY (Transitions):
${context.previous_poi ? `- Last POI played: "${context.previous_poi.name}" (Type: ${context.previous_poi.type}). 
- recency: played ${timeSinceLastPoiStr} ago. 
- Rule: If played recently (under 2 mins), acknowledge the journey (e.g. "Logo após passarmos pelo..."). If more than 5 mins, ignore it.` : 'No previous POI.'}

FUTURE (Suggestions - NO SUPPOSITIONS):
${context.next_poi ? `- Potential next interest: "${context.next_poi.name}" (${context.next_poi.type}). 
- Rule: Do NOT assume the driver is going there. Use phrases like "Se você continuar sua jornada, poderá se interessar pelo..." or "Quem sabe sua próxima parada seja...".` : 'No next POI known.'}

FINAL GUIDELINES:
1. START with the navigational hook (e.g., "Logo à sua frente...").
2. DO NOT ALUCINATE: If a fact is not in the SOURCE MATERIAL, omit it.
3. BE CONCISE: Final script MUST be around 30 seconds of speech. At 1.2x rate, this means a maximum of 75 words. 
4. NARRATIVE: Blend the hook, the transition (if recent), and the POI description into a single fluid story.
`;

    console.log('[Contextual Generator] Generating premium script...');

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.3 // Low temperature for consistency
                }
            })
        }
    );

    if (!response.ok) {
        throw new Error(`Gemini API Error (Contextual): ${response.statusText}`);
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) throw new Error('Gemini returned empty text for contextual script');

    return text.trim();
};
