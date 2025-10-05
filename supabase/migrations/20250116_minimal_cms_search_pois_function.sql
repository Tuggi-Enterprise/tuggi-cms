-- Versão mínima da função RPC para teste
DROP FUNCTION IF EXISTS core.cms_search_pois(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN
);

CREATE OR REPLACE FUNCTION core.cms_search_pois(
  search_term TEXT DEFAULT NULL,
  status_filter TEXT DEFAULT 'all',
  country_filter TEXT DEFAULT NULL,
  state_filter TEXT DEFAULT NULL,
  city_filter TEXT DEFAULT NULL,
  google_types_filter TEXT DEFAULT NULL,
  category_filter TEXT DEFAULT NULL,
  content_status_filter TEXT DEFAULT NULL,
  group_status_filter TEXT DEFAULT NULL,
  score_filter TEXT DEFAULT NULL,
  trigger_points_filter TEXT DEFAULT NULL,
  limit_count INTEGER DEFAULT 1000,
  offset_count INTEGER DEFAULT 0,
  fetch_all BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  -- Campos básicos apenas
  id TEXT,
  name TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  google_place_id TEXT,
  category TEXT,
  image_url TEXT,
  thumbnail_url TEXT,
  approved BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  user_id TEXT,
  user_ratings_total INTEGER,
  is_premium BOOLEAN,
  website TEXT,
  vicinity TEXT,
  formatted_address TEXT,
  wheelchair_accessible BOOLEAN,
  heritage_status TEXT,
  architectural_style TEXT,
  landmark_type TEXT,
  unesco_status TEXT,
  cultural_significance TEXT,
  pov_quality_score NUMERIC(5,2),
  photogenic_score NUMERIC(5,2),
  accessibility_score NUMERIC(5,2),
  visibility_score NUMERIC(5,2),
  
  -- Coordinates
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  
  -- Descriptions
  descriptions JSONB,
  
  -- Trigger points
  trigger_points JSONB,
  
  -- Group membership
  group_membership JSONB,
  
  -- Verification data
  verification_data JSONB,
  
  -- Counts básicos
  total_count BIGINT,
  approved_count BIGINT,
  pending_count BIGINT,
  with_description_count BIGINT,
  with_audio_count BIGINT,
  with_trigger_points_count BIGINT,
  complete_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Query muito simples sem WHERE conditions complexas
  RETURN QUERY
  SELECT 
    a.id::TEXT,
    a.name,
    a.city,
    a.state,
    a.country,
    a.google_place_id,
      a.category,
      a.image_url,
    a.thumbnail_url,
    a.approved,
    a.created_at,
    a.updated_at,
      a.user_id::TEXT,
      a.user_ratings_total,
      a.is_premium,
      a.website,
      a.vicinity,
      a.formatted_address,
      a.wheelchair_accessible,
    a.heritage_status,
    a.architectural_style,
    a.landmark_type,
    a.unesco_status,
    a.cultural_significance,
    a.pov_quality_score,
    a.photogenic_score,
    a.accessibility_score,
    a.visibility_score,
    ac.latitude,
    ac.longitude,
    
    -- Descriptions simples
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', ad.id,
            'language', ad.language,
            'description', ad.description,
            'audio_url', ad.audio_url,
            'verification_status', ad.verification_status,
            'last_verified_at', ad.last_verified_at,
            'is_original', ad.is_original
          )
        )
        FROM core.attraction_descriptions ad 
        WHERE ad.attraction_id = a.id
      ), 
      '[]'::jsonb
    ) as descriptions,
    
    -- Trigger points simples
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', atp.id,
            'is_active', atp.is_active
          )
        )
        FROM core.attraction_trigger_points atp 
        WHERE atp.attraction_id = a.id
      ),
      '[]'::jsonb
    ) as trigger_points,
    
    -- Group membership simples
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'group_id', agm.group_id,
            'group_role', agm.group_role,
            'group_name', ag.name
          )
        )
        FROM core.attraction_group_members agm
        LEFT JOIN core.attraction_groups ag ON agm.group_id = ag.id
        WHERE agm.attraction_id = a.id
      ),
      '[]'::jsonb
    ) as group_membership,
    
    -- Verification data simples
    (
      SELECT jsonb_build_object(
        'verification_status', ad_orig.verification_status,
        'score', ds_orig.score_overall,
        'last_verified_at', ad_orig.last_verified_at,
        'is_original', ad_orig.is_original,
        'language', ad_orig.language,
        'description_id', ad_orig.id
      )
      FROM core.attraction_descriptions ad_orig
      LEFT JOIN core.description_scores ds_orig ON ad_orig.id = ds_orig.description_id
      WHERE ad_orig.attraction_id = a.id 
        AND ad_orig.language = 'pt-br'
        AND ad_orig.is_original = true
      ORDER BY ds_orig.created_at DESC
      LIMIT 1
    ) as verification_data,
    
    -- Counts básicos (sem filtros complexos)
    (SELECT COUNT(*) FROM core.attractions) as total_count,
    (SELECT COUNT(*) FROM core.attractions WHERE core.attractions.approved = true) as approved_count,
    (SELECT COUNT(*) FROM core.attractions WHERE core.attractions.approved = false) as pending_count,
    (SELECT COUNT(*) FROM core.attractions a2 WHERE EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a2.id AND ad.description IS NOT NULL AND ad.description != '')) as with_description_count,
    (SELECT COUNT(*) FROM core.attractions a2 WHERE EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a2.id AND ad.audio_url IS NOT NULL AND ad.audio_url != '')) as with_audio_count,
    (SELECT COUNT(*) FROM core.attractions a2 WHERE EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a2.id)) as with_trigger_points_count,
    (SELECT COUNT(*) FROM core.attractions a2 WHERE EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a2.id AND ad.description IS NOT NULL AND ad.description != '' AND ad.audio_url IS NOT NULL AND ad.audio_url != '')) as complete_count
    
  FROM core.attractions a
  LEFT JOIN core.attraction_coordinate ac ON a.id = ac.attraction_id
  ORDER BY a.created_at DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION core.cms_search_pois(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN
) TO authenticated;

GRANT EXECUTE ON FUNCTION core.cms_search_pois(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN
) TO service_role;

-- Add comment
COMMENT ON FUNCTION core.cms_search_pois(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN
) IS 'Minimal version of POI search function for testing. Returns basic POI data with related information.';
