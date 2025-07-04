-- Create saved_polygons table for POI Importer polygon management
-- This table stores user-drawn polygons for reuse in POI searches

-- ===========================================
-- CREATE SAVED_POLYGONS TABLE
-- ===========================================

CREATE TABLE IF NOT EXISTS core.saved_polygons (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  paths jsonb NOT NULL,  -- Stores GeoJSON polygon data
  user_id uuid NULL REFERENCES auth.users(id),
  country_name text NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  
  CONSTRAINT saved_polygons_pkey PRIMARY KEY (id)
) TABLESPACE pg_default;

-- ===========================================
-- ADD INDEXES FOR PERFORMANCE
-- ===========================================

-- Index for user lookups
CREATE INDEX IF NOT EXISTS idx_saved_polygons_user_id ON core.saved_polygons USING btree (user_id);

-- Index for country searches
CREATE INDEX IF NOT EXISTS idx_saved_polygons_country ON core.saved_polygons USING btree (country_name);

-- Index for created_at sorting
CREATE INDEX IF NOT EXISTS idx_saved_polygons_created_at ON core.saved_polygons USING btree (created_at DESC);

-- GIN index for paths JSONB searches (if needed for spatial queries)
CREATE INDEX IF NOT EXISTS idx_saved_polygons_paths ON core.saved_polygons USING GIN (paths);

-- ===========================================
-- ADD RLS POLICIES
-- ===========================================

-- Enable RLS
ALTER TABLE core.saved_polygons ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all polygons (for shared access)
CREATE POLICY "Authenticated users can read saved polygons" 
ON core.saved_polygons FOR SELECT 
TO authenticated 
USING (true);

-- Allow users to insert their own polygons
CREATE POLICY "Users can insert their own polygons" 
ON core.saved_polygons FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Allow users to update their own polygons
CREATE POLICY "Users can update their own polygons" 
ON core.saved_polygons FOR UPDATE 
TO authenticated 
USING (auth.uid() = user_id OR user_id IS NULL)
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Allow users to delete their own polygons
CREATE POLICY "Users can delete their own polygons" 
ON core.saved_polygons FOR DELETE 
TO authenticated 
USING (auth.uid() = user_id OR user_id IS NULL);

-- Service role full access
CREATE POLICY "Service role can manage saved polygons" 
ON core.saved_polygons FOR ALL 
TO service_role 
USING (true)
WITH CHECK (true);

-- ===========================================
-- GRANT PERMISSIONS
-- ===========================================

-- Grant permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON core.saved_polygons TO authenticated;

-- Grant full permissions to service role
GRANT ALL ON core.saved_polygons TO service_role;

-- ===========================================
-- ADD TRIGGER FOR UPDATED_AT
-- ===========================================

-- Add trigger for automatic updated_at timestamp
CREATE TRIGGER handle_updated_at 
    BEFORE UPDATE ON core.saved_polygons 
    FOR EACH ROW EXECUTE FUNCTION core.handle_updated_at();

-- ===========================================
-- ADD TABLE COMMENT
-- ===========================================

COMMENT ON TABLE core.saved_polygons IS 'User-drawn polygons for POI search areas, stored as GeoJSON with country information';

-- ===========================================
-- VERIFY TABLE CREATION
-- ===========================================

SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_schema = 'core' 
  AND table_name = 'saved_polygons'
ORDER BY column_name;

SELECT 'saved_polygons table created successfully!' as status; 