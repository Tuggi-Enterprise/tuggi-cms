-- ===========================================
-- ADD AUDIO_URL COLUMN TO ATTRACTION_DESCRIPTIONS
-- ===========================================
-- This script ensures the audio_url column exists for storing generated audio files
-- Safe to run multiple times (uses IF NOT EXISTS logic)

-- ===========================================
-- ADD AUDIO_URL COLUMN IF IT DOESN'T EXIST
-- ===========================================

DO $$
BEGIN
    -- Check if audio_url column exists and add if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'core' 
        AND table_name = 'attraction_descriptions' 
        AND column_name = 'audio_url'
    ) THEN
        ALTER TABLE core.attraction_descriptions 
        ADD COLUMN audio_url text;
        
        RAISE NOTICE 'Added audio_url column to core.attraction_descriptions';
    ELSE
        RAISE NOTICE 'audio_url column already exists in core.attraction_descriptions';
    END IF;
END $$;

-- ===========================================
-- ADD LANGUAGE COLUMN IF IT DOESN'T EXIST
-- ===========================================

DO $$
BEGIN
    -- Check if language column exists and add if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'core' 
        AND table_name = 'attraction_descriptions' 
        AND column_name = 'language'
    ) THEN
        ALTER TABLE core.attraction_descriptions 
        ADD COLUMN language text DEFAULT 'pt-br';
        
        RAISE NOTICE 'Added language column to core.attraction_descriptions';
    ELSE
        RAISE NOTICE 'language column already exists in core.attraction_descriptions';
    END IF;
END $$;

-- ===========================================
-- ADD TITLE COLUMN IF IT DOESN'T EXIST
-- ===========================================

DO $$
BEGIN
    -- Check if title column exists and add if missing  
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'core' 
        AND table_name = 'attraction_descriptions' 
        AND column_name = 'title'
    ) THEN
        ALTER TABLE core.attraction_descriptions 
        ADD COLUMN title text;
        
        RAISE NOTICE 'Added title column to core.attraction_descriptions';
    ELSE
        RAISE NOTICE 'title column already exists in core.attraction_descriptions';
    END IF;
END $$;

-- ===========================================
-- CREATE INDEXES FOR PERFORMANCE
-- ===========================================

-- Index for language lookups
CREATE INDEX IF NOT EXISTS idx_attraction_descriptions_language 
ON core.attraction_descriptions(language);

-- Index for attraction_id + language (unique lookups)
CREATE INDEX IF NOT EXISTS idx_attraction_descriptions_attraction_language 
ON core.attraction_descriptions(attraction_id, language);

-- Index for audio_url (to find items with/without audio)
CREATE INDEX IF NOT EXISTS idx_attraction_descriptions_audio_url 
ON core.attraction_descriptions(audio_url) WHERE audio_url IS NOT NULL;

-- ===========================================
-- ADD CONSTRAINTS
-- ===========================================

-- Ensure language codes are lowercase
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints 
        WHERE constraint_schema = 'core' 
        AND constraint_name = 'attraction_descriptions_language_lowercase'
    ) THEN
        ALTER TABLE core.attraction_descriptions 
        ADD CONSTRAINT attraction_descriptions_language_lowercase 
        CHECK (language = lower(language));
        
        RAISE NOTICE 'Added language lowercase constraint';
    END IF;
END $$;

-- ===========================================
-- UPDATE EXISTING DATA
-- ===========================================

-- Set default language for existing records without language
UPDATE core.attraction_descriptions 
SET language = 'pt-br' 
WHERE language IS NULL;

-- ===========================================
-- ADD TABLE COMMENTS
-- ===========================================

COMMENT ON COLUMN core.attraction_descriptions.audio_url IS 'Public URL to generated audio file (MP3) for this description';
COMMENT ON COLUMN core.attraction_descriptions.language IS 'Language code (ISO format, lowercase) for this description (e.g., pt-br, en-us, es-es)';
COMMENT ON COLUMN core.attraction_descriptions.title IS 'Optional title for the description (used for grouped descriptions)';

-- ===========================================
-- VERIFY SCHEMA
-- ===========================================

-- Display current table structure
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default,
    character_maximum_length
FROM information_schema.columns 
WHERE table_schema = 'core' 
  AND table_name = 'attraction_descriptions'
ORDER BY ordinal_position;

-- Display indexes
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename = 'attraction_descriptions' 
  AND schemaname = 'core'
ORDER BY indexname;

-- Display constraints
SELECT 
    constraint_name,
    constraint_type
FROM information_schema.table_constraints 
WHERE table_schema = 'core' 
  AND table_name = 'attraction_descriptions'
ORDER BY constraint_type, constraint_name;

SELECT 'attraction_descriptions table updated successfully for translated audio support!' as status; 