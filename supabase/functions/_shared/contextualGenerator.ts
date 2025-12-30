// _shared/contextualGenerator.ts

export interface POIDetail {
    name: string;
    description: string;
    facts: any;
}

export interface UserContext {
    poi_location?: {
        latitude: number;
        longitude: number;
    };
    speed: number;
    heading: number;
    bearing?: number; // Added to handle current POI bearing
    travel_mode: string;
    language: string;
    target_details: POIDetail;
    previous_details?: POIDetail;
    next_details?: POIDetail;
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
        distance: number;
        bearing: number;
        // Note: location removed - frontend no longer sends this
    };
}


/**
 * Contextual Narration Script (Step B)
 * Takes the high-quality Step A Master Description and adds a navigational "hook".
 */
export const generateNarrativeScript = async (
    context: UserContext,
    apiKey: string
): Promise<string> => {

    // Calculate raw relative positions for AI decision making
    const getRelativePosition = (poiHeading: number) => {
        if (!context.heading || context.heading === -1) return "AROUND";
        const diff = poiHeading - context.heading;
        const norm = ((diff + 180) % 360) - 180;
        if (norm > 45 && norm < 135) return "RIGHT";
        if (norm < -45 && norm > -135) return "LEFT";
        if (Math.abs(norm) >= 135) return "BEHIND";
        return "AHEAD";
    };

    const currentRelPos = getRelativePosition(context.bearing || 0);
    const nextRelPos = context.next_poi ? getRelativePosition(context.next_poi.bearing || 0) : "UNKNOWN";

    const prompt = `
ROLE: You are "TUGGI", a legendary, charismatic local tour guide. 
GOAL: Create a single, fluid narrative (MAX 50s) that connects the user's journey. 
TONE: Storytelling, professional, and enthusiastic. NO GREETINGS.

--- THE JOURNEY ARC (DATA FROM DATABASE) ---
1. JUST VISITED: ${context.previous_details ? `"${context.previous_details.name}". Context: ${context.previous_details.description.substring(0, 200)}` : "Moving through the city (Unknown previous context)."}
2. ARRIVING NOW: "${context.target_details.name}". Position: ${currentRelPos}.
   - KEY STORY: ${context.target_details.description}
   - FAST FACTS: ${JSON.stringify(context.target_details.facts)}
3. UP NEXT: ${context.next_details ? `"${context.next_details.name}" (${nextRelPos}). Context: ${context.next_details.description.substring(0, 150)}` : "More surprises ahead."}

--- NARRATIVE DIRECTIVES ---
1. FACT PRIORITY (CRITICAL): If "FAST FACTS" are provided, they are your PRIMARY source of truth. Use them to build your narrative from scratch.
2. CONTEXTUAL STORY: Use the "KEY STORY" ONLY as a backup or for general context. Do not repeat its exact phrasing if "FAST FACTS" are available.
3. STORY FALLBACK: If "FAST FACTS" are empty or missing, use the "KEY STORY" as your main source.
4. HOP-ON RULE: If "JUST VISITED" is unknown, DO NOT mention "starting" or "first stop". Start directly with the view ("As we approach...", "Look to your right...").
5. NATURAL SPATIAL CUES: Include the direction (${currentRelPos}) naturally in your story.
6. THE TEASER: Use the "UP NEXT" info to create anticipation for the next part of the trip.
7. NO FILLERS: No "Olá", "400 metros", "Preparem-se". Start with the narrative.

IMPORTANT: Use ONLY the provided database facts/stories. Every word must be in ${context.language}.

GENERATE THE COHESIVE TOUR NARRATION:
`;

    console.log('[Contextual Generator] Generating group-context script with Gemini 2.5 Flash-Lite...');

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
                ],
                generationConfig: {
                    temperature: 0.8,
                    topP: 0.95,
                    maxOutputTokens: 200
                }
            })
        }
    );

    if (!response.ok) {
        const error = await response.text();
        console.error('[Gemini API Error] Status:', response.status, 'Body:', error);
        throw new Error(`Gemini API error: ${response.status}`);
    }

    const result = await response.json();
    return result.candidates[0].content.parts[0].text;
};

import { translateWithGemini } from './translationUtility.ts';

/**
 * Translation Utility
 * Translates an existing narrative into the requested language while maintaining the persona.
 */
export const translateNarrative = async (
    text: string,
    targetLanguage: string,
    apiKey: string
): Promise<string> => {
    return translateWithGemini(text, targetLanguage, apiKey);
};
