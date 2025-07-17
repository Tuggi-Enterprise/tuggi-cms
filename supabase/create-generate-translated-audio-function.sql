-- ===========================================
-- CREATE GENERATE TRANSLATED AUDIO RPC FUNCTION
-- ===========================================
-- This function provides a SQL interface for generating translated audio
-- Note: Due to PostgreSQL limitations, the actual external API calls are handled by an Edge Function
-- This RPC function coordinates the process and validates inputs

-- Ensure we have the required extension for HTTP (if available)
-- Note: HTTP extension is typically not available in hosted Supabase instances
-- CREATE EXTENSION IF NOT EXISTS http;

-- ===========================================
-- CREATE THE RPC FUNCTION
-- ===========================================

CREATE OR REPLACE FUNCTION core.generate_translated_audio(
  p_attraction_id uuid,
  p_target_language text,
  p_voice_gender text
)
RETURNS TABLE(
  audio_url text,
  translated_text text
) AS $$
DECLARE
  v_existing_record record;
  v_original_description text;
  v_function_url text;
  v_error_message text;
BEGIN
  -- ===========================================
  -- INPUT VALIDATION
  -- ===========================================
  
  -- Validate attraction_id
  IF p_attraction_id IS NULL THEN
    RAISE EXCEPTION 'attraction_id cannot be null';
  END IF;
  
  -- Validate target_language
  IF p_target_language IS NULL OR trim(p_target_language) = '' THEN
    RAISE EXCEPTION 'target_language cannot be null or empty';
  END IF;
  
  -- Validate voice_gender
  IF p_voice_gender NOT IN ('male', 'female') THEN
    RAISE EXCEPTION 'voice_gender must be either ''male'' or ''female''';
  END IF;
  
  -- Normalize target language to lowercase
  p_target_language := lower(trim(p_target_language));
  p_voice_gender := lower(trim(p_voice_gender));
  
  -- ===========================================
  -- CHECK IF ATTRACTION EXISTS
  -- ===========================================
  
  IF NOT EXISTS (
    SELECT 1 FROM core.attractions 
    WHERE id = p_attraction_id
  ) THEN
    RAISE EXCEPTION 'Attraction with ID % does not exist', p_attraction_id;
  END IF;
  
  -- ===========================================
  -- CHECK FOR EXISTING TRANSLATED VERSION
  -- ===========================================
  
  SELECT 
    description,
    audio_url,
    gender
  INTO v_existing_record
  FROM core.attraction_descriptions
  WHERE attraction_id = p_attraction_id
    AND language = p_target_language
    AND audio_url IS NOT NULL
    AND description IS NOT NULL
    AND trim(description) != '';
  
  -- If we already have a complete translated version, return it
  IF FOUND THEN
    audio_url := v_existing_record.audio_url;
    translated_text := v_existing_record.description;
    RETURN NEXT;
    RETURN;
  END IF;
  
  -- ===========================================
  -- VERIFY ORIGINAL PORTUGUESE DESCRIPTION EXISTS
  -- ===========================================
  
  SELECT description INTO v_original_description
  FROM core.attraction_descriptions
  WHERE attraction_id = p_attraction_id
    AND language IN ('pt', 'pt-br')
    AND description IS NOT NULL
    AND trim(description) != ''
  ORDER BY 
    CASE WHEN language = 'pt' THEN 1 ELSE 2 END
  LIMIT 1;
  
  IF v_original_description IS NULL THEN
    RAISE EXCEPTION 'No Portuguese description found for attraction %', p_attraction_id;
  END IF;
  
  -- ===========================================
  -- IMPORTANT NOTE ABOUT EDGE FUNCTION INTEGRATION
  -- ===========================================
  
  -- Since PostgreSQL RPC functions cannot make HTTP requests to external APIs,
  -- the actual translation and TTS generation must be handled by the Edge Function.
  -- 
  -- To complete this operation, you need to call the Edge Function:
  -- 
  -- POST https://your-project.supabase.co/functions/v1/generate-translated-audio
  -- 
  -- Body: {
  --   "attractionId": "p_attraction_id",
  --   "targetLanguage": "p_target_language", 
  --   "voiceGender": "p_voice_gender"
  -- }
  --
  -- The Edge Function will:
  -- 1. Fetch the original Portuguese description
  -- 2. Translate it using Gemini 1.5 Pro
  -- 3. Generate audio using Google Cloud TTS
  -- 4. Upload to Supabase Storage
  -- 5. Update the attraction_descriptions table
  -- 6. Return the audio_url and translated_text
  
  -- ===========================================
  -- PLACEHOLDER RESPONSE FOR RPC INTERFACE
  -- ===========================================
  
  -- Since we cannot call the Edge Function from SQL, we return instructions
  -- In a real implementation, this would be called from application code
  
  audio_url := format(
    'CALL_EDGE_FUNCTION: /functions/v1/generate-translated-audio with attractionId=%s, targetLanguage=%s, voiceGender=%s',
    p_attraction_id,
    p_target_language,
    p_voice_gender
  );
  
  translated_text := format(
    'This RPC function validates inputs and checks for existing translations. To complete the translation and audio generation, call the Edge Function with the validated parameters above. Original description length: %s characters.',
    length(v_original_description)
  );
  
  RETURN NEXT;
  
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- GRANT PERMISSIONS
-- ===========================================

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION core.generate_translated_audio(uuid, text, text) TO authenticated;

