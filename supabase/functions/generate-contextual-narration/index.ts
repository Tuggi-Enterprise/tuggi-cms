import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateNarrativeScript } from '../_shared/contextualGenerator.ts';
import { generateAudioWithTTS } from '../_shared/ttsGenerator.ts';
import { getDirectionBucket } from '../_shared/utils.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with, accept, origin, referer, user-agent',
};

const PROJECT_URL = Deno.env.get('PROJECT_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || '';
const GEMINI_API_KEY = Deno.env.get('GOOGLE_GEMINI_API_KEY') || Deno.env.get('GEMINI_API_KEY') || '';
const GOOGLE_TTS_API_KEY = Deno.env.get('GOOGLE_TTS_API_KEY') || Deno.env.get('GOOGLE_CLOUD_API_KEY') || '';

const supabaseAdmin = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

interface RequestBody {
    action: 'generate_text' | 'generate_audio';
    poi_id?: string; // App root field
    poi_type?: string; // App root field
    bearing?: number; // App root field
    distance?: number; // App root field
    next_poi_id?: string; // App root field
    next_poi_type?: string; // App root field
    target_poi?: {
        id: string;
        name?: string;
        type?: string;
        bearing: number;
        distance: number;
        location: { latitude: number; longitude: number };
    };
    travel_mode: string;
    user_context: {
        location?: { latitude: number; longitude: number };
        speed: number;
        heading: number;
        language: string;
        previous_poi?: {
            id: string;
            name: string;
            type: string;
            played_at: string;
            location: { latitude: number; longitude: number };
        };
        next_poi?: {
            id: string;
            name: string;
            type: string;
            bearing: number;
            location: { latitude: number; longitude: number };
        };
        next_predicted_poi?: {
            id: string;
            name?: string;
            type?: string;
            distance?: number;
            bearing?: number;
            location?: { latitude: number; longitude: number };
        };
    };
}


async function generateCacheKey(poiId: string, poiType: string, language: string, travelMode: string, directionBucket: string, prevPoiId: string | undefined, nextPoiId: string | undefined, nextPoiType: string | undefined): Promise<string> {
    const data = `${poiId}:${poiType}:${language}:${travelMode}:${directionBucket}:${prevPoiId || 'none'}:${nextPoiId || 'none'}:${nextPoiType || 'none'}`;
    const msgUint8 = new TextEncoder().encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const body = await req.json() as RequestBody;
        let { action, target_poi, travel_mode, user_context } = body;
        const language = (user_context?.language || 'pt-br').toLowerCase();

        // NORMALIZE: Handle fields at root level from mobile app
        if (!target_poi && body.poi_id) {
            target_poi = {
                id: body.poi_id,
                type: body.poi_type || 'tuggi',
                bearing: body.bearing || 0,
                distance: body.distance || 0,
                location: user_context?.location || { latitude: 0, longitude: 0 }
            };
        }

        if (!target_poi?.id || !user_context) throw new Error("Missing inputs (target_poi.id or user_context)");

        // NORMALIZE: Handle previous_poi from multiple potential sources
        if (!user_context.previous_poi) {
            // Priority 1: Root object
            // @ts-ignore
            if (body.previous_poi && body.previous_poi.id) {
                // @ts-ignore
                user_context.previous_poi = body.previous_poi;
            }
            // Priority 2: Root IDs
            // @ts-ignore
            else if (body.previous_poi_id || body.last_poi_id) {
                // @ts-ignore
                const prevId = body.previous_poi_id || body.last_poi_id;
                user_context.previous_poi = {
                    id: prevId!,
                    name: "Previous Stop", // Will be enriched from DB later
                    type: "tuggi",
                    played_at: new Date().toISOString(),
                    location: { latitude: 0, longitude: 0 }
                };
            }
        }

        // Normalize next_poi from app's next_predicted_poi or root next_poi_id
        if (body.next_poi_id && !user_context.next_poi) {
            user_context.next_poi = {
                id: body.next_poi_id,
                name: "POI",
                type: body.next_poi_type || "tuggi",
                bearing: 0,
                location: { latitude: 0, longitude: 0 }
            };
        } else if (user_context.next_predicted_poi && !user_context.next_poi) {
            user_context.next_poi = {
                id: user_context.next_predicted_poi.id,
                name: user_context.next_predicted_poi.name || "POI",
                type: user_context.next_predicted_poi.type || "POI",
                bearing: user_context.next_predicted_poi.bearing || 0,
                location: user_context.next_predicted_poi.location || { latitude: 0, longitude: 0 }
            };
        }

        // 1. Generate Stable Hash
        const directionBucket = getDirectionBucket(user_context.heading, target_poi.bearing);
        const cacheKey = await generateCacheKey(
            target_poi.id,
            target_poi.type || 'tug',
            language,
            travel_mode,
            directionBucket,
            user_context.previous_poi?.id,
            user_context.next_poi?.id,
            user_context.next_poi?.type
        );

        // 2. CACHE CHECK (Priority 1)
        const { data: cached } = await supabaseAdmin
            .schema('core')
            .from('cache_narrations')
            .select('*')
            .eq('cache_key', cacheKey)
            .gt('expires_at', new Date().toISOString())
            .maybeSingle();

        // HIT: Return immediately (Lazy Audio Logic)
        if (cached) {
            if (action === 'generate_audio' && !cached.audio_url) {
                // Keep going to MISS audio generation part
            } else {
                return new Response(JSON.stringify({
                    success: true,
                    data: {
                        text_content: cached.text_content,
                        audio_url: cached.audio_url
                    }
                }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
        }

        // MISS: Execution Pipeline
        console.log(`[Cache Miss] Generating for ${target_poi.id} Action: ${action}`);

        let textContent = cached?.text_content;

        if (!textContent) {
            console.log(`[Full Gen] No valid text found for ${target_poi.id}. Calling Gemini...`);
            // Step A: Fetch Rich Context for ALL POIs in the arc
            const [targetData, prevData, nextData] = await Promise.all([
                supabaseAdmin.schema('core').from('attraction_descriptions').select('*').eq('attraction_id', target_poi.id).eq('language', language).maybeSingle(),
                user_context.previous_poi ? supabaseAdmin.schema('core').from('attraction_descriptions').select('*').eq('attraction_id', user_context.previous_poi.id).eq('language', language).maybeSingle() : Promise.resolve({ data: null }),
                user_context.next_poi ? supabaseAdmin.schema('core').from('attraction_descriptions').select('*').eq('attraction_id', user_context.next_poi.id).eq('language', language).maybeSingle() : Promise.resolve({ data: null })
            ]);

            if (!targetData.data || !targetData.data.description) {
                const errorMsg = `[Contextual Narration] Base content missing for target_poi: ${target_poi.id} (${target_poi.name}). Triggering auto-generation in background...`;
                console.warn(errorMsg);

                // Auto-Heal Trigger: Call generate-description in background
                const generateDescriptionUrl = `${PROJECT_URL}/functions/v1/generate-description`;
                const autoHealTask = (async () => {
                    try {
                        console.log(`[Auto-Heal] Starting background generation for ${target_poi.id}...`);
                        const resp = await fetch(generateDescriptionUrl, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${SERVICE_ROLE_KEY}`
                            },
                            body: JSON.stringify({ poi_id: target_poi.id, language: language })
                        });
                        console.log(`[Auto-Heal] Status for ${target_poi.id}: ${resp.status}`);
                    } catch (err) {
                        console.error(`[Auto-Heal] Background trigger failed for ${target_poi.id}:`, err);
                    }
                })();

                // Ensure the response isn't blocked but the background task has a chance to finish in Deno
                // @ts-ignore
                if (typeof EdgeRuntime !== 'undefined') { EdgeRuntime.waitUntil(autoHealTask); }

                return new Response(JSON.stringify({
                    success: false,
                    error: "BASE_CONTENT_MISSING",
                    poi_id: target_poi.id
                }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }

            // Step B: Contextual Script Generation with full arc data
            textContent = await generateNarrativeScript(
                {
                    ...user_context,
                    travel_mode,
                    language,
                    poi_location: target_poi.location,
                    bearing: target_poi.bearing,
                    // Pass full database details for the generator to use
                    target_details: {
                        name: targetData.data.attraction_name || target_poi.name || "POI",
                        description: targetData.data.description,
                        facts: targetData.data.facts_pack_json
                    },
                    previous_details: prevData.data ? {
                        name: prevData.data.attraction_name || user_context.previous_poi?.name || "POI",
                        description: prevData.data.description,
                        facts: prevData.data.facts_pack_json
                    } : undefined,
                    next_details: nextData.data ? {
                        name: nextData.data.attraction_name || user_context.next_poi?.name || "POI",
                        description: nextData.data.description,
                        facts: nextData.data.facts_pack_json
                    } : undefined
                },
                GEMINI_API_KEY
            );

            // Save to Cache (TEXT ONLY)
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 30);

            const { error: upsertErr } = await supabaseAdmin.schema('core').from('cache_narrations').upsert({
                cache_key: cacheKey,
                poi_id: target_poi.id,
                language: language,
                travel_mode: travel_mode,
                direction_bucket: directionBucket,
                text_content: textContent,
                expires_at: expiresAt.toISOString()
            });

            if (upsertErr) {
                console.error('[Cache Save Error] Failed to save text:', upsertErr);
            }
        }

        // Step C: Audio (Lazy)
        let audioUrl = cached?.audio_url || null;

        if (action === 'generate_audio' && !audioUrl) {
            console.log('[Audio Gen] Generating TTS (Male Voice)...');
            if (!GOOGLE_TTS_API_KEY) throw new Error("GOOGLE_TTS_API_KEY is missing");
            const audioBuffer = await generateAudioWithTTS(textContent, language, 'male', GOOGLE_TTS_API_KEY);

            // Upload
            const fileName = `${target_poi.id}/${cacheKey}.mp3`;
            const { data: uploadData, error: upErr } = await supabaseAdmin.storage
                .from('travel-app-audios')
                .upload(`contextual_audio/${fileName}`, audioBuffer, { contentType: 'audio/mpeg', upsert: true });

            if (upErr) throw upErr;

            const { data: { publicUrl } } = supabaseAdmin.storage
                .from('travel-app-audios')
                .getPublicUrl(`contextual_audio/${fileName}`);

            audioUrl = publicUrl;

            // Update Cache with Audio URL
            await supabaseAdmin.schema('core').from('cache_narrations').update({
                audio_url: audioUrl
            }).eq('cache_key', cacheKey);
        }

        return new Response(JSON.stringify({
            success: true,
            data: {
                text_content: textContent,
                audio_url: audioUrl
            }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } catch (e) {
        console.error('Narrator Error:', e);
        return new Response(JSON.stringify({ success: false, error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
});
