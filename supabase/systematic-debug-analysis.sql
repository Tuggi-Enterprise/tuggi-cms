-- Análise sistemática passo a passo do erro "POI not found for trigger point"
-- O erro persiste mesmo após desabilitar o trigger de aprendizado

-- PASSO 1: Verificar se TODOS os triggers estão realmente desabilitados
SELECT 
    '1. ALL TRIGGERS STATUS' as step,
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

-- PASSO 2: Verificar se há RLS policies que podem chamar funções
SELECT 
    '2. RLS POLICIES WITH FUNCTIONS' as step,
    schemaname,
    tablename,
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'attraction_trigger_points'
AND (qual ILIKE '%function%' OR with_check ILIKE '%function%');

-- PASSO 3: Procurar por qualquer função que contenha "POI not found"
SELECT 
    '3. FUNCTIONS WITH POI NOT FOUND ERROR' as step,
    routine_schema,
    routine_name,
    routine_type,
    routine_definition
FROM information_schema.routines 
WHERE routine_definition ILIKE '%POI not found%'
ORDER BY routine_schema, routine_name;

-- PASSO 4: Verificar se há constraints CHECK que podem chamar funções
SELECT 
    '4. CHECK CONSTRAINTS' as step,
    tc.constraint_name,
    tc.table_name,
    cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc ON tc.constraint_name = cc.constraint_name
WHERE tc.table_schema = 'core' 
AND tc.table_name = 'attraction_trigger_points'
AND cc.check_clause ILIKE '%function%';

-- PASSO 5: Verificar se há rules na tabela
SELECT 
    '5. TABLE RULES' as step,
    schemaname,
    tablename,
    rulename,
    definition
FROM pg_rules
WHERE schemaname = 'core' 
AND tablename = 'attraction_trigger_points';

-- PASSO 6: Procurar por event triggers
SELECT 
    '6. EVENT TRIGGERS' as step,
    evtname as trigger_name,
    evtevent as event_type,
    evtfoid::regproc as function_name,
    evtenabled as enabled
FROM pg_event_trigger
WHERE evtfoid::regproc::text ILIKE '%trigger_point%' 
   OR evtfoid::regproc::text ILIKE '%POI%';

-- PASSO 7: Verificar se há funções sendo chamadas por DEFAULT values
SELECT 
    '7. DEFAULT VALUE FUNCTIONS' as step,
    column_name,
    column_default
FROM information_schema.columns
WHERE table_schema = 'core' 
AND table_name = 'attraction_trigger_points'
AND column_default IS NOT NULL
AND column_default ILIKE '%function%';

-- PASSO 8: Tentar inserir dados mínimos para isolar o problema
DO $$
DECLARE
    test_id uuid;
    error_msg text;
    error_detail text;
    error_context text;
BEGIN
    BEGIN
        -- Teste com dados mínimos obrigatórios apenas
        INSERT INTO core.attraction_trigger_points (
            attraction_id,
            location
        ) VALUES (
            'cb2103ad-af06-48c6-9ee6-853379bc390c',
            ST_SetSRID(ST_MakePoint(-8.299929721704496, 51.84914348533807), 4326)::geography
        ) RETURNING id INTO test_id;
        
        RAISE NOTICE '8. SUCCESS: Minimal insert worked. ID: %', test_id;
        
        -- Limpar
        DELETE FROM core.attraction_trigger_points WHERE id = test_id;
        
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS 
            error_msg = MESSAGE_TEXT,
            error_detail = PG_EXCEPTION_DETAIL,
            error_context = PG_EXCEPTION_CONTEXT;
            
        RAISE NOTICE '8. ERROR in minimal insert: %', error_msg;
        RAISE NOTICE '8. DETAIL: %', error_detail;
        RAISE NOTICE '8. CONTEXT: %', error_context;
        RAISE NOTICE '8. SQLSTATE: %', SQLSTATE;
    END;
END $$;
