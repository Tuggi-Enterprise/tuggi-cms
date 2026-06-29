import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getSecretKey } from '../_shared/supabase-client.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateAudioWithTTS } from '../_shared/ttsGenerator.ts';
import { validateAuthHeader } from '../_shared/auth-middleware.ts';
import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_CONFIG } from '../_shared/rate-limiter.ts';
import { createSecureHeaders } from '../_shared/security-headers.ts';
import {
  validateRequestBody,
  createValidationErrorResponse,
  GenerateTranslatedAudioSchema,
} from '../_shared/validation-schemas.ts';
import { createAuditLogger } from '../_shared/audit-logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with, accept, origin, referer, user-agent',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
  'Access-Control-Max-Age': '86400',
};

// Environment variables
const PROJECT_URL = Deno.env.get('PROJECT_URL') || Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = getSecretKey() || getSecretKey() || '';
const GEMINI_API_KEY = Deno.env.get('GOOGLE_GEMINI_API_KEY') || Deno.env.get('GEMINI_API_KEY') || '';
// Use GOOGLE_TTS_API_KEY (same as Next.js) or fallback to GOOGLE_CLOUD_API_KEY or GEMINI_API_KEY
const GOOGLE_CLOUD_API_KEY = Deno.env.get('GOOGLE_TTS_API_KEY') || Deno.env.get('GOOGLE_CLOUD_API_KEY') || Deno.env.get('GEMINI_API_KEY') || '';

// Use service role for admin operations
const supabaseAdmin = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

interface RequestBody {
  // ─── POI mode (existing) ─────────────────────────────────────────────
  attractionId?: string;
  originalDescription?: string; // pass text directly, skips DB fetch
  // POI mode: translate ONLY the POI name (no audio, preserves description).
  // Used by the app for legacy POIs that already have description+audio in the
  // target language but no translated name yet (lazy backfill, scenario 1).
  nameOnly?: boolean;

  // ─── Route mode (new) ─────────────────────────────────────────────────
  // Mutually exclusive with attractionId.
  // Translates BOTH name + description of a custom route.
  // Writes to core.custom_route_descriptions (no FK conflict with attractions).
  routeId?: string;
  originalName?: string;    // route name to translate (route mode) / override (POI mode)
  generateAudio?: boolean;  // default: true

  // ─── Common ───────────────────────────────────────────────────────────
  targetLanguage: string;
  voiceGender: 'male' | 'female';
}

interface GeneratedAudio {
  audioUrl: string;
  translatedText: string;
}



// Fetch the MOST RECENT description to use as source for translation
const getOriginalDescription = async (attractionId: string): Promise<{ description: string, language: string }> => {
  // Get the most recently updated description for this attraction, regardless of language
  const { data } = await supabaseAdmin
    .schema('core')
    .from('attraction_descriptions')
    .select('description, language, updated_at')
    .eq('attraction_id', attractionId)
    // Filter out [PROCESSING] content to avoid getting a lock placeholder
    .neq('description', '[PROCESSING]')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data?.description) {
    return { description: data.description, language: data.language };
  }

  throw new Error(`No description found for attraction ${attractionId}.`);
};

import {
  translateWithGemini as sharedTranslateWithGemini,
  translatePoiNameWithUsage,
} from '../_shared/translationUtility.ts';

// Translate text using shared utility
const translateWithGemini = async (text: string, targetLanguage: string): Promise<string> => {
  return sharedTranslateWithGemini(text, targetLanguage, GEMINI_API_KEY);
};

// Translate a POI name (proper-noun aware: exonym, else transliterate).
const translatePoiName = async (
  name: string,
  targetLanguage: string,
  context?: string,
): Promise<string> => {
  const { text } = await translatePoiNameWithUsage(name, targetLanguage, GEMINI_API_KEY, context);
  return text;
};

// Fetch the canonical (original) POI name from core.attractions.
const getAttractionName = async (attractionId: string): Promise<string> => {
  const { data, error } = await supabaseAdmin
    .schema('core')
    .from('attractions')
    .select('name')
    .eq('id', attractionId)
    .maybeSingle();

  if (error || !data?.name) {
    throw new Error(`Attraction not found or missing name: ${attractionId}`);
  }
  return data.name;
};