-- Grant execute permission to service role (for Edge Functions)
GRANT EXECUTE ON FUNCTION core.generate_translated_audio(uuid, text, text) TO service_role;

-- ===========================================
-- CREATE HELPER FUNCTION FOR APPLICATION USE
-- ===========================================

-- This function is designed to be called from application code
-- that can then call the Edge Function with the validated parameters
CREATE OR REPLACE FUNCTION core.validate_translation_request(
  p_attraction_id uuid,
  p_target_language text,
  p_voice_gender text
)
RETURNS jsonb AS $$
DECLARE
  v_result jsonb;
  v_attraction_name text;
  v_original_description text;
  v_existing_translation record;
BEGIN
  -- Validate inputs using the same logic as the main function
  IF p_attraction_id IS NULL THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'attraction_id cannot be null'
    );
  END IF;
  
  IF p_target_language IS NULL OR trim(p_target_language) = '' THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'target_language cannot be null or empty'
    );
  END IF;
  
  IF p_voice_gender NOT IN ('male', 'female') THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'voice_gender must be either ''male'' or ''female'''
    );
  END IF;
  
  -- Normalize inputs
  p_target_language := lower(trim(p_target_language));
  p_voice_gender := lower(trim(p_voice_gender));
  
  -- Check if attraction exists
  SELECT name INTO v_attraction_name
  FROM core.attractions
  WHERE id = p_attraction_id;
  
  IF v_attraction_name IS NULL THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', format('Attraction with ID %s does not exist', p_attraction_id)
    );
  END IF;
  
  -- Check for original description
  SELECT description INTO v_original_description
  FROM core.attraction_descriptions
  WHERE attraction_id = p_attraction_id
    AND language IN ('pt', 'pt-br')
    AND description IS NOT NULL
    AND trim(description) != ''
  ORDER BY 
    CASE WHEN language = 'pt' THEN 1 ELSE 2 END
  LIMIT 1;
  
  IF v_original_description IS NULL THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', format('No Portuguese description found for attraction %s', p_attraction_id)
    );
  END IF;
  
  -- Check for existing translation
  SELECT 
    description,
    audio_url,
    created_at,
    gender
  INTO v_existing_translation
  FROM core.attraction_descriptions
  WHERE attraction_id = p_attraction_id
    AND language = p_target_language;
  
  -- Build success response
  v_result := jsonb_build_object(
    'valid', true,
    'attraction_id', p_attraction_id,
    'attraction_name', v_attraction_name,
    'target_language', p_target_language,
    'voice_gender', p_voice_gender,
    'original_description_length', length(v_original_description),
    'has_existing_translation', v_existing_translation.description IS NOT NULL,
    'has_existing_audio', v_existing_translation.audio_url IS NOT NULL
  );
  
  -- Add existing translation info if available
  IF v_existing_translation.description IS NOT NULL THEN
    v_result := v_result || jsonb_build_object(
      'existing_translation', jsonb_build_object(
        'description', v_existing_translation.description,
        'audio_url', v_existing_translation.audio_url,
        'created_at', v_existing_translation.created_at
      )
    );
  END IF;
  
  RETURN v_result;
  
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions for the helper function
GRANT EXECUTE ON FUNCTION core.validate_translation_request(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION core.validate_translation_request(uuid, text, text) TO service_role;

-- ===========================================
-- ADD FUNCTION COMMENTS
-- ===========================================

COMMENT ON FUNCTION core.generate_translated_audio(uuid, text, text) IS 
'RPC interface for generating translated audio. Due to PostgreSQL limitations, actual API calls are handled by the generate-translated-audio Edge Function. This function validates inputs and checks for existing translations.';

COMMENT ON FUNCTION core.validate_translation_request(uuid, text, text) IS 
'Helper function to validate translation requests and check for existing translations before calling the Edge Function. Returns detailed validation results in JSON format.';

-- ===========================================
-- EXAMPLE USAGE
-- ===========================================

/*
-- Example 1: Basic RPC call (returns instructions for Edge Function)
SELECT * FROM core.generate_translated_audio(
  'your-attraction-uuid'::uuid,
  'en-us',
  'female'
);

-- Example 2: Validate request before calling Edge Function
SELECT core.validate_translation_request(
  'your-attraction-uuid'::uuid,
  'en-us',
  'female'
);

-- Example 3: Check if translation already exists
SELECT 
  attraction_id,
  language,
  description,
  audio_url,
  created_at
FROM core.attraction_descriptions
WHERE attraction_id = 'your-attraction-uuid'::uuid
  AND language = 'en-us';
*/

-- ===========================================
-- VERIFICATION
-- ===========================================

-- Verify functions were created successfully
SELECT 
  routine_name,
  routine_type,
  data_type
FROM information_schema.routines 
WHERE routine_schema = 'core' 
  AND routine_name IN ('generate_translated_audio', 'validate_translation_request')
ORDER BY routine_name; 