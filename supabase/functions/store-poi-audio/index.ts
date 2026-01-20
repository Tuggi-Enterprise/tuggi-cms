import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';import { validateAuthHeader } from '../_shared/auth-middleware.ts';
import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_CONFIG } from '../_shared/rate-limiter.ts';
import { createSecureMediaHeaders } from '../_shared/security-headers.ts';
import {
  validateRequestBody,
  createValidationErrorResponse,
  StorePoiAudioSchema,
} from '../_shared/validation-schemas.ts';
import { createAuditLogger } from '../_shared/audit-logger.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with, accept, origin, referer, user-agent',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
  'Access-Control-Max-Age': '86400',
};

const PROJECT_URL = Deno.env.get('PROJECT_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || '';

// Use service role for admin operations
const supabaseAdmin = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

interface RequestBody {
  attractionId: string;
  audioData: string; // base64 encoded audio
  mimeType: string;
  language?: string;
}

interface StoredAudio {
  id: string;
  url: string;
  storage_path: string;
  size: number;
}

// Generate filename for audio: narration-{attractionId}-{language}.mp3
const generateAudioFilename = (attractionId: string, language: string = 'pt-br'): string => {
  const timestamp = Date.now();
  return `narration-${attractionId}-${language}-${timestamp}.mp3`;
};

// Store audio in Supabase Storage
const storeAudioInBucket = async (
  audioData: string,
  attractionId: string,
  fileName: string,
  mimeType: string = 'audio/mpeg'
): Promise<string> => {
  // Convert base64 to Uint8Array
  const audioBuffer = Uint8Array.from(atob(audioData), c => c.charCodeAt(0));
  
  // Use folder structure: audio/{attractionId}/filename
  const storagePath = `audio/${attractionId}/${fileName}`;
  
  // Store audio in travel-app-audios bucket
  const { error: uploadError } = await supabaseAdmin.storage
    .from('travel-app-audios')
    .upload(storagePath, audioBuffer, {
      contentType: mimeType,
      duplex: 'half'
    });

  if (uploadError) {
    throw new Error(`Failed to upload audio: ${uploadError.message}`);
  }

  return storagePath;
};

// Update attraction_descriptions table with audio_url
const updateAttractionDescription = async (
  attractionId: string,
  audioUrl: string,
  language: string = 'pt-br'
): Promise<void> => {
  // First try to update existing description
  const { data: existing, error: fetchError } = await supabaseAdmin
    .schema('core')
    .from('attraction_descriptions')
    .select('id')
    .eq('attraction_id', attractionId)
    .eq('language', language)
    .single();

  if (fetchError && fetchError.code !== 'PGRST116') {
    throw new Error(`Failed to fetch existing description: ${fetchError.message}`);
  }

  if (existing) {
    // Update existing description
    const { error: updateError } = await supabaseAdmin
      .schema('core')
      .from('attraction_descriptions')
      .update({
        audio_url: audioUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id);

    if (updateError) {
      throw new Error(`Failed to update description: ${updateError.message}`);
    }
  } else {
    // Create new description record if it doesn't exist
    const { error: insertError } = await supabaseAdmin
      .schema('core')
      .from('attraction_descriptions')
      .insert({
        attraction_id: attractionId,
        language: language,
        audio_url: audioUrl,
        description: '', // Empty description, will be filled later
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (insertError) {
      throw new Error(`Failed to create description: ${insertError.message}`);
    }
  }
};

serve(async (req) => {
  const requestId = crypto.randomUUID();
  console.log(`[${requestId}] Store POI audio function request received:`, req.method);

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
    console.warn(`[Store-POI-Audio] ❌ Unauthorized: ${authResult.error}`)
    return new Response(
      JSON.stringify({ error: 'Unauthorized', detail: authResult.error }),
      { status: 401, headers: createSecureHeaders(corsHeaders) }
    )
  }
  console.log(`[Store-POI-Audio] ✅ Authorized: ${authResult.email}`)

  // ✅ RATE LIMITING CHECK
  const config = RATE_LIMIT_CONFIG['store-poi-audio']
  const rateLimit = checkRateLimit(req, 'store-poi-audio', config.maxRequests, config.windowSeconds)
  if (!rateLimit.allowed) {
    console.warn(`[Store-POI-Audio] ⚠️ Rate limit exceeded for ${rateLimit.clientId}`)
    return createRateLimitResponse(rateLimit, corsHeaders)
  }
  console.log(`[Store-POI-Audio] ✅ Rate limit OK (${rateLimit.remaining} remaining)`)

  try {
    // Check authorization
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

    // Parse request body
    const body = await req.json() as RequestBody;
    const { attractionId, audioData, mimeType, language = 'pt-br' } = body;

    // Validate input
    if (!attractionId || !audioData || !mimeType) {
      return new Response(
        JSON.stringify({ error: 'attractionId, audioData, and mimeType are required' }),
        { 
          status: 400, 
          headers: { 
            ...corsHeaders,
            'Content-Type': 'application/json' 
          } 
        }
      );
    }

    console.log(`[${requestId}] Processing audio upload for attraction ${attractionId}`);

    // Generate filename
    const fileName = generateAudioFilename(attractionId, language);
    
    // Store in bucket
    const storagePath = await storeAudioInBucket(audioData, attractionId, fileName, mimeType);
    
    // Generate public URL
    const { data: publicUrlData } = supabaseAdmin.storage
      .from('travel-app-audios')
      .getPublicUrl(storagePath);

    // Update attraction_descriptions table
    await updateAttractionDescription(attractionId, publicUrlData.publicUrl, language);

    const audioSize = Math.round(audioData.length * 0.75); // Approximate size from base64

    const result: StoredAudio = {
      id: crypto.randomUUID(),
      url: publicUrlData.publicUrl,
      storage_path: storagePath,
      size: audioSize
    };

    console.log(`[${requestId}] Successfully processed audio upload: ${storagePath}`);

    return new Response(
      JSON.stringify({
        success: true,
        audio: result
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
    console.error(`[${requestId}] Error in store-poi-audio function:`, error);
    return new Response(
      JSON.stringify({ error: error.message }),
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