-- Desabilitar temporariamente o trigger de aprendizado que está causando erro
-- ao criar trigger points manualmente

-- Verificar se o trigger existe antes de desabilitar
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.triggers 
        WHERE trigger_name = 'trigger_capture_learning'
        AND event_object_table = 'attraction_trigger_points'
    ) THEN
        -- Desabilitar o trigger
        ALTER TABLE core.attraction_trigger_points DISABLE TRIGGER trigger_capture_learning;
        RAISE NOTICE 'Learning trigger disabled successfully';
    ELSE
        RAISE NOTICE 'Learning trigger not found - nothing to disable';
    END IF;
END $$;

-- Verificação
SELECT 
    trigger_name,
    event_object_table,
    trigger_schema,
    action_statement,
    CASE WHEN trigger_name IS NULL THEN 'DISABLED' ELSE 'ACTIVE' END as status
FROM information_schema.triggers 
WHERE trigger_name = 'trigger_capture_learning'
AND event_object_table = 'attraction_trigger_points';

SELECT 'Learning trigger has been disabled to allow manual trigger point creation' as status;
