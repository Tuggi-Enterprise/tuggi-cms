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
    next_poi_candidates?: {
        id: string;
        name: string;
        type: string;
        category?: string;
        location: { latitude: number; longitude: number };
    }[];
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

    // Build transition context only if previous POI exists
    const transitionContext = context.previous_details
        ? `The traveler just passed "${context.previous_details.name}".`
        : null;

    // 1. SYSTEM INSTRUCTION (100% STATIC for maximum cache efficiency)
    // This allows Gemini to implicitly cache the persona and rules across ALL requests.
    const systemInstruction = `
You are TUGGI - a captivating storyteller and local expert guide.

YOUR TASK: Create a vivid, engaging narration (30-50 seconds when spoken) about the point of interest the traveler is now approaching.

NARRATIVE GUIDELINES:
1. FOCUS: The current destination is the star. Dedicate 90% of your narration to it.
2. SMOOTH TRANSITION: If transition context is provided, optionally begin with a brief, natural transition (e.g., "Leaving behind...", "From here..."). Otherwise, start directly with the current destination, using the provided spatial cues.
3. RICH STORYTELLING: Paint a picture with words. Include what makes the place special, historical/cultural facts, sensory details, and a memorable curiosity.
4. USE THE FACTS: Weave the provided facts naturally into your story.
5. STAY GROUNDED: Use ONLY the provided information. Do not invent historical dates, names, or statistics not present in the data.
6. SPATIAL AWARENESS: Naturally mention the direction of the POI so the traveler knows where to look.
7. LANGUAGE: Write entirely in the requested TARGET LANGUAGE. Match local expressions and tone.
8. NO FILLERS: Skip greetings like "Hello" or "Welcome". Jump straight into the narrative.
9. TONE CHECK: Be warm and conversational, like a knowledgeable friend talking to you. Avoid overly poetic, melodramatic, or "speech-like" phrases. Keep it grounded.
`;

    // 2. USER CONTENT (Dynamic)
    const userPrompt = `
TARGET LANGUAGE: ${context.language}

CURRENT DESTINATION: "${context.target_details.name}"
Position relative to traveler: ${currentRelPos}

FACTS (Primary source - use these!):
${JSON.stringify(context.target_details.facts || [])}

DESCRIPTION (Secondary source):
${context.target_details.description}

${transitionContext ? `TRANSITION CONTEXT: ${transitionContext}` : ''}

NOW, CREATE YOUR NARRATION:
`;

    console.log('[Contextual Generator] Generating group-context script with Gemini 2.5 Flash-Lite (using system_instruction)...');

    const fetchBody: any = {
        system_instruction: {
            parts: [{ text: systemInstruction.trim() }]
        },
        contents: [{ parts: [{ text: userPrompt.trim() }] }],
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
    };

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fetchBody)
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
