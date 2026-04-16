-- Migration: Remove Legacy Crawl-and-Index Cron Job
-- Date: 2026-04-16
-- Purpose: Remove redundant indexing process replaced by Google Grounding.

DO $$
BEGIN
  -- 1. Remover o job pelo nome (se existir)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crawl-and-index-job') THEN
    PERFORM cron.unschedule('crawl-and-index-job');
    RAISE NOTICE 'Legacy job crawl-and-index-job removido.';
  END IF;

  -- 2. Também remover qualquer job sem nome que aponte para a função crawl-and-index
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE command ILIKE '%crawl-and-index%';
  
  RAISE NOTICE 'Limpeza de agendamentos de indexação concluída.';
END $$;
