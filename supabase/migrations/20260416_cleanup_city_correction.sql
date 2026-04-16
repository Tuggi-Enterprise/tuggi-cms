-- Migration: Remove City Correction Legacy System
-- Date: 2026-04-16
-- Purpose: Remove city correction monitor and processor as data is already validated.

DO $$
BEGIN
  -- 1. Remover agendamentos do monitor no cron
  PERFORM cron.unschedule(jobid) 
  FROM cron.job 
  WHERE jobname = 'city-correction-monitor' OR command ILIKE '%city-correction-monitor%';

  -- 2. Remover a tabela de progresso que não será mais necessária
  DROP TABLE IF EXISTS core.city_correction_progress;

  RAISE NOTICE 'Agendamentos e tabelas de correção de cidade removidos.';
END $$;
