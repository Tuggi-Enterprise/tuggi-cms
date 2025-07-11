-- POI Grouping Migration
-- Create attraction_groups and attraction_group_members tables
-- Add group_id to attraction_descriptions

-- 1. Create attraction_groups table
CREATE TABLE IF NOT EXISTS core.attraction_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid REFERENCES drive.profiles(id),
  created_at timestamp DEFAULT now()
);

-- 2. Create attraction_group_members table
CREATE TABLE IF NOT EXISTS core.attraction_group_members (
  group_id uuid REFERENCES core.attraction_groups(id) ON DELETE CASCADE,
  attraction_id uuid REFERENCES core.attractions(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, attraction_id)
);

-- 3. Add group_id to attraction_descriptions (shared description for group)
ALTER TABLE core.attraction_descriptions 
ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES core.attraction_groups(id);

-- 4. Ensure a POI can only belong to one group
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_attraction_group_member 
ON core.attraction_group_members(attraction_id);

-- 5. Comments
COMMENT ON TABLE core.attraction_groups IS 'Groups of nearby attractions for combined narration.';
COMMENT ON TABLE core.attraction_group_members IS 'Links attractions to their group. Each attraction can only be in one group.';
COMMENT ON COLUMN core.attraction_descriptions.group_id IS 'If set, this description is shared by all POIs in the group.'; 

-- 6. Enable Row Level Security (RLS)
ALTER TABLE core.attraction_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.attraction_group_members ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies for attraction_groups
-- Allow authenticated users to insert, select, update, and delete their own groups
CREATE POLICY "Authenticated users can insert attraction groups" 
  ON core.attraction_groups FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can read attraction groups" 
  ON core.attraction_groups FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can update their own attraction groups" 
  ON core.attraction_groups FOR UPDATE TO authenticated USING (auth.uid() = created_by) WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Authenticated users can delete their own attraction groups" 
  ON core.attraction_groups FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- Service role full access
CREATE POLICY "Service role can manage attraction groups" 
  ON core.attraction_groups FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 8. RLS Policies for attraction_group_members
-- Allow authenticated users to manage group members for groups they own
CREATE POLICY "Authenticated users can insert group members" 
  ON core.attraction_group_members FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM core.attraction_groups g WHERE g.id = group_id AND g.created_by = auth.uid())
  );
CREATE POLICY "Authenticated users can read group members" 
  ON core.attraction_group_members FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM core.attraction_groups g WHERE g.id = group_id AND g.created_by = auth.uid())
  );
CREATE POLICY "Authenticated users can delete group members" 
  ON core.attraction_group_members FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM core.attraction_groups g WHERE g.id = group_id AND g.created_by = auth.uid())
  );

-- Service role full access
CREATE POLICY "Service role can manage group members" 
  ON core.attraction_group_members FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 9. Grant permissions
GRANT INSERT, SELECT, UPDATE, DELETE ON core.attraction_groups TO authenticated;
GRANT INSERT, SELECT, DELETE ON core.attraction_group_members TO authenticated;
GRANT ALL ON core.attraction_groups TO service_role;
GRANT ALL ON core.attraction_group_members TO service_role;

-- 10. updated_at trigger for attraction_groups
CREATE OR REPLACE FUNCTION core.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE core.attraction_groups ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();
CREATE TRIGGER handle_updated_at 
    BEFORE UPDATE ON core.attraction_groups 
    FOR EACH ROW EXECUTE FUNCTION core.handle_updated_at(); 

-- 11. Function to return POIs inside a polygon (WKT)
create or replace function core.pois_in_polygon(wkt_polygon text)
returns table(attraction_id uuid) as $$
begin
  return query
    select ac.attraction_id
    from core.attraction_coordinate ac
    where ST_Intersects(
      ST_SetSRID(ST_MakePoint(ac.longitude, ac.latitude), 4326),
      ST_GeomFromText(wkt_polygon, 4326)
    );
end;
$$ language plpgsql stable SECURITY DEFINER; 