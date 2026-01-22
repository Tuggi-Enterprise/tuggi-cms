import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
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
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';
const GEMINI_API_KEY = Deno.env.get('GOOGLE_GEMINI_API_KEY') || Deno.env.get('GEMINI_API_KEY') || '';
// Use GOOGLE_TTS_API_KEY (same as Next.js) or fallback to GOOGLE_CLOUD_API_KEY or GEMINI_API_KEY
const GOOGLE_CLOUD_API_KEY = Deno.env.get('GOOGLE_TTS_API_KEY') || Deno.env.get('GOOGLE_CLOUD_API_KEY') || Deno.env.get('GEMINI_API_KEY') || '';

// Use service role for admin operations
const supabaseAdmin = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

interface RequestBody {
  attractionId: string;
  targetLanguage: string;
  voiceGender: 'male' | 'female';
  originalDescription?: string; // Optional: pass description directly instead of fetching from DB
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

import { translateWithGemini as sharedTranslateWithGemini } from '../_shared/translationUtility.ts';

// Translate text using shared utility
const translateWithGemini = async (text: string, targetLanguage: string): Promise<string> => {
  return sharedTranslateWithGemini(text, targetLanguage, GEMINI_API_KEY);
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
  voiceGender: 'male' | 'female'
): Promise<void> => {
  // Use upsert with the unique constraint (attraction_id, language)
  // This will either insert a new record or update existing one
  const { error: upsertError } = await supabaseAdmin
    .schema('core')
    .from('attraction_descriptions')
    .upsert({
      attraction_id: attractionId,
      language: language,
      description: translatedText,
      audio_url: audioUrl,
      gender: voiceGender,
      updated_at: new Date().toISOString(),
      // For new records, set defaults
      play_count: 0,
      created_at: new Date().toISOString()
    }, {
      onConflict: 'attraction_id,language,gender'
    });

  if (upsertError) {
    throw new Error(`Failed to upsert description: ${upsertError.message}`);
  }
};

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
    const { attractionId, targetLanguage, voiceGender } = body;

    // Validate input
    if (!attractionId || !targetLanguage || !voiceGender) {
      return new Response(
        JSON.stringify({
          error: 'attractionId, targetLanguage, and voiceGender are required'
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      );
    }

    if (!['male', 'female'].includes(voiceGender)) {
      return new Response(
        JSON.stringify({
          error: 'voiceGender must be either "male" or "female"'
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      );
    }

    console.log(`[${requestId}] Processing translation for attraction ${attractionId} to ${targetLanguage} with ${voiceGender} voice`);

    // Step 1: Fetch original description (any language)
    const { description: sourceText, language: sourceLang } = await getOriginalDescription(attractionId);
    console.log(`[${requestId}] Fetched source description in ${sourceLang} (${sourceText.length} chars)`);

    // Step 2: Translate using Gemini only if languages differ
    let translatedText = sourceText;
    if (sourceLang.toLowerCase() !== targetLanguage.toLowerCase()) {
      console.log(`[${requestId}] Translating from ${sourceLang} to ${targetLanguage}`);
      translatedText = await translateWithGemini(sourceText, targetLanguage);
      console.log(`[${requestId}] Translation completed (${translatedText.length} chars)`);
    } else {
      console.log(`[${requestId}] Source language matches target language. Skipping translation.`);
    }

    // Step 3: Generate audio using Google TTS
    // Step 3: Generate audio using Google TTS
    const audioBuffer = await generateAudioWithTTS(translatedText, targetLanguage, voiceGender, GOOGLE_CLOUD_API_KEY);
    console.log(`[${requestId}] Audio generated (${audioBuffer.byteLength} bytes)`);

    // Step 4: Upload audio to storage
    const audioUrl = await uploadAudioToStorage(audioBuffer, attractionId, targetLanguage, voiceGender);
    console.log(`[${requestId}] Audio uploaded to: ${audioUrl}`);

    // Step 5: Update database
    await upsertAttractionDescription(attractionId, targetLanguage, translatedText, audioUrl, voiceGender);
    console.log(`[${requestId}] Database updated successfully`);

    const result: GeneratedAudio = {
      audioUrl,
      translatedText
    };

    return new Response(
      JSON.stringify({
        success: true,
        data: result
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
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