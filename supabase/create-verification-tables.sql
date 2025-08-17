-- ===========================================
-- CREATE VERIFICATION TABLES FOR FACTUAL CHECKING
-- ===========================================
-- This script creates the necessary tables for the factual verification system
-- Includes description_scores, description_claims, description_claim_evidence, and verify_settings

-- ===========================================
-- ADD VERIFICATION COLUMNS TO ATTRACTION_DESCRIPTIONS
-- ===========================================

-- Add verification-related columns to attraction_descriptions
ALTER TABLE core.attraction_descriptions 
ADD COLUMN IF NOT EXISTS is_original boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'needs_review', 'rejected')),
ADD COLUMN IF NOT EXISTS verification_score numeric(3,2),
ADD COLUMN IF NOT EXISTS verification_updated_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS description_hash text;

-- Create index for verification queries
CREATE INDEX IF NOT EXISTS idx_attraction_descriptions_verification 
ON core.attraction_descriptions(is_original, verification_status, verification_score);

CREATE INDEX IF NOT EXISTS idx_attraction_descriptions_hash 
ON core.attraction_descriptions(description_hash);

-- ===========================================
-- CREATE DESCRIPTION_SCORES TABLE
-- ===========================================

CREATE TABLE IF NOT EXISTS core.description_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  description_id uuid NOT NULL REFERENCES core.attraction_descriptions(id) ON DELETE CASCADE,
  description_hash text NOT NULL,
  overall_score numeric(3,2) NOT NULL,
  factuality_score numeric(3,2) NOT NULL,
  coherence_score numeric(3,2) NOT NULL,
  tts_clarity_score numeric(3,2) NOT NULL,
  rules_score numeric(3,2) NOT NULL,
  claims_count integer DEFAULT 0,
  supported_claims integer DEFAULT 0,
  contradicted_claims integer DEFAULT 0,
  not_found_claims integer DEFAULT 0,
  verification_status text DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'needs_review', 'rejected')),
  processed_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now()
);

-- Create indexes for description_scores
CREATE INDEX IF NOT EXISTS idx_description_scores_description_id 
ON core.description_scores(description_id);

CREATE INDEX IF NOT EXISTS idx_description_scores_hash 
ON core.description_scores(description_hash);

CREATE INDEX IF NOT EXISTS idx_description_scores_status 
ON core.description_scores(verification_status);

-- ===========================================
-- CREATE DESCRIPTION_CLAIMS TABLE
-- ===========================================

CREATE TABLE IF NOT EXISTS core.description_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  description_id uuid NOT NULL REFERENCES core.attraction_descriptions(id) ON DELETE CASCADE,
  score_id uuid NOT NULL REFERENCES core.description_scores(id) ON DELETE CASCADE,
  claim_text text NOT NULL,
  claim_type text CHECK (claim_type IN ('year', 'person', 'event', 'restoration', 'location', 'other')),
  status text DEFAULT 'not_found' CHECK (status IN ('supported', 'contradicted', 'not_found')),
  confidence numeric(3,2) NOT NULL,
  evidence_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);

-- Create indexes for description_claims
CREATE INDEX IF NOT EXISTS idx_description_claims_description_id 
ON core.description_claims(description_id);

CREATE INDEX IF NOT EXISTS idx_description_claims_score_id 
ON core.description_claims(score_id);

CREATE INDEX IF NOT EXISTS idx_description_claims_status 
ON core.description_claims(status);

-- ===========================================
-- CREATE DESCRIPTION_CLAIM_EVIDENCE TABLE
-- ===========================================

CREATE TABLE IF NOT EXISTS core.description_claim_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES core.description_claims(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('wikipedia', 'wikidata', 'iphan', 'unesco', 'other')),
  page_title text,
  url text,
  quote text NOT NULL,
  relevance_score numeric(3,2),
  created_at timestamp with time zone DEFAULT now()
);

-- Create indexes for description_claim_evidence
CREATE INDEX IF NOT EXISTS idx_description_claim_evidence_claim_id 
ON core.description_claim_evidence(claim_id);

CREATE INDEX IF NOT EXISTS idx_description_claim_evidence_source 
ON core.description_claim_evidence(source);

-- ===========================================
-- CREATE VERIFY_SETTINGS TABLE
-- ===========================================

CREATE TABLE IF NOT EXISTS core.verify_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value jsonb NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Insert default verification settings
INSERT INTO core.verify_settings (key, value, description) VALUES
('scorer_weights', '{"factuality": 0.4, "coherence": 0.2, "tts_clarity": 0.2, "rules": 0.2}', 'Weights for different scoring components'),
('factuality_thresholds', '{"excellent": 0.9, "good": 0.7, "acceptable": 0.5, "poor": 0.3}', 'Thresholds for factuality scores'),
('batch_size', '20', 'Default batch size for verification processing'),
('escalate_threshold', '0.7', 'Confidence threshold for escalating to Gemini Pro'),
('cache_ttl_days', '21', 'Cache TTL for external API responses in days')
ON CONFLICT (key) DO NOTHING;

