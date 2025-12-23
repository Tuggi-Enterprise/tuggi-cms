-- ✅ Migration: Add Facts Pack support and Narrations Cache
-- Description: Adds columns for AI context and creates cache table for episodic generated audio.
-- Date: 2025-12-23

DO $$ 
BEGIN
    -- 1. AI Context Columns (Facts Pack)
    -- Add facts_pack_json column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'core' 
                   AND table_name = 'attraction_descriptions' 
                   AND column_name = 'facts_pack_json') THEN
        ALTER TABLE core.attraction_descriptions ADD COLUMN facts_pack_json JSONB;
    END IF;

    -- Add facts_version column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'core' 
                   AND table_name = 'attraction_descriptions' 
                   AND column_name = 'facts_version') THEN
        ALTER TABLE core.attraction_descriptions ADD COLUMN facts_version INTEGER DEFAULT 1 NOT NULL;
    END IF;

    -- Add base_narrative_text column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'core' 
                   AND table_name = 'attraction_descriptions' 
                   AND column_name = 'base_narrative_text') THEN
        ALTER TABLE core.attraction_descriptions ADD COLUMN base_narrative_text TEXT;
    END IF;

    -- Add updated_at column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'core' 
                   AND table_name = 'attraction_descriptions' 
                   AND column_name = 'updated_at') THEN
        ALTER TABLE core.attraction_descriptions ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;

END $$;

-- 2. Narrations Cache Table (Context Signature)
-- Stores generated audio/text referenced by a hash of the context (POI + Mode + Direction + Language)
CREATE TABLE IF NOT EXISTS core.cache_narrations (
    cache_key TEXT PRIMARY KEY, -- SHA256 of Context Signature
    poi_id UUID NOT NULL REFERENCES core.attractions(id) ON DELETE CASCADE,
    language TEXT NOT NULL,
    travel_mode TEXT NOT NULL, -- 'drive', 'walk', 'train', etc.
    direction_bucket TEXT NOT NULL, -- 'north', 'south', 'approaching_from_X'
    
    -- Content
    audio_url TEXT,
    text_content TEXT,
    
    -- Metadata
    generation_metadata JSONB, -- Model used, tokens, processing time
    hit_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE, -- TTL
    
    -- Indexes
    CONSTRAINT check_cache_expiration CHECK (expires_at > created_at)
);

-- Index for cleanup of expired items
CREATE INDEX IF NOT EXISTS idx_cache_narrations_expires_at ON core.cache_narrations(expires_at);

-- Comment describing the table purpose
COMMENT ON TABLE core.cache_narrations IS 'Cache for AI-generated episodic narrations. keyed by Context Signature to allow cross-user reuse.';
