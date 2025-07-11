-- Add group_role to track POI status within groups
ALTER TABLE core.attraction_group_members 
ADD COLUMN group_role VARCHAR(20) DEFAULT 'member' CHECK (group_role IN ('main', 'member'));

-- Update existing records to have a main POI (first one created)
UPDATE core.attraction_group_members 
SET group_role = 'main' 
WHERE (group_id, attraction_id) IN (
  SELECT DISTINCT ON (group_id) group_id, attraction_id
  FROM core.attraction_group_members 
  ORDER BY group_id, attraction_id
);

-- Create index for performance
CREATE INDEX idx_attraction_group_members_role ON core.attraction_group_members(group_role);

-- Add comment for documentation
COMMENT ON COLUMN core.attraction_group_members.group_role IS 'Role of POI in group: main (holds group description) or member (uses group description)'; 