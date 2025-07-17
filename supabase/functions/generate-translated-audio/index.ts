import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with, accept, origin, referer, user-agent',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
  'Access-Control-Max-Age': '86400',
};

// Environment variables
const PROJECT_URL = Deno.env.get('PROJECT_URL') || Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || '';
const GOOGLE_CLOUD_API_KEY = Deno.env.get('GOOGLE_CLOUD_API_KEY') || Deno.env.get('GEMINI_API_KEY') || '';

// Use service role for admin operations
const supabaseAdmin = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

interface RequestBody {
  attractionId: string;
  targetLanguage: string;
  voiceGender: 'male' | 'female';
}

interface GeneratedAudio {
  audioUrl: string;
  translatedText: string;
}

// Voice mapping for Google Cloud TTS
const getVoiceConfig = (language: string, gender: 'male' | 'female') => {
  const voiceMap: Record<string, { male: string; female: string }> = {
    'en': { male: 'en-US-Neural2-J', female: 'en-US-Neural2-F' },
    'en-us': { male: 'en-US-Neural2-J', female: 'en-US-Neural2-F' },
    'es': { male: 'es-ES-Neural2-B', female: 'es-ES-Neural2-A' },
    'es-es': { male: 'es-ES-Neural2-B', female: 'es-ES-Neural2-A' },
    'fr': { male: 'fr-FR-Neural2-B', female: 'fr-FR-Neural2-A' },
    'fr-fr': { male: 'fr-FR-Neural2-B', female: 'fr-FR-Neural2-A' },
    'de': { male: 'de-DE-Neural2-B', female: 'de-DE-Neural2-A' },
    'de-de': { male: 'de-DE-Neural2-B', female: 'de-DE-Neural2-A' },
    'it': { male: 'it-IT-Neural2-C', female: 'it-IT-Neural2-A' },
    'it-it': { male: 'it-IT-Neural2-C', female: 'it-IT-Neural2-A' },
    'pt': { male: 'pt-BR-Neural2-B', female: 'pt-BR-Neural2-A' },
    'pt-br': { male: 'pt-BR-Neural2-B', female: 'pt-BR-Neural2-A' },
  };

  const normalizedLang = language.toLowerCase();
  const voices = voiceMap[normalizedLang];
  
  if (!voices) {
    // Fallback to English
    return {
      name: gender === 'male' ? 'en-US-Neural2-J' : 'en-US-Neural2-F',
      languageCode: 'en-US'
    };
  }

  return {
    name: voices[gender],
    languageCode: normalizedLang.includes('-') ? normalizedLang : `${normalizedLang}-${normalizedLang.toUpperCase()}`
  };
};

// Fetch original Portuguese description
const getOriginalDescription = async (attractionId: string): Promise<string> => {
  const { data, error } = await supabaseAdmin
    .schema('core')
    .from('attraction_descriptions')
    .select('description')
    .eq('attraction_id', attractionId)
    .eq('language', 'pt')
    .single();

  if (error || !data?.description) {
    // Fallback to pt-br if pt not found
    const { data: fallbackData, error: fallbackError } = await supabaseAdmin
      .schema('core')
      .from('attraction_descriptions')
      .select('description')
      .eq('attraction_id', attractionId)
      .eq('language', 'pt-br')
      .single();

    if (fallbackError || !fallbackData?.description) {
      throw new Error('Original Portuguese description not found');
    }
    
    return fallbackData.description;
  }

  return data.description;
};

// Translate text using Gemini API
const translateWithGemini = async (text: string, targetLanguage: string): Promise<string> => {
  const prompt = `You are a professional travel assistant specialized in tourism translation.

Translate the following POI (Point of Interest) description originally written for Brazilian Portuguese tourists, and rewrite it in a natural and culturally appropriate way for international tourists who speak the target language below.

The translation must:
- Preserve the meaning and structure of the original text.
- Sound natural, fluent, and engaging when read aloud.
- Use professional and neutral tone.
- Avoid overly formal or robotic language.
- Be compatible with audio narration (no abrupt transitions, smooth sentence flow).
- Limit the result to about same amount of words comes from original text.

POI Description (pt-br):
"${text}"

Target Language:
"${targetLanguage}" (e.g., en-us, es-es, fr-fr)

Expected output:
Translated description text only (no labels, no explanations, no tags).`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.4,
          topK: 32,
          topP: 1,
          maxOutputTokens: 2048,
        }
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.statusText}`);
  }

  const data = await response.json();
  
  if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
    throw new Error('Invalid response from Gemini API');
  }

  return data.candidates[0].content.parts[0].text.trim();
};

// Generate audio using Google Cloud TTS
const generateAudioWithTTS = async (
  text: string, 
  language: string, 
  gender: 'male' | 'female'
): Promise<ArrayBuffer> => {
  const voiceConfig = getVoiceConfig(language, gender);

  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_CLOUD_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: { text },
        voice: {
          languageCode: voiceConfig.languageCode,
          name: voiceConfig.name,
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: 1.0,
          pitch: 0.0,
          volumeGainDb: 0.0,
          sampleRateHertz: 24000,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Google TTS API error: ${response.statusText}`);
  }

  const data = await response.json();
  
  if (!data.audioContent) {
    throw new Error('No audio content received from Google TTS');
  }

  // Convert base64 to ArrayBuffer
  const audioBuffer = Uint8Array.from(atob(data.audioContent), c => c.charCodeAt(0));
  return audioBuffer.buffer;
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
      headers: corsHeaders 
    });
  }

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

    // Step 1: Fetch original Portuguese description
    const originalText = await getOriginalDescription(attractionId);
    console.log(`[${requestId}] Fetched original description (${originalText.length} chars)`);

    // Step 2: Translate using Gemini
    const translatedText = await translateWithGemini(originalText, targetLanguage);
    console.log(`[${requestId}] Translation completed (${translatedText.length} chars)`);

    // Step 3: Generate audio using Google TTS
    const audioBuffer = await generateAudioWithTTS(translatedText, targetLanguage, voiceGender);
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