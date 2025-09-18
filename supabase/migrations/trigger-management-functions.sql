-- Funções para gerenciar triggers e evitar problemas de RLS
-- ===========================================

-- Função para desabilitar o trigger de aprendizado
CREATE OR REPLACE FUNCTION core.disable_learning_trigger()
RETURNS void AS $$
BEGIN
  -- Desabilitar o trigger temporariamente
  ALTER TABLE core.attraction_trigger_points DISABLE TRIGGER trigger_capture_learning;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para habilitar o trigger de aprendizado
CREATE OR REPLACE FUNCTION core.enable_learning_trigger()
RETURNS void AS $$
BEGIN
  -- Habilitar o trigger novamente
  ALTER TABLE core.attraction_trigger_points ENABLE TRIGGER trigger_capture_learning;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Política para permitir que a service role execute essas funções
GRANT EXECUTE ON FUNCTION core.disable_learning_trigger() TO service_role;
GRANT EXECUTE ON FUNCTION core.enable_learning_trigger() TO service_role;
