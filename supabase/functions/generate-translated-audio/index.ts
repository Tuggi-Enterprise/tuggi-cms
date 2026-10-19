import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getSecretKey } from '../_shared/secret-key.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateAudioWithTTS } from '../_shared/ttsGenerator.ts';
import { validateAuthHeader, isOwnMachineKey } from '../_shared/auth-middleware.ts';
import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_CONFIG } from '../_shared/rate-limiter.ts';
import { createSecureHeaders } from '../_shared/security-headers.ts';
import {
  validateRequestBody,
  createValidationErrorResponse,
  GenerateTranslatedAudioSchema,
} from '../_shared/validation-schemas.ts';
import { createAuditLogger } from '../_shared/audit-logger.ts';
import {
  decideContentProduction,
  createProductionRefusedResponse,
} from '../_shared/content-production-gate.ts';
import { rebuildReadModel } from '../_shared/read-model.ts';
import {
  isUserRoute,
  translateAndModerateUserRoute,
  handleModerationBatch,
  MODERATION_BATCH_MODE,
  MODERATION_BATCH_LANGUAGE,
  MODERATION_BATCH_GENDER,
  refuseUserRouteRequest,
  type ModerationBatchDeps,
  type RouteSourceRow,
} from '../_shared/route-moderation.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with, accept, origin, referer, user-agent',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
  'Access-Control-Max-Age': '86400',
};

// Environment variables
const PROJECT_URL = Deno.env.get('PROJECT_URL') || Deno.env.get('SUPABASE_URL') || '';
const SECRET_KEY = getSecretKey();
const GEMINI_API_KEY = Deno.env.get('GOOGLE_GEMINI_API_KEY') || Deno.env.get('GEMINI_API_KEY') || '';
// Use GOOGLE_TTS_API_KEY (same as Next.js) or fallback to GOOGLE_CLOUD_API_KEY or GEMINI_API_KEY
const GOOGLE_CLOUD_API_KEY = Deno.env.get('GOOGLE_TTS_API_KEY') || Deno.env.get('GOOGLE_CLOUD_API_KEY') || Deno.env.get('GEMINI_API_KEY') || '';

