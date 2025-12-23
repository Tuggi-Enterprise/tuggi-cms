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

    const prompt = `
ROLE: Expert Travel Guide (Narration Layer).
CONTEXT: User is ${context.travel_mode === 'drive' ? 'driving' : 'walking'}.
CURRENT POI: "${targetPoi.name}" (${targetPoi.type}) is ${directionBucket} at approx ${targetPoi.distance} meters.

${context.previous_poi ? `PREVIOUS POI: "${context.previous_poi.name}" (${context.previous_poi.type}), played at ${context.previous_poi.played_at}.` : ''}
${context.next_poi ? `NEXT DESTINATION: "${context.next_poi.name}" (${context.next_poi.type}).` : ''}

SOURCE MATERIAL (The Master Description - Use this as your primary narrative base):
"${facts.description}"

FACT PACK (Use these to enrich the narration if relevant):
${JSON.stringify(facts.facts_pack_json)}

INSTRUCTIONS:
1. Integrate the positional direction naturally at the beginning (e.g., "Logo à sua frente...", "Logo à sua direita...", "À sua esquerda...").
2. Use the Master Description as the core of your speech. Do NOT rewrite its historical facts, but make them sound like part of a live tour.
3. Keep the tone PREMIUM, INFORMED, and PROFESSIONAL (No "Aí, beleza?", "Fica ligado").
4. If there is a previous POI, you MUST add a brief transition connecting the previous vibe to the current one (e.g., "Saindo da tranquilidade da ${context.previous_poi?.name}, vamos agora descobrir...").
5. If there is a next destination, you may subtly hint at what's coming at the end (e.g., "E prepare-se, pois nossa próxima parada será no ${context.next_poi?.name}").
6. Total script length: 30-45 seconds of speech.
7. Language: ${context.language}.
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
