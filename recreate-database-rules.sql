-- ================================================================================
-- TUGGI CMS - DATABASE RECREATION SCRIPT
-- This script recreates all database rules, policies, and structures that were lost
-- ================================================================================

-- ===========================================
-- STEP 1: CREATE CORE SCHEMA AND TABLES
-- ===========================================

CREATE SCHEMA IF NOT EXISTS "core";
COMMENT ON SCHEMA "core" IS 'Shared data between TuggiDrive and TuggiWalk applications (POIs, attractions, city boundaries)';

-- Create import_batches table for tracking POI import operations
CREATE TABLE IF NOT EXISTS core.import_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NULL REFERENCES auth.users(id),
  polygon_id uuid NULL,
  search_category text NULL,
  total_found integer NULL DEFAULT 0,
  total_imported integer NULL DEFAULT 0,
  created_at timestamp with time zone NULL DEFAULT now(),
  updated_at timestamp with time zone NULL DEFAULT now(),
  
  CONSTRAINT import_batches_pkey PRIMARY KEY (id),
  CONSTRAINT import_batches_id_key UNIQUE (id)
) TABLESPACE pg_default;

-- Create indexes for import_batches performance
CREATE INDEX IF NOT EXISTS idx_import_batches_user_id ON core.import_batches USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_import_batches_created_at ON core.import_batches USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_batches_category ON core.import_batches USING btree (search_category);
CREATE INDEX IF NOT EXISTS idx_import_batches_polygon ON core.import_batches USING btree (polygon_id);

-- Add comment
COMMENT ON TABLE core.import_batches IS 'Tracks POI import operations for analytics and debugging';

-- Create cms_users table for CMS authentication and authorization
CREATE TABLE IF NOT EXISTS core.cms_users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  full_name text,
  role text NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  last_login_at timestamp with time zone,
  
  CONSTRAINT cms_users_pkey PRIMARY KEY (id),
  CONSTRAINT cms_users_email_key UNIQUE (email)
) TABLESPACE pg_default;

-- Create indexes for cms_users performance
CREATE INDEX IF NOT EXISTS idx_cms_users_email ON core.cms_users USING btree (email);
CREATE INDEX IF NOT EXISTS idx_cms_users_role ON core.cms_users USING btree (role);
CREATE INDEX IF NOT EXISTS idx_cms_users_active ON core.cms_users USING btree (is_active);

-- Add comment
COMMENT ON TABLE core.cms_users IS 'CMS user authentication and authorization table';

-- Create core.attractions table with exact production schema
CREATE TABLE IF NOT EXISTS core.attractions (
  id uuid not null default gen_random_uuid(),
  name text not null,
  description text null,
  city text not null,
  country text not null,
  image_url text null,
  rating numeric null default 0,
  audio_guides_count integer null default 0,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  google_place_id text null,
  category text null,
  approved boolean null default false,
  approved_by uuid null,
  approved_at timestamp with time zone null,
  is_premium boolean null default false,
  user_id uuid null,
  price_level integer null,
  formatted_phone_number text null,
  international_phone_number text null,
  business_status text null default 'OPERATIONAL'::text,
  vicinity text null,
  photos_references text[] null,
  import_source text null default 'manual'::text,
  import_batch_id uuid null,
  imported_from_polygon_id uuid null,
  constraint attractions_pkey primary key (id),
  constraint attractions_id_key unique (id),
  constraint attractions_user_id_fkey foreign key (user_id) references auth.users (id)
) TABLESPACE pg_default;

