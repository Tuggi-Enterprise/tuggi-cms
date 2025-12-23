import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateMasterPack } from '../_shared/masterPackGenerator.ts';
import { generateAudioWithTTS } from '../_shared/ttsGenerator.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with, accept, origin, referer, user-agent',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';
const GEMINI_API_KEY = Deno.env.get('GOOGLE_GEMINI_API_KEY') || Deno.env.get('GEMINI_API_KEY') || '';
const GOOGLE_TTS_API_KEY = Deno.env.get('GOOGLE_TTS_API_KEY') || Deno.env.get('GOOGLE_CLOUD_API_KEY') || '';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface RequestBody {
    poi_id: string;
    language: string;
    raw_context?: string;
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const { poi_id, language: rawLanguage, raw_context } = await req.json() as RequestBody;
        const language = (rawLanguage || "pt-br").toLowerCase();
        if (!poi_id) throw new Error("poi_id required");

        console.log(`[Generate-Description] Starting for POI: ${poi_id}`);

        // Simplified query to avoid join failures
        const { data: attraction, error: attrError } = await supabaseAdmin.schema('core')
            .from('attractions')
            .select('name, city, state, osm_tags')
            .eq('id', poi_id)
            .single();

        if (attrError || !attraction) throw new Error("POI not found in database");

        const cityName = attraction.city || attraction.osm_tags?.['addr:city'] || (attraction.state ? `${attraction.state}, Brazil` : "Brazil");

        const result = await generateMasterPack(
            attraction.name,
            cityName,
            raw_context || "Generation triggered by CMS/Service",
            language,
            GEMINI_API_KEY
        );

        // Update DB - This is the SOLE place where attraction_descriptions should be updated
        // Save description and facts first
        const { error: upsertError } = await supabaseAdmin.schema('core').from('attraction_descriptions').upsert({
            attraction_id: poi_id,
            language: language,
            gender: 'male', // Default gender for master descriptions
            facts_pack_json: result.facts_pack_json,
            description: result.description,
            updated_at: new Date().toISOString(),
            verification_status: 'approved',
            facts_version: 2
        }, { onConflict: 'attraction_id,language,gender' });

        if (upsertError) throw new Error(`DB Error: ${upsertError.message}`);

        // Background Audio Generation (Step C - Master Audio)
        const audioTask = (async () => {
            try {
                if (!GOOGLE_TTS_API_KEY) {
                    console.warn("[Generate-Description] Background TTS skipped: GOOGLE_TTS_API_KEY missing");
                    return;
                }
                console.log(`[Generate-Description] Background TTS starting for ${poi_id}...`);
                const audioBuffer = await generateAudioWithTTS(result.description, language, 'male', GOOGLE_TTS_API_KEY);

                const fileName = `${poi_id}-${language}-male.mp3`;
                const storagePath = `master_audio/${poi_id}/${fileName}`;

                const { error: uploadError } = await supabaseAdmin.storage
                    .from('travel-app-audios')
                    .upload(storagePath, audioBuffer, {
                        contentType: 'audio/mpeg',
                        upsert: true
                    });

                if (uploadError) throw new Error(`Upload Error: ${uploadError.message}`);

                const { data: { publicUrl } } = supabaseAdmin.storage
                    .from('travel-app-audios')
                    .getPublicUrl(storagePath);

                await supabaseAdmin.schema('core').from('attraction_descriptions').update({
                    audio_url: publicUrl
                }).eq('attraction_id', poi_id).eq('language', language).eq('gender', 'male');

                console.log(`[Generate-Description] Background TTS success: ${publicUrl}`);
            } catch (err) {
                console.error(`[Generate-Description] Background TTS failed for ${poi_id}:`, err);
            }
        })();

        // Use waitUntil if available (Supabase/Deno Deploy specific)
        // @ts-ignore: EdgeRuntime is available in Supabase Edge Functions
        if (typeof EdgeRuntime !== 'undefined') {
            // @ts-ignore
            EdgeRuntime.waitUntil(audioTask);
        }

        console.log(`[Generate-Description] Text success for ${poi_id}`);

        return new Response(JSON.stringify({ success: true, data: result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } catch (e) {
        console.error(`[Generate-Description] Error:`, e);
        return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
});