// Privileged client (secret key — bypasses RLS)
const supabaseAdmin = createClient(PROJECT_URL, SECRET_KEY);

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
  runGeminiPromptWithUsage,
  getLanguageName,
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
//
// ⚠️ O prefixo TEM que ser `master_audio/` — o mesmo que a generate-description
// usa. O app iOS não lê `attraction_descriptions.audio_url`: ele MONTA a URL por
// convenção em TuggiConstructMasterAudioUrl:
//
//   travel-app-audios/master_audio/{id}/{id}-{lang}-{gender}.mp3
//
// Enquanto esta função gravou em `audio/`, todo áudio produzido pelo botão de
// "gerar áudio multi-idioma" do CMS ficava MUDO no iOS (400 no download), embora
// funcionasse no Android, que lê a URL real do banco. Medido em jul/2026: ~6% das
// descrições com áudio estavam em `/audio/` por causa disso.
//
// As linhas já gravadas guardam a URL absoluta antiga e continuam válidas para o
// Android; elas só voltam a tocar no iOS quando o áudio for regerado por aqui.
const uploadAudioToStorage = async (
  audioBuffer: ArrayBuffer,
  attractionId: string,
  language: string,
  voiceGender: 'male' | 'female'
): Promise<string> => {
  const fileName = `${attractionId}-${language}-${voiceGender}.mp3`;
  const storagePath = `master_audio/${attractionId}/${fileName}`;

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

  // Passo (c): tornar áudio/tradução visível ao caminho de disparo (app_poi_read) na hora.
  await rebuildReadModel(supabaseAdmin, attractionId);
};

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE MODE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch route name + description from custom_routes, and whether it is a user route (#945).
 * The description may be missing on a user route (BR-ROTA-006): the caller decides. Before
 * migration 20261019110000 `owner_user_id` does not exist (42703): read without it, and no route
 * is a user route.
 */
type RouteData = { name: string; description: string | null; userRoute: boolean; status: string | null };

const getRouteData = async (routeId: string): Promise<RouteData> => {
  const read = (columns: string) => supabaseAdmin
    .schema('core')
    .from('custom_routes')
    .select(columns)
    .eq('id', routeId)
    .eq('is_active', true)
    .maybeSingle();

  let { data, error } = await read('name, description, metadata, owner_user_id, status');
  if (error?.code === '42703') ({ data, error } = await read('name, description, metadata'));

  if (error || !data) {
    throw new Error(`Route not found or inactive: ${routeId}`);
  }
  const row = data as unknown as RouteSourceRow & { status?: string | null };
  return { name: row.name, description: row.description || null, userRoute: isUserRoute(row), status: row.status ?? null };
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
  translatedText: string | null,
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

/**
 * The per-route path: translation (screened, for a user route) + audio + persistence. The route
 * mode and the batch mode (#945) both run it. `flagged` means the user route was held for review and
 * nothing was produced. Throws when there is no verdict or the production failed (lock -> failed).
 */
type RouteProduction =
  | { flagged: true }
  | { flagged: false; name: string; description: string | null; audioUrl: string | null };

const produceRouteTranslation = async (
  requestId: string,
  routeId: string,
  targetLanguage: string,
  voiceGender: 'male' | 'female',
  opts: {
    generateAudio: boolean;
    originalName?: string;
    originalDescription?: string;
    /** Batch or CMS. A tourist never writes the verdict of a user route (security-reviewer, #945). */
    mayRecordVerdict: boolean;
    /** Already read by the caller (route mode reads it to refuse before the lock). */
    routeData?: RouteData;
  },
): Promise<RouteProduction> => {
  // Step 1: Fetch route name + description (or use overrides from body)
  const routeData = opts.routeData ?? await getRouteData(routeId);

  // Optimistic lock
  await setRouteTranslationStatus(routeId, targetLanguage, voiceGender, 'generating');

  try {
    let translatedName: string;
    let translatedText: string | null;

    if (routeData.userRoute) {
      // #945, BR-ROTA-006: a user route is translated and screened in ONE call, on the text
      // stored in the database (body overrides are ignored, so nobody screens a clean text
      // and publishes another). No description: the name alone is screened and translated.
      const moderated = await translateAndModerateUserRoute(
        routeData,
        getLanguageName(targetLanguage),
        targetLanguage,
        {
          runPrompt: async (prompt) => (await runGeminiPromptWithUsage(prompt, GEMINI_API_KEY, 2048, 0.2)).text,
          setModerationResult: opts.mayRecordVerdict
            ? async (flagged, reason) => {
              const { error } = await supabaseAdmin.schema('core').rpc('set_route_moderation_result', {
                p_route_id: routeId, p_flagged: flagged, p_reason: reason,
              });
              if (error) throw new Error(`set_route_moderation_result failed: ${error.code}`);
            }
            : null,
        },
      );
      console.log(`[${requestId}] User route screened: flagged=${moderated.flagged}`);
      if (moderated.flagged) {
        // Nothing produced from an improper text: no audio, no stored translation.
        await setRouteTranslationStatus(routeId, targetLanguage, voiceGender, 'failed').catch(() => {});
        return { flagged: true };
      }
      translatedName = moderated.name;
      translatedText = moderated.description;
    } else {
      const sourceName        = opts.originalName        ?? routeData.name;
      const sourceDescription = opts.originalDescription ?? routeData.description;
      if (!sourceDescription) {
        throw new Error(`Route ${routeId} has no description to translate.`);
      }
      console.log(`[${requestId}] Source: name="${sourceName?.slice(0, 40)}" desc=${sourceDescription.length}chars`);

      // Step 2: Translate name + description in parallel
      [translatedName, translatedText] = await Promise.all([
        translateWithGemini(sourceName, targetLanguage),
        translateWithGemini(sourceDescription, targetLanguage),
      ]);
      // CMS route only: the text of a user route never goes to the log (security-reviewer, #945).
      console.log(`[${requestId}] Translated name="${translatedName.slice(0, 40)}" desc=${translatedText?.length ?? 0}chars`);
    }

    // Step 3: Generate audio (optional, default true)
    let audioUrl: string | null = null;
    if (opts.generateAudio && translatedText) {
      const audioBuffer = await generateAudioWithTTS(translatedText, targetLanguage, voiceGender, GOOGLE_CLOUD_API_KEY);
      audioUrl = await uploadRouteAudioToStorage(audioBuffer, routeId, targetLanguage, voiceGender);
      console.log(`[${requestId}] Route audio uploaded: ${audioUrl}`);
    }

    // Step 4: Persist (includes gender — mirrors attraction_descriptions pattern)
    await upsertRouteDescription(routeId, targetLanguage, voiceGender, translatedName, translatedText, audioUrl);
    console.log(`[${requestId}] Route description saved (status=ready, gender=${voiceGender})`);
    return { flagged: false, name: translatedName, description: translatedText, audioUrl };
  } catch (routeError) {
    // Release lock with failed status
    await setRouteTranslationStatus(routeId, targetLanguage, voiceGender, 'failed').catch(() => {});
    throw routeError;
  }
};

/**
 * Database side of the batch mode (#945). The queue is the database's: `core.claim_user_routes_for_moderation`
 * picks the routes owed a verdict, oldest first, SKIP LOCKED, and spends the attempt before the
 * model is called (the ceiling lives in `core.user_route_needs_moderation`). Nothing is filtered or
 * counted here.
 */
const moderationBatchDeps = (requestId: string): ModerationBatchDeps => ({
  claim: async (limit) => {
    const { data, error } = await supabaseAdmin
      .schema('core')
      .rpc('claim_user_routes_for_moderation', { p_limit: limit });
    if (error) throw new Error(`claim_user_routes_for_moderation: ${error.code}`);
    return (data ?? []) as Array<{ id: string; attempt: number }>;
  },
  screenRoute: async (routeId) => {
    const produced = await produceRouteTranslation(
      requestId, routeId, MODERATION_BATCH_LANGUAGE, MODERATION_BATCH_GENDER, { generateAudio: true, mayRecordVerdict: true },
    );
    return { flagged: produced.flagged };
  },
});

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

  // The body is read once, here: the batch mode (#945) is decided before the per-request limit.
  const parsedBody = await req.json().catch(() => null) as (RequestBody & { mode?: unknown }) | null;
  if (!parsedBody || typeof parsedBody !== 'object') {
    return new Response(
      JSON.stringify({ error: 'invalid_json' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ✅ #945, BR-ROTA-006 — FIRST SCREENING OF USER ROUTES, called by the database cron every 5 min.
  // Machine key only (401 otherwise). Out of the per-request limit: one call screens up to `limit`
  // routes, the cron is its only caller, and the 5/hour of the limiter would refuse 7 of its 12.
  // The production gate below (BR-CONTEUDO-003) answers not_applicable to the machine key anyway.
  if (parsedBody.mode === MODERATION_BATCH_MODE) {
    const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const isServiceRole = isOwnMachineKey(bearer);
    if (isServiceRole && (!GEMINI_API_KEY || !GOOGLE_CLOUD_API_KEY)) {
      return new Response(
        JSON.stringify({ error: "Missing required API keys" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const batch = await handleModerationBatch(isServiceRole, parsedBody as unknown as Record<string, unknown>, moderationBatchDeps(requestId));
    console.log(`[${requestId}] Batch ${MODERATION_BATCH_MODE}: ${JSON.stringify(batch.body)}`);
    return new Response(
      JSON.stringify(batch.body),
      { status: batch.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ✅ RATE LIMITING CHECK
  const config = RATE_LIMIT_CONFIG['generate-translated-audio']
  const rateLimit = checkRateLimit(req, 'generate-translated-audio', config.maxRequests, config.windowSeconds)
  if (!rateLimit.allowed) {
    console.warn(`[Generate-Translated-Audio] ⚠️ Rate limit exceeded for ${rateLimit.clientId}`)
    return createRateLimitResponse(rateLimit, corsHeaders)
  }
  console.log(`[Generate-Translated-Audio] ✅ Rate limit OK (${rateLimit.remaining} remaining)`)

  // ✅ BR-CONTEUDO-003 item 5 — GATE DE PRODUÇÃO, NO CORPO DA FUNÇÃO.
  // Every path below this line spends LLM (translation, POI name) and/or TTS:
  // route mode, POI name-only mode and the full POI package. None of them
  // short-circuits on content that already exists, so there is no idempotent
  // request to protect here — whoever gets past this point spends money.
  // Refused in the instant: no queue, no promise, nothing produced later.
  const productionGate = await decideContentProduction(authResult, 'Generate-Translated-Audio')
  if (!productionGate.allowed) {
    console.log(`[Generate-Translated-Audio] ⛔ BR-CONTEUDO-003: production refused (state=${productionGate.state})`)
    return createProductionRefusedResponse(productionGate, createSecureHeaders(corsHeaders))
  }

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

    const body = parsedBody as RequestBody;
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
      const routeData = await getRouteData(routeId);
      // #945, BR-ROTA-006: a tourist never screens a user route still in review (the verdict is
      // the batch's or the CMS's), and gets nothing from it: 422 before any LLM or lock.
      const refusal = refuseUserRouteRequest(routeData, productionGate.source);
      if (refusal) {
        return new Response(
          JSON.stringify({ error: refusal }),
          { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const produced = await produceRouteTranslation(requestId, routeId, targetLanguage, voiceGender, {
        generateAudio: body.generateAudio !== false,
        originalName: body.originalName,
        originalDescription: body.originalDescription,
        mayRecordVerdict: productionGate.source !== 'app_user',
        routeData,
      });
      if (produced.flagged) {
        return new Response(
          JSON.stringify({ error: 'route_under_review' }),
          { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ success: true, data: { name: produced.name, description: produced.description, audioUrl: produced.audioUrl } }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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