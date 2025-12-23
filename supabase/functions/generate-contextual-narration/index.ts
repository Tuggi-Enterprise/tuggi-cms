import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateNarrativeScript } from '../_shared/contextualGenerator.ts';
import { generateAudioWithTTS } from '../_shared/ttsGenerator.ts';

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
    target_poi: {
        id: string;
        name?: string;
        type?: string;
        bearing: number;
        distance: number;
    };
    travel_mode: string;
    user_context: {
        location: { latitude: number; longitude: number };
        speed: number;
        heading: number;
        language: string;
        previous_poi?: {
            name: string;
            type: string;
            played_at: string;
        };
        next_poi?: {
            name: string;
            type: string;
        };
    };
}

function getDirectionBucket(heading: number, bearing: number): string {
    const diff = ((bearing - heading + 180) % 360) - 180;
    if (diff > 45 && diff < 135) return "right";
    if (diff < -45 && diff > -135) return "left";
    if (Math.abs(diff) >= 135) return "behind";
    return "ahead";
}

async function generateCacheKey(poiId: string, language: string, travelMode: string, directionBucket: string, prevPoiName: string | undefined, nextPoiName: string | undefined): Promise<string> {
    const data = `${poiId}:${language}:${travelMode}:${directionBucket}:${prevPoiName || 'none'}:${nextPoiName || 'none'}`;
    const msgUint8 = new TextEncoder().encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const body = await req.json() as RequestBody;
        const { action, target_poi, travel_mode, user_context } = body;
        const language = (user_context.language || 'pt-br').toLowerCase();

        if (!target_poi?.id || !user_context) throw new Error("Missing inputs");

        // 1. Generate Stable Hash
        const directionBucket = getDirectionBucket(user_context.heading, target_poi.bearing);
        const cacheKey = await generateCacheKey(
            target_poi.id,
            language,
            travel_mode,
            directionBucket,
            user_context.previous_poi?.name,
            user_context.next_poi?.name
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

        // Step A: Master Content (Read Only)
        // This function NO LONGER generates Master data. It ONLY reads from attraction_descriptions.
        // Step A must be performed by the 'generate-description' function or the CMS.
        if (!textContent) {
            const { data: poiData } = await supabaseAdmin.schema('core')
                .from('attraction_descriptions')
                .select('*')
                .eq('attraction_id', target_poi.id)
                .eq('language', language)
                .maybeSingle();

            if (!poiData || !poiData.description) {
                console.error(`[Contextual Narration] Master content missing for ${target_poi.id}. Please run generate-description first.`);
                throw new Error("Contéudo base não encontrado. Gere a descrição mestre primeiro.");
            }

            const factsPack = poiData.facts_pack_json;
            const description = poiData.description;


            // Step B: Contextual Script
            textContent = await generateNarrativeScript(
                { ...user_context, travel_mode, language },
                { description, facts_pack_json: factsPack },
                {
                    name: target_poi.name || "POI",
                    type: target_poi.type || "POI",
                    bearing: target_poi.bearing,
                    distance: target_poi.distance
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
