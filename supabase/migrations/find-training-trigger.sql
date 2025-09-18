-- Encontrar qual trigger está chamando create_training_example_from_trigger

-- 1. Procurar por triggers que chamam create_training_example_from_trigger
SELECT 
    'TRIGGERS CALLING TRAINING FUNCTION' as check_type,
    t.tgname as trigger_name,
    CASE t.tgenabled
        WHEN 'O' THEN 'ENABLED'
        WHEN 'D' THEN 'DISABLED' 
        WHEN 'A' THEN 'ENABLED (ALWAYS)'
        WHEN 'R' THEN 'ENABLED (REPLICA)'
        ELSE 'UNKNOWN: ' || t.tgenabled::text
    END as status,
    p.proname as function_name,
    p.prosrc as function_body
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE c.relname = 'attraction_trigger_points'
AND n.nspname = 'core'
AND p.prosrc ILIKE '%create_training_example_from_trigger%';

-- 2. Procurar por qualquer função que chama create_training_example_from_trigger
SELECT 
    'FUNCTIONS CALLING TRAINING FUNCTION' as check_type,
    routine_name,
    routine_type,
    CASE 
        WHEN LENGTH(routine_definition) > 300 
        THEN LEFT(routine_definition, 300) || '...'
        ELSE routine_definition
    END as routine_definition_preview
FROM information_schema.routines 
WHERE routine_schema = 'core' 
AND routine_definition ILIKE '%create_training_example_from_trigger%'
AND routine_name != 'create_training_example_from_trigger';

-- 3. Verificar especificamente o trigger trigger_create_training_example
SELECT 
    'TRAINING EXAMPLE TRIGGER STATUS' as check_type,
    t.tgname,
    CASE t.tgenabled
        WHEN 'O' THEN 'ENABLED'
        WHEN 'D' THEN 'DISABLED' 
        WHEN 'A' THEN 'ENABLED (ALWAYS)'
        WHEN 'R' THEN 'ENABLED (REPLICA)'
        ELSE 'UNKNOWN: ' || t.tgenabled::text
    END as status,
    p.proname as function_name
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE c.relname = 'attraction_trigger_points'
AND n.nspname = 'core'
AND t.tgname ILIKE '%training%';

-- 4. DESABILITAR o trigger que chama create_training_example_from_trigger
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Desabilitar trigger_create_training_example se existir
    IF EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE c.relname = 'attraction_trigger_points'
        AND n.nspname = 'core'
        AND t.tgname = 'trigger_create_training_example'
    ) THEN
        ALTER TABLE core.attraction_trigger_points DISABLE TRIGGER trigger_create_training_example;
        RAISE NOTICE 'Disabled trigger_create_training_example';
    ELSE
        RAISE NOTICE 'trigger_create_training_example not found';
    END IF;
    
    -- Procurar e desabilitar qualquer outro trigger que possa estar chamando a função
    FOR r IN (
        SELECT t.tgname
        FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        JOIN pg_proc p ON t.tgfoid = p.oid
        WHERE c.relname = 'attraction_trigger_points'
        AND n.nspname = 'core'
        AND p.prosrc ILIKE '%create_training_example_from_trigger%'
        AND t.tgenabled = 'O'
    )
    LOOP
        EXECUTE format('ALTER TABLE core.attraction_trigger_points DISABLE TRIGGER %I', r.tgname);
        RAISE NOTICE 'Disabled trigger: %', r.tgname;
    END LOOP;
END $$;

-- 5. Verificar se todos os triggers problemáticos foram desabilitados
SELECT 
    'FINAL TRIGGER STATUS' as check_type,
    t.tgname as trigger_name,
    CASE t.tgenabled
        WHEN 'O' THEN 'ENABLED'
        WHEN 'D' THEN 'DISABLED' 
        WHEN 'A' THEN 'ENABLED (ALWAYS)'
        WHEN 'R' THEN 'ENABLED (REPLICA)'
        ELSE 'UNKNOWN: ' || t.tgenabled::text
    END as status,
    p.proname as function_name
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE c.relname = 'attraction_trigger_points'
AND n.nspname = 'core'
ORDER BY t.tgname;

SELECT 'Training triggers analysis and disable complete!' as status;
