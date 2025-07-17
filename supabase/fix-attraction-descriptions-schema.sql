-- ===========================================
-- FIX ATTRACTION_DESCRIPTIONS TABLE FOR TRANSLATION FEATURE
-- ===========================================
-- This script adds the missing gender column and unique constraint
-- Required for the translate_and_generate_audio Edge Function

-- ===========================================
-- ADD GENDER COLUMN IF IT DOESN'T EXIST
-- ===========================================

DO $$
BEGIN
    -- Check if gender column exists and add if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'core' 
        AND table_name = 'attraction_descriptions' 
        AND column_name = 'gender'
    ) THEN
        ALTER TABLE core.attraction_descriptions 
        ADD COLUMN gender text DEFAULT 'male' CHECK (gender IN ('male', 'female'));
        
        RAISE NOTICE 'Added gender column to core.attraction_descriptions';
    ELSE
        RAISE NOTICE 'gender column already exists in core.attraction_descriptions';
    END IF;
END $$;

-- ===========================================
-- ADD UNIQUE CONSTRAINT
-- ===========================================

DO $$
BEGIN
    -- Check if unique constraint exists and add if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE table_schema = 'core' 
        AND table_name = 'attraction_descriptions' 
        AND constraint_name = 'attraction_descriptions_unique_lang_gender'
    ) THEN
        ALTER TABLE core.attraction_descriptions 
        ADD CONSTRAINT attraction_descriptions_unique_lang_gender 
        UNIQUE (attraction_id, language, gender);
        
        RAISE NOTICE 'Added unique constraint on (attraction_id, language, gender)';
    ELSE
        RAISE NOTICE 'Unique constraint already exists on attraction_descriptions';
    END IF;
END $$;

-- ===========================================
-- UPDATE EXISTING RECORDS
-- ===========================================

-- Set default gender for existing records without gender
UPDATE core.attraction_descriptions 
SET gender = 'male' 
WHERE gender IS NULL;

-- ===========================================
-- ADD COMMENTS
-- ===========================================

COMMENT ON COLUMN core.attraction_descriptions.gender IS 'Voice gender used for audio generation (male or female)';

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

-- Display constraints
SELECT 
    constraint_name,
    constraint_type
FROM information_schema.table_constraints 
WHERE table_schema = 'core' 
  AND table_name = 'attraction_descriptions'
ORDER BY constraint_type, constraint_name;

SELECT 'attraction_descriptions table fixed for translation feature!' as status; 