// Persist the translated name onto EVERY existing description row for this
// (attraction_id, language) — the name does not vary by gender. Returns the
// number of rows touched (0 means no description exists yet for this language).
const updateAttractionName = async (
  attractionId: string,
  language: string,
  translatedName: string,
): Promise<number> => {
  const { data, error } = await supabaseAdmin
    .schema('core')
    .from('attraction_descriptions')
    .update({ name: translatedName, updated_at: new Date().toISOString() })
    .eq('attraction_id', attractionId)
    .eq('language', language)
    .select('id');

  if (error) throw new Error(`Failed to update POI name: ${error.message}`);
  return data?.length ?? 0;
};



// Upload audio to Supabase Storage
const uploadAudioToStorage = async (
  audioBuffer: ArrayBuffer,
  attractionId: string,
  language: string,
  voiceGender: 'male' | 'female'
): Promise<string> => {
  const fileName = `${attractionId}-${language}-${voiceGender}.mp3`;
  const storagePath = `audio/${attractionId}/${fileName}`;

  // First try to upload, if it fails due to existing file, try to update
  const { error: uploadError } = await supabaseAdmin.storage
    .from('travel-app-audios')
    .upload(storagePath, audioBuffer, {
      contentType: 'audio/mpeg',
      duplex: 'half'
    });

  if (uploadError) {
    // If file already exists, try to update it
    if (uploadError.message.includes('already exists') || uploadError.message.includes('The resource already exists')) {
      const { error: updateError } = await supabaseAdmin.storage
        .from('travel-app-audios')
        .update(storagePath, audioBuffer, {
          contentType: 'audio/mpeg',
        });

      if (updateError) {
        throw new Error(`Failed to update audio: ${updateError.message}`);
      }
    } else {
      throw new Error(`Failed to upload audio: ${uploadError.message}`);
    }
  }

  // Get public URL
  const { data: publicUrlData } = supabaseAdmin.storage
    .from('travel-app-audios')
    .getPublicUrl(storagePath);

  return publicUrlData.publicUrl;
};

