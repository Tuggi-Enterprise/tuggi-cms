// _shared/contextualGenerator.ts

interface UserContext {
    poi_location: {
        latitude: number;
        longitude: number;
    };
    speed: number;
    heading: number;
    travel_mode: string;
    language: string;
    previous_poi?: {
        id: string;
        name: string;
        type: string;
        played_at: string; // ISO string
        location: { latitude: number; longitude: number };
    };
    next_poi?: {
        id: string;
        name: string;
        type: string;
        bearing: number;
        location: { latitude: number; longitude: number };
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

    // Calculate raw relative positions for AI decision making
    const getRelativePosition = (poiHeading: number) => {
        const diff = poiHeading - context.heading;
        const norm = ((diff + 180) % 360) - 180;
        if (norm > 45 && norm < 135) return "RIGHT";
        if (norm < -45 && norm > -135) return "LEFT";
        if (Math.abs(norm) >= 135) return "BEHIND";
        return "AHEAD";
    };

    const currentRelPos = getRelativePosition(targetPoi.bearing);
    const nextRelPos = context.next_poi ? getRelativePosition(context.next_poi.bearing) : "UNKNOWN";

    // Placeholder for timeSinceLastPoiStr - this would need to be calculated based on previous_poi.played_at
    // For now, we'll just use a generic string if previous_poi exists, or "N/A"
    let timeSinceLastPoiStr = "N/A";
    if (context.previous_poi) {
        const playedAt = new Date(context.previous_poi.played_at);
        const now = new Date();
        const diffMs = now.getTime() - playedAt.getTime();
        const diffSeconds = Math.round(diffMs / 1000);
        if (diffSeconds < 60) {
            timeSinceLastPoiStr = `${diffSeconds} seconds ago`;
        } else {
            timeSinceLastPoiStr = `${Math.round(diffSeconds / 60)} minutes ago`;
        }
    }


    const prompt = `
ROLE: You are "TUGGI", a world-class, intelligent local guide.
GOAL: Create a brief, engaging audio narration (MAX 30s) for the user.
TONE: Natural, conversational, and context-aware. Like a friend in the car.

--- RAW CONTEXT DATA ---
[USER STATE]
- Mode: ${context.travel_mode}
- Speed: ${context.speed} km/h
- Language: ${context.language}

[SCENARIO]
1. TARGET POI (Approaching now): "${targetPoi.name}" (${targetPoi.type}).
   - Position relative to user: ${currentRelPos}.
   - Distance: ${targetPoi.distance} meters.

2. PREVIOUS POI (Just passed): ${context.previous_poi ? `"${context.previous_poi.name}" (${context.previous_poi.type})` : "None"}.
   - Time since visit: ${timeSinceLastPoiStr}.

3. NEXT POI (Up next): ${context.next_poi ? `"${context.next_poi.name}" (${context.next_poi.type})` : "None"}.
   - Position relative to user: ${nextRelPos}.

[SOURCE KNOWLEDGE]
"${facts.description}"
${JSON.stringify(facts.facts_pack_json)}

--- INTELLIGENCE DIRECTIVES ---
1. BE THE DIRECTOR: You decide what is relevant. 
   - Is the previous POI boring or too long ago? Ignore it.
   - Is the next POI interesting? Tease it.
   
2. FLUIDITY FIRST: Do NOT follow a template. 
   - Do NOT feel forced to mention the "rearview mirror" unless it adds value to the story.
   
3. SPATIAL AWARENESS: You know where things are (LEFT, RIGHT, AHEAD, BEHIND). Use this naturally to guide the user's eyes.

4. TARGET LANGUAGE STRLY: Output ONLY in ${context.language}.

--- CRITICAL NEGATIVE CONSTRAINTS ---
1. ABSOLUTELY NO GREETINGS: Do NOT start with "E aí", "Olá", "Oi", "Hello". Start with the subject.
2. NO METERS/DISTANCES: Never say "400 meters". Say "just ahead", "approaching", "nearby".
3. NO FILLERS: Delete "Fica ligado", "Preste atenção".

BAD OUTPUT (DO NOT DO THIS):
"E aí! A 400 metros temos o Lago." (Reason: Greeting + Meters)

GOOD OUTPUT (DO THIS):
"À nossa frente surge o imponente Lago do Taboão, o cartão postal da cidade..."

GENERATE THE SCRIPT NOW:
`;

    console.log('[Contextual Generator] Generating high-fidelity script with Gemini 1.5 Flash...');

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                tools: [{ google_search: {} }],
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
                ],
                generationConfig: {
                    temperature: 0.8,
                    topP: 0.95,
                    maxOutputTokens: 150
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
