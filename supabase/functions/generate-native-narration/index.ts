import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with, accept, origin, referer, user-agent',
};

const PROJECT_URL = Deno.env.get('PROJECT_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || '';
const GEMINI_API_KEY = Deno.env.get('GOOGLE_GEMINI_API_KEY') || Deno.env.get('GEMINI_API_KEY') || '';

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
        const { poi_id, language, travel_mode, user_context, voice_name = "Puck" } = body;
        const lang = (language || 'pt-br').toLowerCase();

        // New context fields from request
        const prevPoiId = user_context.previous_poi_id;
        const nextPoiId = user_context.next_poi_id;
        const nextPoiBearing = user_context.next_poi_bearing;
        const lastVisitTimestamp = user_context.last_visit_timestamp;

        const currLoc = user_context.current_location; // { lat, lng }
        const prevLoc = user_context.last_poi_location; // { lat, lng }
        const nextLoc = user_context.next_poi_location; // { lat, lng }

        if (!poi_id || !user_context) {
            return new Response(JSON.stringify({ success: false, error: "Missing required parameters (poi_id or user_context)" }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // 1. Generate Cache Key (Refined with Prev/Next IDs)
        const directionBucket = getDirectionBucket(user_context.heading, user_context.bearing);
        const cacheKey = await generateCacheKey(
            poi_id,
            lang,
            travel_mode || 'drive',
            directionBucket,
            prevPoiId,
            nextPoiId
        );

        // 2. CACHE CHECK (Priority 1: JIT Cache)
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

        // 3. FETCH SOURCE MATERIAL
        const { data: poiData } = await supabaseAdmin.schema('core')
            .from('attraction_descriptions')
            .select('*')
            .eq('attraction_id', poi_id)
            .eq('language', lang)
            .maybeSingle();

        if (!poiData) {
            throw new Error("POI source material not found.");
        }

        // 3.5. FETCH NAMES FOR CONTEXT (Optional but improves prompt)
        let prevPoiName = null;
        let nextPoiName = null;
        let nextDirectionBucket = null;

        if (prevPoiId) {
            const { data: prevData } = await supabaseAdmin.schema('core').from('attractions').select('name').eq('id', prevPoiId).maybeSingle();
            prevPoiName = prevData?.name;
        }

        if (nextPoiId) {
            const { data: nextData } = await supabaseAdmin.schema('core').from('attractions').select('name').eq('id', nextPoiId).maybeSingle();
            nextPoiName = nextData?.name;

            if (nextPoiBearing !== undefined) {
                nextDirectionBucket = getDirectionBucket(user_context.heading, nextPoiBearing);
            }
        }

        // 3.6. CALCULATE RECENCY & DISTANCE
        let timeSinceLastPoiStr = "unknown";
        let distanceSinceLastPoi = "unknown";
        let isRecentlyPlayed = false;

        if (lastVisitTimestamp) {
            const ms = Date.now() - new Date(lastVisitTimestamp).getTime();
            const mins = Math.floor(ms / 60000);
            timeSinceLastPoiStr = mins > 0 ? `${mins} minutes` : `less than a minute`;

            if (currLoc && prevLoc) {
                const dist = calculateDistance(currLoc.lat, currLoc.lng, prevLoc.lat, prevLoc.lng);
                distanceSinceLastPoi = dist < 1000 ? `${Math.round(dist)} meters` : `${(dist / 1000).toFixed(1)} km`;

                // Logic: If under 3 mins, or under 7 mins but distance is low (< 500m), it's "recent" (traffic)
                if (mins < 3) isRecentlyPlayed = true;
                else if (mins < 7 && dist < 500) isRecentlyPlayed = true;
            } else if (mins < 3) {
                isRecentlyPlayed = true; // Fallback to time only if loc missing
            }
        }

        let distanceToNextPoi = "unknown";
        if (currLoc && nextLoc) {
            const dist = calculateDistance(currLoc.lat, currLoc.lng, nextLoc.lat, nextLoc.lng);
            distanceToNextPoi = dist < 1000 ? `${Math.round(dist)} meters` : `${(dist / 1000).toFixed(1)} km`;
        }

        // 4. LOGIC: NO CONTEXT FALLBACK & MASTER CHECK
        // If no previous OR next POI id is provided, we check if the MASTER (Generic) content is already available.
        if (!prevPoiId && !nextPoiId) {
            console.log(`[No Context] Checking Master availability for ${poi_id}`);
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
            console.log(`[Master Miss] Content missing in database. Proceeding with JIT "Security Plan" generation.`);
        }

        // 5. GENERATION (Gemini 2.5 Flash Native Audio - Streaming)
        // If we reach here, we need to generate new content.
        const isMasterGeneration = !prevPoiId && !nextPoiId;

        const prompt = `
ROLE: Expert Travel Guide.
TONE: ${isMasterGeneration ? 'Historical, Premium, Deeply informative' : 'Premium, Professional, Engaging, Vivid'}
LANGUAGE: ${lang}

CURRENT TARGET POI: "${poi_id}"
LOCATION RELATIVE TO USER: ${directionBucket}
TRAVEL MODE: ${travel_mode || 'drive'}

${!isMasterGeneration ? `CONTEXTUAL HOOKS:
${prevPoiId ? `- Previous POI: "${prevPoiName || prevPoiId}". Recency: ${timeSinceLastPoiStr}. Distance since then: ${distanceSinceLastPoi}. 
  Rule: ${isRecentlyPlayed ? 'User just left it (or is in traffic nearby). Use a smooth bridge.' : 'User has been traveling for a while since then. Mention only if relevant to the new context.'}` : ''}
${nextPoiId ? `- Next POI: "${nextPoiName || nextPoiId}". Distance ahead: ${distanceToNextPoi}. ${nextDirectionBucket ? `(located ${nextDirectionBucket})` : ''} 
  Rule: Inform the user this is likely their next stop if they continue.` : ''}` : 'STRICT FOCUS: This is a standalone narration. Focus on the historical importance and beauty of the site.'}

SOURCE MATERIAL (Essential Facts Only):
"${poiData.description}"
${poiData.facts_pack_json ? `Bonus details: ${JSON.stringify(poiData.facts_pack_json)}` : ''}

STRICT NARRATION RULES:
1. START immediately ${isMasterGeneration ? 'with the name and importance of the place' : `with a navigational hook (e.g., "Logo à sua frente...", "À sua direita...", "Em instantes chegaremos ao...")`}.
2. DO NOT include external facts, city history, or general knowledge not present in the SOURCE MATERIAL.
3. BE CONCISE: The final script MUST be around 23-30 seconds of natural speech.
4. FLUIDITY: Combine the hook, the core description, and the transition into a single, premium story.
5. NO REPETITION: Do not repeat the POI name excessively.
`;

        // We use the non-streaming REST API for simplicity in this version, 
        // but we will send the response as soon as we get the audio from Gemini.
        // Actually, to achieve "millisecond" streaming, we'd need chunks.
        // Since Gemini Native Audio REST API often returns a single candidate with the full audio,
        // the "streaming" benefit comes from NOT waiting for the Storage Upload to finish.

        const geminiStartTime = Date.now();
        const geminiResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-native-audio-dialog:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        response_modalities: ["AUDIO"],
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: {
                                    voiceName: voice_name
                                }
                            }
                        }
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

        // Find the part that contains audio data
        const audioPart = parts.find((p: any) => p.inlineData && (p.inlineData.mimeType?.startsWith('audio/') || p.inlineData.data));
        const base64Audio = audioPart?.inlineData?.data;

        // Find text part for transcript if available
        const textPart = parts.find((p: any) => p.text);
        const textContent = (textPart?.text || poiData.description).substring(0, 300) + "...";

        if (!base64Audio) throw new Error("No audio data");

        const audioBuffer = Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0));
        const geminiDuration = Date.now() - geminiStartTime;
        console.log(`[Gemini Success] Generated ${audioBuffer.byteLength} bytes in ${geminiDuration}ms`);

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

                // Save to JIT Cache
                await supabaseAdmin.schema('core').from('cache_narrations').upsert({
                    cache_key: cacheKey,
                    poi_id: poi_id,
                    language: lang,
                    travel_mode: travel_mode || 'drive',
                    direction_bucket: directionBucket,
                    text_content: textContent,
                    audio_url: publicUrl,
                    expires_at: expiresAt.toISOString()
                });

                // Update Master if needed
                if (isMasterGeneration) {
                    await supabaseAdmin.schema('core').from('attraction_descriptions').update({
                        audio_url: publicUrl,
                        updated_at: new Date().toISOString()
                    }).eq('attraction_id', poi_id).eq('language', lang);
                }
                console.log(`[Background] Storage and DB updated for ${cacheKey}`);
            } catch (error) {
                console.error(`[Background Task Failed]`, error);
            }
        })();

        // @ts-ignore
        if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(backgroundTask);

        // 7. RETURN STREAMING-READY RESPONSE
        // Instead of waiting for background tasks, we return the audio bytes immediately.
        // We pass metadata in headers so the body can be raw audio.
        return new Response(audioBuffer, {
            headers: {
                ...corsHeaders,
                'Content-Type': 'audio/mpeg',
                'X-Narration-Text': btoa(encodeURIComponent(textContent)),
                'X-Narration-Type': isMasterGeneration ? 'master' : 'jit',
                'X-Narration-Cache': 'miss',
                'X-Gemini-Latency': geminiDuration.toString()
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
