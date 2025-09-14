-- Create RPC function to efficiently find unprocessed POIs
-- This avoids the need to filter large result sets in the application

CREATE OR REPLACE FUNCTION core.get_unprocessed_pois(
  batch_limit integer DEFAULT 50,
  last_id text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  name text,
  city text,
  state text,
  country text,
  category text,
  formatted_address text,
  osm_tags jsonb
) 
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    a.id,
    a.name,
    a.city,
    a.state,
    a.country,
    a.category,
    a.formatted_address,
    a.osm_tags
  FROM core.attractions a
  LEFT JOIN core.poi_name_validations v ON a.id = v.attraction_id
  WHERE 
    a.country = 'BR'
    AND v.attraction_id IS NULL  -- Not yet processed
    AND (last_id IS NULL OR a.id::text > last_id)  -- Cursor pagination with cast
  ORDER BY a.id ASC
  LIMIT batch_limit;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION core.get_unprocessed_pois(integer, text) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION core.get_unprocessed_pois(integer, text) IS 'Efficiently finds Brazilian POIs that have not been processed for name validation yet';
