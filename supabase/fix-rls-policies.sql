-- Fix RLS Policies for POI Importer

-- 1. Enable RLS on import_batches table (if not already enabled)
ALTER TABLE core.import_batches ENABLE ROW LEVEL SECURITY;

-- 2. Add RLS policies for import_batches table
-- Allow authenticated users to insert their own import batches
CREATE POLICY "Users can insert their own import batches" 
ON core.import_batches FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Allow authenticated users to read their own import batches
CREATE POLICY "Users can read their own import batches" 
ON core.import_batches FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id OR user_id IS NULL);

-- 3. Add/Update RLS policies for attractions table
-- Allow authenticated users to insert attractions
CREATE POLICY "Authenticated users can insert attractions" 
ON core.attractions FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Allow authenticated users to read all attractions
CREATE POLICY "Authenticated users can read attractions" 
ON core.attractions FOR SELECT 
TO authenticated 
USING (true);

-- Allow authenticated users to update attractions they created
CREATE POLICY "Users can update their own attractions" 
ON core.attractions FOR UPDATE 
TO authenticated 
USING (auth.uid() = user_id OR user_id IS NULL)
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- 4. Add RLS policies for attraction_image table
-- Allow authenticated users to insert image references
CREATE POLICY "Authenticated users can insert attraction images" 
ON core.attraction_image FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Allow authenticated users to read all attraction images
CREATE POLICY "Authenticated users can read attraction images" 
ON core.attraction_image FOR SELECT 
TO authenticated 
USING (true);

-- Allow service role to bypass RLS entirely
CREATE POLICY "Service role can manage attraction images" 
ON core.attraction_image FOR ALL 
TO service_role 
USING (true)
WITH CHECK (true);

-- 5. Grant necessary permissions to authenticated role
GRANT USAGE ON SCHEMA core TO authenticated;
GRANT INSERT, SELECT, UPDATE ON core.attractions TO authenticated;
GRANT INSERT, SELECT ON core.import_batches TO authenticated;
GRANT INSERT, SELECT, UPDATE ON core.attraction_coordinate TO authenticated;
GRANT INSERT, SELECT, UPDATE ON core.attraction_image TO authenticated;

-- 6. Grant full permissions to service role for edge functions
GRANT USAGE ON SCHEMA core TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA core TO service_role; 