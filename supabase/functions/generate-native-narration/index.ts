import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateAudioWithTTS } from '../_shared/ttsGenerator.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with, accept, origin, referer, user-agent',
};

const PROJECT_URL = Deno.env.get('PROJECT_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || '';
const GEMINI_API_KEY = Deno.env.get('GOOGLE_GEMINI_API_KEY') || Deno.env.get('GEMINI_API_KEY') || '';
const GOOGLE_TTS_API_KEY = Deno.env.get('GOOGLE_TTS_API_KEY') || GEMINI_API_KEY; // Fallback to Gemini key if TTS specific key missing (often same project)

const supabaseAdmin = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

function getDirectionBucket(heading: number, bearing: number): string {
    const diff = ((bearing - heading + 180) % 360) - 180;
    if (diff > 45 && diff < 135) return "right";
    if (diff < -45 && diff > -135) return "left";
    if (Math.abs(diff) >= 135) return "behind";
    return "ahead";
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // in metres
}

async function generateCacheKey(poiId: string, language: string, travelMode: string, directionBucket: string, prevPoiId: string | undefined, nextPoiId: string | undefined): Promise<string> {
    const data = `${poiId}:${language}:${travelMode}:${directionBucket}:${prevPoiId || 'none'}:${nextPoiId || 'none'}`;
    const msgUint8 = new TextEncoder().encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    let body: any = null;
    try {
        body = await req.json();
        const { poi_id, language, voice_name = "Puck", force = false } = body;
        const lang = (language || 'pt-br').toLowerCase();

        if (!poi_id) {
            return new Response(JSON.stringify({ success: false, error: "Missing required parameter: poi_id" }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // 1. Generate Cache Key (Master Key: POI + Lang)
        const cacheKey = await generateCacheKey(
            poi_id,
            lang,
            'master', // Fixed context for master
            'any',    // Fixed bucket
            undefined, 
            undefined
        );

        // 2. CACHE CHECK (Priority 1: JIT Cache)
        // Skip cache if 'force' is true
        if (!force) {
            const { data: cached } = await supabaseAdmin
                .schema('core')
                .from('cache_narrations')
                .select('*')
                .eq('cache_key', cacheKey)
                .gt('expires_at', new Date().toISOString())
                .maybeSingle();

            if (cached && cached.audio_url) {
                console.log(`[Cache Hit] Returning JIT audio for ${poi_id}`);
                return new Response(JSON.stringify({
                    success: true,
                    data: {
                        audio_url: cached.audio_url,
                        text_content: cached.text_content,
                        meta: { cache: 'hit', type: 'jit' }
                    }
                }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
        } else {
             console.log(`[Force Generation] Bypassing cache for ${poi_id}`);
        }

        // 3. FETCH SOURCE MATERIAL
        let { data: poiData } = await supabaseAdmin.schema('core')
            .from('attraction_descriptions')
            .select('*')
            .eq('attraction_id', poi_id)
            .eq('language', lang)
            .maybeSingle();

        // Fallback: If target language not found, try 'pt-br' as source material
        if (!poiData && lang !== 'pt-br') {
            const { data: fallbackData } = await supabaseAdmin.schema('core')
            .from('attraction_descriptions')
            .select('*')
            .eq('attraction_id', poi_id)
            .eq('language', 'pt-br')
            .maybeSingle();
            
            if (fallbackData) {
                console.log(`[Source Fallback] Using 'pt-br' source for '${lang}' generation.`);
                poiData = fallbackData;
            }
        }

        // 3. FETCH SOURCE MATERIAL (SSOT from DB)
        // We fetch the POI basics (name, city, country) for the prompt
        // THIS IS THE CRITICAL CHECK: We need to know WHAT the POI is.
        const { data: poiDetails } = await supabaseAdmin.schema('core')
             .from('attractions')
             .select('name, city, country, category')
             .eq('id', poi_id)
             .maybeSingle();

        if (!poiDetails) {
             throw new Error("POI not found in database (attractions table).");
        }

        let descriptionSource = poiData?.description || "";
        let factsPackSource = poiData?.facts_pack_json;

        // If no description exists, we are generating from scratch.
        if (!descriptionSource) {
             console.log(`[Bootstrap] No existing description for ${poi_id}. Generating from scratch using POI Name/Location.`);
        }

        // If 'force' is true, we might want to ignore existing source text if we had a way to get "Raw" data.
        // But currently the best "Raw" data we have might be the cached Google Data or just the Name/City.
        // Let's assume the goal is to Re-write/Refine the description into "Native Narration".

        // 3.6. Metadata placeholders (Master Mode)
        // Since we don't have user context, we don't calculate distances/recency.
        let timeSinceLastPoiStr = "N/A";
        let distanceSinceLastPoi = "N/A";
        let isRecentlyPlayed = false;
        let distanceToNextPoi = "N/A";

        // 4. LOGIC: NO CONTEXT FALLBACK & MASTER CHECK
        // If no previous OR next POI id is provided, we check if the MASTER (Generic) content is already available.
        // 4. LOGIC: MASTER CHECK
        // If not forced and we have data, we returned cache above (Step 2).
        // However, we double check if we have data in the DB that matches what we want.
        if (!force && poiData) {
            console.log(`[Validation] Checking existing Master content availability for ${poi_id}`);
            if (poiData.description && poiData.audio_url) {
                console.log(`[Master Hit] Generic audio already exists. Skipping Gemini generation.`);
                return new Response(JSON.stringify({
                    success: true,
                    data: {
                        audio_url: poiData.audio_url,
                        text_content: poiData.description,
                        meta: { cache: 'hit', type: 'master' }
                    }
                }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
        }

        // 5. GENERATION (Gemini 2.5 Flash Native Audio - Master Mode)
        
        const prompt = `
ROLE: Expert Travel Guide.
TONE: Historical, Premium, Deeply informative, yet spoken naturally.
LANGUAGE: ${lang}

TARGET POI: "${poiDetails.name}" in ${poiDetails.city}, ${poiDetails.country}.

SOURCE MATERIAL (Essential Facts Only):
"${descriptionSource}"
${factsPackSource ? `Bonus details: ${JSON.stringify(factsPackSource)}` : ''}

GOAL: Create a "Master Description" audio script.
STRICT NARRATION RULES:
1. START with the name and importance of the place.
2. DO NOT include external facts, city history, or general knowledge not present in the SOURCE MATERIAL.
3. BE CONCISE: The final script MUST be around 23-30 seconds of natural speech.
4. FLUIDITY: Create a single, premium story suitable for a general introduction.
5. NO REPETITION: Do not repeat the POI name excessively.
`;

        // We use the non-streaming REST API for simplicity in this version, 
        // but we will send the response as soon as we get the audio from Gemini.
        // Actually, to achieve "millisecond" streaming, we'd need chunks.
        // Since Gemini Native Audio REST API often returns a single candidate with the full audio,
        // the "streaming" benefit comes from NOT waiting for the Storage Upload to finish.

        const geminiStartTime = Date.now();
        const geminiResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        // responseModalities: ["AUDIO"], // Disabled due to 400 Error: Model does not support requested modality
                        // speechConfig: { ... }
                    }
                })
            }
        );

        if (!geminiResponse.ok) {
            const errBody = await geminiResponse.text();
            console.error(`[Gemini Error]`, errBody);
            // Include a small part of the error body in the error message for the fallback JSON
            throw new Error(`Gemini Generation Failed: ${geminiResponse.statusText} - ${errBody.substring(0, 100)}`);
        }

        const result = await geminiResponse.json();
        const parts = result.candidates?.[0]?.content?.parts || [];

        // Find text part (Now the primary output)
        const textPart = parts.find((p: any) => p.text);
        let textContent = textPart?.text || "";

        if (!textContent) {
             // Fallback to source if generation completely failed to produce text (unlikely)
             console.warn("[Gemini] No text generated, using source.");
             textContent = descriptionSource;
        }
        
        // Clean up the text (Markdown, etc)
        textContent = textContent.replace(/\*\*/g, '').replace(/\*/g, '').trim();

        console.log(`[Gemini Success] Generated Text: ${textContent.substring(0, 50)}...`);

        // 5.5. HYBRID: Generate Audio using Google TTS (Fallback for Native limitation)
        // We use the generated text to create the audio found at the end of the pipeline
        console.log(`[Hybrid] Generating audio via TTS for: ${textContent.substring(0, 20)}...`);
        const ttsBuffer = await generateAudioWithTTS(
            textContent,
            lang,
            'male', // Default valid gender for TTS function
            GOOGLE_TTS_API_KEY
        );
        
        const audioBuffer = new Uint8Array(ttsBuffer);
        const geminiDuration = Date.now() - geminiStartTime;
        console.log(`[Hybrid Success] Generated ${audioBuffer.byteLength} bytes in ${geminiDuration}ms`);

        // 6. STORAGE & METADATA (Background)
        const fileName = `${poi_id}/${cacheKey}.mp3`;
        const storagePath = `contextual_audio/${fileName}`;
        const publicUrl = `${PROJECT_URL}/storage/v1/object/public/travel-app-audios/${storagePath}`;

        const backgroundTask = (async () => {
            try {
                // Upload to Storage
                await supabaseAdmin.storage
                    .from('travel-app-audios')
                    .upload(storagePath, audioBuffer, { contentType: 'audio/mpeg', upsert: true });

                const expiresAt = new Date();
                expiresAt.setDate(expiresAt.getDate() + 30);

                // Save to JIT Cache (Master Mode entries are also effective cache)
                await supabaseAdmin.schema('core').from('cache_narrations').upsert({
                    cache_key: cacheKey,
                    poi_id: poi_id,
                    language: lang,
                    travel_mode: 'drive', // Default for master
                    direction_bucket: 'any', // Default for master
                    text_content: textContent,
                    audio_url: publicUrl,
                    expires_at: expiresAt.toISOString()
                });

                // Update Master Description/Facts in DB
                await supabaseAdmin.schema('core').from('attraction_descriptions').upsert({
                    attraction_id: poi_id,
                    language: lang,
                    description: textContent,
                    audio_url: publicUrl,
                    // If we generated fresh facts we would save them here, but for now we preserved or used null.
                    // Ideally we should extract facts from Gemini response if valid JSON.
                    updated_at: new Date().toISOString()
                }, { onConflict: 'attraction_id,language' });
                
                console.log(`[Background] Storage and DB (Master) updated for ${poi_id}`);
            } catch (error) {
                console.error(`[Background Task Failed]`, error);
            }
        })();

        // @ts-ignore
        if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(backgroundTask);

        // 7. RETURN JSON (CMS Friendly)
        // We return the generated text and audio URL.
        
        return new Response(JSON.stringify({
            success: true,
            data: {
                description: textContent,
                audio_url: publicUrl,
                facts: factsPackSource || [], 
                meta: { type: 'master', generated: true }
            }
        }), {
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
            }
        });

    } catch (e) {
        console.error('Narrator Internal Error:', e);

        // FINAL FALLBACK: If everything fails, try to return Master audio if it exists
        try {
            if (body && body.poi_id) {
                const { poi_id, language } = body;
                const { data: fallbackData } = await supabaseAdmin.schema('core')
                    .from('attraction_descriptions')
                    .select('*')
                    .eq('attraction_id', poi_id)
                    .eq('language', (language || 'pt-br').toLowerCase())
                    .maybeSingle();

                if (fallbackData?.audio_url) {
                    console.log(`[Emergency Fallback] Returning Master audio for ${poi_id}`);
                    return new Response(JSON.stringify({
                        success: true,
                        data: {
                            audio_url: fallbackData.audio_url,
                            text_content: fallbackData.description,
                            meta: { fallback: true, error: String(e) }
                        }
                    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
                }
            }
        } catch (fallbackError) {
            console.error('[Double Failure]', fallbackError);
        }

        return new Response(JSON.stringify({ success: false, error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
});
