import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateMasterPack } from '../_shared/masterPackGenerator.ts';
import { translateWithGemini } from '../_shared/translationUtility.ts';
import { generateAudioWithTTS } from '../_shared/ttsGenerator.ts';
import { calculateHeuristicScore } from '../_shared/scoring.ts';

// Helper for hashing
async function hashDescription(text: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

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
    gender?: 'male' | 'female';
    generate_audio?: boolean;
    raw_context?: string;
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const body = await req.json() as RequestBody & { force?: boolean };
        const { poi_id, language: rawLanguage, raw_context, force, gender, generate_audio } = body;
        const language = (rawLanguage || "pt-br").toLowerCase();
        const voiceGender = gender || 'male';
        const shouldGenerateAudio = generate_audio !== false; // Default to true
        if (!poi_id) throw new Error("poi_id required");

        console.log(`[Generate-Description] Starting for POI: ${poi_id}`);

        // 1. Check for existing content and its age
        const { data: existing } = await supabaseAdmin.schema('core')
            .from('attraction_descriptions')
            .select('updated_at, facts_pack_json, description, audio_url')
            .eq('attraction_id', poi_id)
            .eq('language', language)
            .eq('gender', voiceGender)
            .maybeSingle();

        const isStale = existing && (new Date().getTime() - new Date(existing.updated_at).getTime() > 1000 * 60 * 60 * 24 * 30);
        const missingFacts = !existing || !existing.facts_pack_json || (Array.isArray(existing.facts_pack_json) && existing.facts_pack_json.length === 0);

        if (existing && !force && !isStale && !missingFacts) {
            console.log(`[Generate-Description] Skipping: Content is fresh (<30d) and has facts.`);
            return new Response(JSON.stringify({
                success: true,
                message: "Content is already fresh",
                data: { description: existing.description, facts_pack_json: existing.facts_pack_json, audio_url: existing.audio_url }
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // 2. Fetch POI Details
        const { data: attraction, error: attrError } = await supabaseAdmin.schema('core')
            .from('attractions')
            .select('name, city, state, osm_tags')
            .eq('id', poi_id)
            .single();

        if (attrError || !attraction) throw new Error("POI not found in database");

        const cityName = attraction.city || attraction.osm_tags?.['addr:city'] || (attraction.state ? `${attraction.state}, Brazil` : "Brazil");

        let result;

        // 2.1 Master Fallback Logic
        if (language !== 'pt-br') {
            console.log(`[Generate-Description] Target language is ${language}, checking for master context...`);
            
            // Try to find PT-BR master first, fallback to first available
            const { data: candidates } = await supabaseAdmin.schema('core')
                .from('attraction_descriptions')
                .select('description, facts_pack_json, language')
                .eq('attraction_id', poi_id)
                .limit(5);

            const master = candidates?.find((c: any) => c.language === 'pt-br') || candidates?.[0];

            if (master) {
                console.log(`[Generate-Description] Master found (${master.language}). Translating...`);
                try {
                    const translatedDescription = await translateWithGemini(
                        master.description,
                        language,
                        GEMINI_API_KEY
                    );
                    
                    result = {
                        description: translatedDescription,
                        facts_pack_json: master.facts_pack_json // Reuse facts from master
                    };
                } catch (err) {
                    console.error(`[Generate-Description] Translation failed, falling back to generation:`, err);
                }
            } else {
                console.log(`[Generate-Description] No master found for POI ${poi_id}. Generating from scratch in ${language}.`);
            }
        }

        if (!result) {
            console.log(`[Generate-Description] Generating Master pack in ${language} for ${attraction.name}...`);
            result = await generateMasterPack(
                attraction.name,
                cityName,
                raw_context || "Generation triggered by CMS/Service",
                language,
                GEMINI_API_KEY
            );
        }

        // 3. SCORE GENERATION (Heuristic)
        const scoreResult = calculateHeuristicScore(result.description, result.facts_pack_json || [], attraction.name, cityName);
        const descHash = await hashDescription(result.description);
        const isApproved = scoreResult.score_overall >= 75;

        // Update DB - This is the SOLE place where attraction_descriptions should be updated
        // Save description and facts first
        const { data: upsertData, error: upsertError } = await supabaseAdmin.schema('core').from('attraction_descriptions').upsert({
            attraction_id: poi_id,
            language: language,
            gender: voiceGender,
            facts_pack_json: result.facts_pack_json,
            description: result.description,
            updated_at: new Date().toISOString(),
            verification_status: isApproved ? 'approved' : 'needs_review',
            last_score_overall: scoreResult.score_overall,
            last_score_version: 'v2-flash-heuristic',
            last_verified_at: new Date().toISOString(),
            facts_version: 2
        }, { onConflict: 'attraction_id,language,gender' }).select('id').single();

        if (upsertError) throw new Error(`DB Error: ${upsertError.message}`);
        const descriptionId = upsertData.id;

        // Save to description_scores
        await supabaseAdmin.schema('core').from('description_scores').insert({
            description_id: descriptionId,
            attraction_id: poi_id,
            lang: language,
            description_hash: descHash,
            score_overall: scoreResult.score_overall,
            subscores: scoreResult.subscores,
            flags: scoreResult.flags,
            verifier_version: 'v2-flash-heuristic',
            llm_model: 'gemini-2.5-flash-lite',
            confidence: 0.9
        });

        // Audio Generation (Step C - Master Audio)
        let publicUrl = null;
        if (shouldGenerateAudio) {
            try {
                if (!GOOGLE_TTS_API_KEY) {
                    console.warn("[Generate-Description] TTS skipped: GOOGLE_TTS_API_KEY missing");
                } else {
                    console.log(`[Generate-Description] TTS starting for ${poi_id} (${language}, ${voiceGender})...`);
                    const audioBuffer = await generateAudioWithTTS(result.description, language, voiceGender, GOOGLE_TTS_API_KEY);

                    const fileName = `${poi_id}-${language}-${voiceGender}.mp3`;
                    const storagePath = `master_audio/${poi_id}/${fileName}`;

                    const { error: uploadError } = await supabaseAdmin.storage
                        .from('travel-app-audios')
                        .upload(storagePath, audioBuffer, {
                            contentType: 'audio/mpeg',
                            upsert: true
                        });

                    if (uploadError) throw new Error(`Upload Error: ${uploadError.message}`);

                    const { data: urlData } = supabaseAdmin.storage
                        .from('travel-app-audios')
                        .getPublicUrl(storagePath);
                    
                    publicUrl = urlData.publicUrl;

                    await supabaseAdmin.schema('core').from('attraction_descriptions').update({
                        audio_url: publicUrl
                    }).eq('attraction_id', poi_id).eq('language', language).eq('gender', voiceGender);

                    console.log(`[Generate-Description] TTS success: ${publicUrl}`);
                }
            } catch (err) {
                console.error(`[Generate-Description] TTS failed for ${poi_id}:`, err);
            }
        } else {
            console.log(`[Generate-Description] Audio generation skipped (generate_audio=false)`);
        }

        console.log(`[Generate-Description] Success for ${poi_id}`);

        return new Response(JSON.stringify({ 
            success: true, 
            data: { 
                ...result, 
                description_id: descriptionId,
                audio_url: publicUrl,
                score: scoreResult.score_overall
            } 
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } catch (e) {
        console.error(`[Generate-Description] Error:`, e);
        return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
});
