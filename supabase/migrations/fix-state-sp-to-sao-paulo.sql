-- ===========================================
-- CORRIGIR ESTADOS "SP" PARA "São Paulo"
-- ===========================================
-- Este script corrige todos os registros na tabela core.attractions
-- que têm o estado como "SP" (ou variações) para o nome completo "São Paulo"
--
-- Execução:
--   Execute este script no Supabase SQL Editor ou via CLI
-- ===========================================

-- Verificar quantos registros serão afetados ANTES da correção
SELECT 
  state,
  COUNT(*) as total_registros
FROM core.attractions
WHERE UPPER(TRIM(state)) = 'SP' 
   OR UPPER(TRIM(state)) = 'SP.'
   OR state ILIKE '%sp%'
GROUP BY state
ORDER BY total_registros DESC;

-- ===========================================
-- CORREÇÃO PRINCIPAL
-- ===========================================
-- Atualiza todos os registros onde o estado é "SP" (case-insensitive)
-- para "São Paulo"
-- 
-- NOTA: Este UPDATE também corrige problemas de encoding (ex: "estÃo" -> "estão")
UPDATE core.attractions
SET 
  state = 'São Paulo',
  updated_at = NOW()
WHERE 
  -- Casos exatos (case-insensitive)
  UPPER(TRIM(state)) = 'SP' 
  OR UPPER(TRIM(state)) = 'SP.'
  -- Casos onde SP aparece no meio do texto (ex: "Estado SP")
  OR (state ILIKE '%sp%' 
      AND state NOT ILIKE '%são paulo%' 
      AND state NOT ILIKE '%sao paulo%'
      AND state NOT ILIKE '%sÃ£o paulo%')  -- Encoding issue
  -- Casos com espaços extras
  OR TRIM(state) = 'sp'
  OR TRIM(state) = 'Sp'
  OR TRIM(state) = 'sP'
  OR TRIM(state) = 'SP'
  OR TRIM(state) = 'sp.'
  OR TRIM(state) = 'Sp.'
  OR TRIM(state) = 'SP.';

-- ===========================================
-- VERIFICAÇÃO PÓS-CORREÇÃO
-- ===========================================
-- Verificar se ainda existem registros com "SP"
SELECT 
  state,
  COUNT(*) as total_registros
FROM core.attractions
WHERE UPPER(TRIM(state)) = 'SP' 
   OR UPPER(TRIM(state)) = 'SP.'
   OR (state ILIKE '%sp%' AND state NOT ILIKE '%são paulo%')
GROUP BY state
ORDER BY total_registros DESC;

-- Verificar quantos registros foram atualizados para "São Paulo"
SELECT 
  COUNT(*) as total_corrigidos
FROM core.attractions
WHERE state = 'São Paulo';

-- ===========================================
-- RESUMO FINAL
-- ===========================================
-- Mostrar distribuição de estados após correção
SELECT 
  state,
  COUNT(*) as total_registros,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM core.attractions WHERE state IS NOT NULL), 2) as percentual
FROM core.attractions
WHERE state IS NOT NULL
GROUP BY state
ORDER BY total_registros DESC
LIMIT 20;