-- ===========================================
-- CREATE ATTRACTION_ENTITY_LINKS TABLE
-- ===========================================

CREATE TABLE IF NOT EXISTS core.attraction_entity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attraction_id uuid NOT NULL REFERENCES core.attractions(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('wikipedia', 'wikidata', 'iphan', 'unesco')),
  entity_id text NOT NULL,
  entity_name text NOT NULL,
  confidence numeric(3,2) NOT NULL,
  last_verified timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(attraction_id, entity_type, entity_id)
);

-- Create indexes for attraction_entity_links
CREATE INDEX IF NOT EXISTS idx_attraction_entity_links_attraction_id 
ON core.attraction_entity_links(attraction_id);

CREATE INDEX IF NOT EXISTS idx_attraction_entity_links_entity 
ON core.attraction_entity_links(entity_type, entity_id);

-- ===========================================
-- CREATE VIEW FOR DESCRIPTIONS WITH LAST SCORE
-- ===========================================

CREATE OR REPLACE VIEW core.v_descriptions_with_last_score AS
SELECT 
  ad.id,
  ad.attraction_id,
  ad.description,
  ad.is_original,
  ad.verification_status,
  ad.verification_score,
  ad.verification_updated_at,
  ad.description_hash,
  ad.language,
  ad.audio_url,
  ad.created_at,
  ad.updated_at,
  ds.overall_score as last_overall_score,
  ds.factuality_score as last_factuality_score,
  ds.coherence_score as last_coherence_score,
  ds.tts_clarity_score as last_tts_clarity_score,
  ds.rules_score as last_rules_score,
  ds.claims_count as last_claims_count,
  ds.supported_claims as last_supported_claims,
  ds.contradicted_claims as last_contradicted_claims,
  ds.not_found_claims as last_not_found_claims,
  ds.processed_at as last_processed_at,
  a.name as attraction_name,
  a.city,
  a.country
FROM core.attraction_descriptions ad
LEFT JOIN core.attractions a ON ad.attraction_id = a.id
LEFT JOIN LATERAL (
  SELECT * FROM core.description_scores ds2 
  WHERE ds2.description_id = ad.id 
  ORDER BY ds2.processed_at DESC 
  LIMIT 1
) ds ON true;

-- ===========================================
-- CREATE TRIGGER TO UPDATE ATTRACTION_DESCRIPTIONS
-- ===========================================

CREATE OR REPLACE FUNCTION core.update_description_verification_status()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the attraction_descriptions table with the latest verification status
  UPDATE core.attraction_descriptions 
  SET 
    verification_status = NEW.verification_status,
    verification_score = NEW.overall_score,
    verification_updated_at = NEW.processed_at
  WHERE id = NEW.description_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_update_description_verification_status ON core.description_scores;
CREATE TRIGGER trigger_update_description_verification_status
  AFTER INSERT OR UPDATE ON core.description_scores
  FOR EACH ROW
  EXECUTE FUNCTION core.update_description_verification_status();

-- ===========================================
-- ENABLE ROW LEVEL SECURITY
-- ===========================================

-- Enable RLS on all new tables
ALTER TABLE core.description_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.description_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.description_claim_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.verify_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.attraction_entity_links ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for authenticated users
CREATE POLICY "Authenticated users can read description_scores" 
  ON core.description_scores FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read description_claims" 
  ON core.description_claims FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read description_claim_evidence" 
  ON core.description_claim_evidence FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read verify_settings" 
  ON core.verify_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read attraction_entity_links" 
  ON core.attraction_entity_links FOR SELECT TO authenticated USING (true);

-- Grant permissions to service_role for automated processing
GRANT ALL ON core.description_scores TO service_role;
GRANT ALL ON core.description_claims TO service_role;
GRANT ALL ON core.description_claim_evidence TO service_role;
GRANT ALL ON core.verify_settings TO service_role;
GRANT ALL ON core.attraction_entity_links TO service_role;

-- ===========================================
-- ADD COMMENTS
-- ===========================================

COMMENT ON TABLE core.description_scores IS 'Scores and verification results for attraction descriptions';
COMMENT ON TABLE core.description_claims IS 'Individual factual claims extracted from descriptions';
COMMENT ON TABLE core.description_claim_evidence IS 'Evidence supporting or contradicting claims';
COMMENT ON TABLE core.verify_settings IS 'Configuration settings for the verification system';
COMMENT ON TABLE core.attraction_entity_links IS 'Links between attractions and external entities (Wikipedia, Wikidata, etc.)';

COMMENT ON COLUMN core.attraction_descriptions.is_original IS 'Whether this is an original description (not translated or modified)';
COMMENT ON COLUMN core.attraction_descriptions.verification_status IS 'Current verification status: pending, verified, needs_review, rejected';
COMMENT ON COLUMN core.attraction_descriptions.verification_score IS 'Overall verification score (0-1)';
COMMENT ON COLUMN core.attraction_descriptions.description_hash IS 'SHA256 hash of the description text for change detection';

-- ===========================================
-- VERIFICATION COMPLETE
-- ===========================================

SELECT 'Verification tables created successfully!' as status;
