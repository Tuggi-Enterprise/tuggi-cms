-- Fix the "cannot extract elements from a scalar" error in trigger points
-- The error is caused by triggers trying to process JSONB arrays incorrectly

-- 1. Disable the problematic learning trigger temporarily
DO $$
BEGIN
    -- Disable trigger_capture_learning if it exists
    IF EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE c.relname = 'attraction_trigger_points'
        AND n.nspname = 'core'
        AND t.tgname = 'trigger_capture_learning'
    ) THEN
        ALTER TABLE core.attraction_trigger_points DISABLE TRIGGER trigger_capture_learning;
        RAISE NOTICE 'Disabled trigger_capture_learning';
    ELSE
        RAISE NOTICE 'trigger_capture_learning not found';
    END IF;

    -- Disable trigger_auto_create_training_example if it exists
    IF EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE c.relname = 'attraction_trigger_points'
        AND n.nspname = 'core'
        AND t.tgname = 'trigger_auto_create_training_example'
    ) THEN
        ALTER TABLE core.attraction_trigger_points DISABLE TRIGGER trigger_auto_create_training_example;
        RAISE NOTICE 'Disabled trigger_auto_create_training_example';
    ELSE
        RAISE NOTICE 'trigger_auto_create_training_example not found';
    END IF;
END $$;

-- 3. Fix the capture_trigger_point_learning function to handle scalar values properly
CREATE OR REPLACE FUNCTION core.capture_trigger_point_learning()
RETURNS TRIGGER AS $$
DECLARE
  context_data jsonb;
BEGIN
  -- Extrair contexto do novo trigger point
  BEGIN
    context_data := core.extract_trigger_point_context(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    -- Se falhar na extração, log e continue
    RAISE WARNING 'Failed to extract context for trigger point %: %', NEW.id, SQLERRM;
    RETURN NEW;
  END;
  
  -- Inserir como exemplo de treinamento
  INSERT INTO core.pov_training_examples (
    trigger_point_id,
    attraction_id,
    poi_name,
    poi_lat,
    poi_lng,
    poi_types,
    poi_category,
    urban_density,
    trigger_lat,
    trigger_lng,
    distance_m,
    bearing_deg,
    access_type,
    trigger_type,
    priority,
    radius_meters,
    context_text,
    human_created,
    quality_score,
    estimated_visibility
  ) VALUES (
    NEW.id,
    NEW.attraction_id,
    context_data->>'poi_name',
    (context_data->>'poi_lat')::double precision,
    (context_data->>'poi_lng')::double precision,
    -- FIX: Handle both array and scalar values for poi_types
    CASE 
      WHEN context_data->'poi_types' IS NOT NULL AND jsonb_typeof(context_data->'poi_types') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(context_data->'poi_types'))
      WHEN context_data->'poi_types' IS NOT NULL AND jsonb_typeof(context_data->'poi_types') = 'string'
      THEN ARRAY[context_data->>'poi_types']
      ELSE NULL 
    END,
    context_data->>'poi_category',
    context_data->>'urban_density',
    (context_data->>'trigger_lat')::double precision,
    (context_data->>'trigger_lng')::double precision,
    (context_data->>'distance_m')::integer,
    (context_data->>'bearing_deg')::integer,
    context_data->>'access_type',
    context_data->>'trigger_type',
    (context_data->>'priority')::integer,
    (context_data->>'radius_meters')::integer,
    context_data->>'context_text',
    true, -- human_created
    85.0, -- quality_score inicial para exemplos humanos
    'good' -- estimated_visibility inicial
  );
  
  -- Atualizar padrões de aprendizado (async para não bloquear)
  PERFORM core.update_learning_patterns_async(NEW.attraction_id);
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log the error but don't fail the trigger point insertion
  RAISE WARNING 'Learning trigger failed for trigger point %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Re-enable the learning trigger with the fixed function
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE c.relname = 'attraction_trigger_points'
        AND n.nspname = 'core'
        AND t.tgname = 'trigger_capture_learning'
    ) THEN
        ALTER TABLE core.attraction_trigger_points ENABLE TRIGGER trigger_capture_learning;
        RAISE NOTICE 'Re-enabled trigger_capture_learning with fixed function';
    ELSE
        RAISE NOTICE 'trigger_capture_learning not found, cannot re-enable';
    END IF;
END $$;

-- 5. For now, keep the training example trigger disabled until we can fix it too
-- We'll re-enable it later after fixing the function

-- 6. Verify current trigger status
SELECT 
    t.tgname as trigger_name,
    CASE t.tgenabled
        WHEN 'O' THEN 'ENABLED'
        WHEN 'D' THEN 'DISABLED' 
        WHEN 'A' THEN 'ENABLED (ALWAYS)'
        WHEN 'R' THEN 'ENABLED (REPLICA)'
        ELSE 'UNKNOWN: ' || t.tgenabled::text
    END as status
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relname = 'attraction_trigger_points'
AND n.nspname = 'core'
ORDER BY t.tgname;