-- Create other core tables if they don't exist
CREATE TABLE IF NOT EXISTS core.attraction_coordinate (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "attraction_id" uuid NOT NULL REFERENCES core.attractions(id) ON DELETE CASCADE,
    "latitude" double precision NOT NULL,
    "longitude" double precision NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    
    CONSTRAINT attraction_coordinate_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS core.attraction_image (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "attraction_id" uuid NOT NULL REFERENCES core.attractions(id) ON DELETE CASCADE,
    "image_url" text NOT NULL,
    "alt_text" text,
    "created_at" timestamp with time zone DEFAULT now(),
    
    CONSTRAINT attraction_image_pkey PRIMARY KEY (id)
);

-- Add all production indexes for performance
CREATE INDEX IF NOT EXISTS idx_attractions_approved ON core.attractions USING btree (approved) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_attractions_premium ON core.attractions USING btree (is_premium) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_attractions_rating ON core.attractions USING btree (rating desc) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_attractions_approved_location ON core.attractions USING btree (approved, rating desc) TABLESPACE pg_default
WHERE (approved = true);

CREATE INDEX IF NOT EXISTS idx_attractions_search_optimized ON core.attractions USING btree (country, city, approved, rating desc, name) TABLESPACE pg_default
WHERE ((approved = true) AND (rating >= 2.0));

CREATE INDEX IF NOT EXISTS idx_attractions_category_rating ON core.attractions USING btree (category, rating desc, is_premium) TABLESPACE pg_default
WHERE (approved = true);

CREATE INDEX IF NOT EXISTS idx_attractions_import_source ON core.attractions USING btree (import_source) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_attractions_import_batch ON core.attractions USING btree (import_batch_id) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_attractions_business_status ON core.attractions USING btree (business_status) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS attractions_google_place_id_idx ON core.attractions USING btree (google_place_id) TABLESPACE pg_default;

-- Add foreign key constraint for import_batch_id (if import_batches table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'core' AND table_name = 'import_batches') AND
       NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_attractions_import_batch') THEN
        ALTER TABLE core.attractions ADD CONSTRAINT fk_attractions_import_batch 
        FOREIGN KEY (import_batch_id) REFERENCES core.import_batches(id);
    END IF;
END $$;

-- ===========================================
-- STEP 2: ENABLE ROW LEVEL SECURITY (RLS)
-- ===========================================

-- Enable RLS on all core tables
ALTER TABLE core.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.attractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.attraction_coordinate ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.attraction_image ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.cms_users ENABLE ROW LEVEL SECURITY;

-- ===========================================
-- STEP 3: CREATE RLS POLICIES
-- ===========================================

-- Import Batches Policies
CREATE POLICY "Users can insert their own import batches" 
ON core.import_batches FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can read their own import batches" 
ON core.import_batches FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can update their own import batches" 
ON core.import_batches FOR UPDATE 
TO authenticated 
USING (auth.uid() = user_id OR user_id IS NULL)
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Attractions Policies
CREATE POLICY "Authenticated users can insert attractions" 
ON core.attractions FOR INSERT 
TO authenticated 
WITH CHECK (true);

CREATE POLICY "Authenticated users can read attractions" 
ON core.attractions FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Users can update their own attractions" 
ON core.attractions FOR UPDATE 
TO authenticated 
USING (auth.uid() = user_id OR user_id IS NULL)
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Attraction Coordinate Policies
CREATE POLICY "Authenticated users can insert attraction coordinates" 
ON core.attraction_coordinate FOR INSERT 
TO authenticated 
WITH CHECK (true);

CREATE POLICY "Authenticated users can read attraction coordinates" 
ON core.attraction_coordinate FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Authenticated users can update attraction coordinates" 
ON core.attraction_coordinate FOR UPDATE 
TO authenticated 
USING (true)
WITH CHECK (true);

-- Attraction Image Policies
CREATE POLICY "Authenticated users can insert attraction images" 
ON core.attraction_image FOR INSERT 
TO authenticated 
WITH CHECK (true);

CREATE POLICY "Authenticated users can read attraction images" 
ON core.attraction_image FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Authenticated users can update attraction images" 
ON core.attraction_image FOR UPDATE 
TO authenticated 
USING (true)
WITH CHECK (true);

-- CMS Users Policies (simple, no recursion)
CREATE POLICY "Authenticated users can read cms users" 
ON core.cms_users FOR SELECT 
TO authenticated 
USING (true);

-- Only service role can modify cms_users (no recursion risk)
CREATE POLICY "Only service role can modify cms users" 
ON core.cms_users FOR ALL 
TO service_role 
USING (true)
WITH CHECK (true);

-- Service role policies (for edge functions)
CREATE POLICY "Service role can manage import batches" 
ON core.import_batches FOR ALL 
TO service_role 
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role can manage attractions" 
ON core.attractions FOR ALL 
TO service_role 
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role can manage attraction coordinates" 
ON core.attraction_coordinate FOR ALL 
TO service_role 
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role can manage attraction images" 
ON core.attraction_image FOR ALL 
TO service_role 
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role can manage cms users" 
ON core.cms_users FOR ALL 
TO service_role 
USING (true)
WITH CHECK (true);

-- ===========================================
-- STEP 4: GRANT PERMISSIONS
-- ===========================================

-- Grant schema usage
GRANT USAGE ON SCHEMA core TO authenticated;
GRANT USAGE ON SCHEMA core TO service_role;

-- Grant table permissions to authenticated users
GRANT INSERT, SELECT, UPDATE ON core.attractions TO authenticated;
GRANT INSERT, SELECT, UPDATE ON core.import_batches TO authenticated;
GRANT INSERT, SELECT, UPDATE ON core.attraction_coordinate TO authenticated;
GRANT INSERT, SELECT, UPDATE ON core.attraction_image TO authenticated;
GRANT SELECT ON core.cms_users TO authenticated;

-- Grant full permissions to service role for edge functions
GRANT ALL ON ALL TABLES IN SCHEMA core TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA core TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA core TO service_role;

-- ===========================================
-- STEP 5: CREATE HELPFUL FUNCTIONS
-- ===========================================

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION core.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER handle_updated_at 
    BEFORE UPDATE ON core.attractions 
    FOR EACH ROW EXECUTE FUNCTION core.handle_updated_at();

CREATE TRIGGER handle_updated_at 
    BEFORE UPDATE ON core.import_batches 
    FOR EACH ROW EXECUTE FUNCTION core.handle_updated_at();

CREATE TRIGGER handle_updated_at 
    BEFORE UPDATE ON core.attraction_coordinate 
    FOR EACH ROW EXECUTE FUNCTION core.handle_updated_at();

CREATE TRIGGER handle_updated_at 
    BEFORE UPDATE ON core.cms_users 
    FOR EACH ROW EXECUTE FUNCTION core.handle_updated_at();

-- ===========================================
-- SCRIPT COMPLETION MESSAGE
-- ===========================================

SELECT 'Database rules and policies have been successfully recreated!' as status;

-- ===========================================
-- SAMPLE: CREATE FIRST ADMIN USER
-- ===========================================

/*
-- After running this script, create your first admin user:
-- Replace 'your-email@example.com' with your actual email address

INSERT INTO core.cms_users (email, full_name, role, is_active)
VALUES ('your-email@example.com', 'Your Full Name', 'admin', true)
ON CONFLICT (email) DO UPDATE SET
  role = EXCLUDED.role,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- Verify the user was created:
SELECT email, full_name, role, is_active, created_at 
FROM core.cms_users 
WHERE email = 'your-email@example.com';
*/ 