// Update or insert attraction description
const upsertAttractionDescription = async (
  attractionId: string,
  language: string,
  translatedText: string,
  audioUrl: string,
  voiceGender: 'male' | 'female',
  translatedName?: string
): Promise<void> => {
  // Use upsert with the unique constraint (attraction_id, language, gender)
  // This will either insert a new record or update existing one
  const row: Record<string, unknown> = {
    attraction_id: attractionId,
    language: language,
    description: translatedText,
    audio_url: audioUrl,
    gender: voiceGender,
    updated_at: new Date().toISOString(),
    // For new records, set defaults
    play_count: 0,
    created_at: new Date().toISOString()
  };
  // Name is gender-independent; only set it when we translated one.
  if (translatedName) row.name = translatedName;

  const { error: upsertError } = await supabaseAdmin
    .schema('core')
    .from('attraction_descriptions')
    .upsert(row, {
      onConflict: 'attraction_id,language,gender'
    });

  if (upsertError) {
    throw new Error(`Failed to upsert description: ${upsertError.message}`);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE MODE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Fetch route name + description from custom_routes */
const getRouteData = async (routeId: string): Promise<{ name: string; description: string }> => {
  const { data, error } = await supabaseAdmin
    .schema('core')
    .from('custom_routes')
    .select('name, description')
    .eq('id', routeId)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Route not found or inactive: ${routeId}`);
  }
  if (!data.description) {
    throw new Error(`Route ${routeId} has no description to translate.`);
  }
  return { name: data.name, description: data.description };
};

/** Upload route audio with a route-specific storage path (includes gender, mirrors POI pattern) */
const uploadRouteAudioToStorage = async (
  audioBuffer: ArrayBuffer,
  routeId: string,
  language: string,
  gender: 'male' | 'female',
): Promise<string> => {
  const fileName    = `${routeId}-${language}-${gender}.mp3`;
  const storagePath = `route-audios/${routeId}/${fileName}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('travel-app-audios')
    .upload(storagePath, audioBuffer, { contentType: 'audio/mpeg', duplex: 'half' });

  if (uploadError) {
    if (uploadError.message.includes('already exists') || uploadError.message.includes('The resource already exists')) {
      const { error: updateError } = await supabaseAdmin.storage
        .from('travel-app-audios')
        .update(storagePath, audioBuffer, { contentType: 'audio/mpeg' });
      if (updateError) throw new Error(`Failed to update route audio: ${updateError.message}`);
    } else {
      throw new Error(`Failed to upload route audio: ${uploadError.message}`);
    }
  }

  const { data: publicUrlData } = supabaseAdmin.storage
    .from('travel-app-audios')
    .getPublicUrl(storagePath);

  return publicUrlData.publicUrl;
};

/** Upsert translated content into custom_route_descriptions */
const upsertRouteDescription = async (
  routeId: string,
  language: string,
  gender: 'male' | 'female',
  translatedName: string,
  translatedText: string,
  audioUrl: string | null,
): Promise<void> => {
  const { error } = await supabaseAdmin
    .schema('core')
    .from('custom_route_descriptions')
    .upsert({
      route_id:    routeId,
      language,
      gender,
      name:        translatedName,
      description: translatedText,
      audio_url:   audioUrl,
      status:      'ready',
      updated_at:  new Date().toISOString(),
    }, { onConflict: 'route_id,language,gender' });

  if (error) throw new Error(`Failed to upsert route description: ${error.message}`);
};

/** Set route translation status (for optimistic locking) */
const setRouteTranslationStatus = async (
  routeId: string,
  language: string,
  gender: 'male' | 'female',
  status: 'generating' | 'failed',
): Promise<void> => {
  await supabaseAdmin
    .schema('core')
    .from('custom_route_descriptions')
    .upsert({
      route_id:    routeId,
      language,
      gender,
      status,
      description: status === 'generating' ? '[GENERATING]' : null,
      updated_at:  new Date().toISOString(),
    }, { onConflict: 'route_id,language,gender' });
};

// ─────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  const requestId = crypto.randomUUID();
  console.log(`[${requestId}] Generate translated audio function request received:`, req.method);

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: createSecureHeaders(corsHeaders)
    });
  }

  // ✅ VALIDAR AUTENTICAÇÃO
  const authResult = await validateAuthHeader(req)
  if (!authResult.valid) {
    console.warn(`[Generate-Translated-Audio] ❌ Unauthorized: ${authResult.error}`)
    return new Response(
      JSON.stringify({ error: 'Unauthorized', detail: authResult.error }),
      { status: 401, headers: createSecureHeaders(corsHeaders) }
    )
  }
  console.log(`[Generate-Translated-Audio] ✅ Authorized: ${authResult.email}`)

  // ✅ RATE LIMITING CHECK
  const config = RATE_LIMIT_CONFIG['generate-translated-audio']
  const rateLimit = checkRateLimit(req, 'generate-translated-audio', config.maxRequests, config.windowSeconds)
  if (!rateLimit.allowed) {
    console.warn(`[Generate-Translated-Audio] ⚠️ Rate limit exceeded for ${rateLimit.clientId}`)
    return createRateLimitResponse(rateLimit, corsHeaders)
  }
  console.log(`[Generate-Translated-Audio] ✅ Rate limit OK (${rateLimit.remaining} remaining)`)

  try {
    // Check authorization (already validated above)
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      );
    }

    // Validate environment variables
    if (!GEMINI_API_KEY || !GOOGLE_CLOUD_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing required API keys" }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      );
    }

    // Parse request body
    const body = await req.json() as RequestBody;
    const { attractionId, routeId, targetLanguage, voiceGender } = body;

    // Validate: need either attractionId (POI mode) or routeId (route mode)
    if (!attractionId && !routeId) {
      return new Response(
        JSON.stringify({ error: 'Either attractionId (POI mode) or routeId (route mode) is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!targetLanguage || !voiceGender) {
      return new Response(
        JSON.stringify({ error: 'targetLanguage and voiceGender are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!['male', 'female'].includes(voiceGender)) {
      return new Response(
        JSON.stringify({ error: 'voiceGender must be either "male" or "female"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── ROUTE MODE ────────────────────────────────────────────────────────────
    if (routeId) {
      console.log(`[${requestId}] ROUTE MODE: routeId=${routeId} targetLanguage=${targetLanguage}`);

      // Optimistic lock
      await setRouteTranslationStatus(routeId, targetLanguage, voiceGender, 'generating');

      try {
        // Step 1: Fetch route name + description (or use overrides from body)
        let sourceName        = body.originalName;
        let sourceDescription = body.originalDescription;

        if (!sourceName || !sourceDescription) {
          const routeData = await getRouteData(routeId);
          sourceName        = sourceName        ?? routeData.name;
          sourceDescription = sourceDescription ?? routeData.description;
        }
        console.log(`[${requestId}] Source: name="${sourceName?.slice(0, 40)}" desc=${sourceDescription?.length}chars`);

        // Step 2: Translate name + description in parallel
        const [translatedName, translatedText] = await Promise.all([
          translateWithGemini(sourceName!, targetLanguage),
          translateWithGemini(sourceDescription!, targetLanguage),
        ]);
        console.log(`[${requestId}] Translated name="${translatedName.slice(0, 40)}" desc=${translatedText.length}chars`);

        // Step 3: Generate audio (optional, default true)
        let audioUrl: string | null = null;
        if (body.generateAudio !== false) {
          const audioBuffer = await generateAudioWithTTS(translatedText, targetLanguage, voiceGender, GOOGLE_CLOUD_API_KEY);
          audioUrl = await uploadRouteAudioToStorage(audioBuffer, routeId, targetLanguage, voiceGender);
          console.log(`[${requestId}] Route audio uploaded: ${audioUrl}`);
        }

        // Step 4: Persist (includes gender — mirrors attraction_descriptions pattern)
        await upsertRouteDescription(routeId, targetLanguage, voiceGender, translatedName, translatedText, audioUrl);
        console.log(`[${requestId}] Route description saved (status=ready, gender=${voiceGender})`);

        return new Response(
          JSON.stringify({ success: true, data: { name: translatedName, description: translatedText, audioUrl } }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

      } catch (routeError) {
        // Release lock with failed status
        await setRouteTranslationStatus(routeId, targetLanguage, voiceGender, 'failed').catch(() => {});
        throw routeError;
      }
    }

    // ── POI MODE: NAME-ONLY (lazy backfill, scenario 1) ──────────────────────
    // Legacy POI already has description+audio in the target language but no
    // translated name. Translate just the name and stamp it onto the existing
    // rows. No audio, no description rewrite.
    if (attractionId && body.nameOnly === true) {
      console.log(`[${requestId}] POI NAME-ONLY: attractionId=${attractionId} language=${targetLanguage}`);

      const originalName = body.originalName ?? await getAttractionName(attractionId);

      // Use the existing translated description (if any) as disambiguation context.
      let nameContext: string | undefined;
      try {
        const { description } = await getOriginalDescription(attractionId);
        nameContext = description.slice(0, 200);
      } catch {
        nameContext = undefined; // no description yet — name still translatable
      }

      const translatedName = await translatePoiName(originalName, targetLanguage, nameContext);
      const rowsUpdated = await updateAttractionName(attractionId, targetLanguage, translatedName);
      console.log(`[${requestId}] Name translated="${translatedName}" rowsUpdated=${rowsUpdated}`);

      return new Response(
        JSON.stringify({ success: true, data: { name: translatedName, rowsUpdated } }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── POI MODE (full package: description + audio + name) ───────────────────
    console.log(`[${requestId}] POI MODE: attractionId=${attractionId} language=${targetLanguage} gender=${voiceGender}`);

    // Step 1: Fetch original description (any language)
    const { description: sourceText, language: sourceLang } = await getOriginalDescription(attractionId!);
    console.log(`[${requestId}] Fetched source description in ${sourceLang} (${sourceText.length} chars)`);

    // Step 2: Translate description + name in parallel.
    // Name always localizes to the target language (proper-noun aware), even
    // when the source description already matches the target language.
    const originalName = body.originalName ?? await getAttractionName(attractionId!);
    const needsDescTranslation = sourceLang.toLowerCase() !== targetLanguage.toLowerCase();

    const [translatedText, translatedName] = await Promise.all([
      needsDescTranslation
        ? translateWithGemini(sourceText, targetLanguage)
        : Promise.resolve(sourceText),
      translatePoiName(originalName, targetLanguage, sourceText.slice(0, 200)),
    ]);
    console.log(`[${requestId}] Translated name="${translatedName}" desc=${translatedText.length}chars (descTranslated=${needsDescTranslation})`);

    // Step 3: Generate audio using Google TTS
    const audioBuffer = await generateAudioWithTTS(translatedText, targetLanguage, voiceGender, GOOGLE_CLOUD_API_KEY);
    console.log(`[${requestId}] Audio generated (${audioBuffer.byteLength} bytes)`);

    // Step 4: Upload audio to storage
    const audioUrl = await uploadAudioToStorage(audioBuffer, attractionId!, targetLanguage, voiceGender);
    console.log(`[${requestId}] Audio uploaded to: ${audioUrl}`);

    // Step 5: Update database (includes translated name)
    await upsertAttractionDescription(attractionId!, targetLanguage, translatedText, audioUrl, voiceGender, translatedName);
    console.log(`[${requestId}] Database updated successfully`);

    const result: GeneratedAudio & { name: string } = {
      audioUrl,
      translatedText,
      name: translatedName,
    };

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error(`[${requestId}] Error in generate-translated-audio function:`, error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );
  }
}); 