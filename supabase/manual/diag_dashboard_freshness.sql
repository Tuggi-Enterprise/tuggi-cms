-- ============================================================================
-- FRESCOR DO DASHBOARD — gerado a partir do diagnóstico de 2026-06-15
-- O dashboard lê de 3 MVs com cadências diferentes. Aqui acertamos as 3.
-- Rodar no SQL Editor. Confira os jobids antes (passo 0).
-- ============================================================================

-- ─── 0. Conferir os jobids reais antes de alterar ──────────────────────────
SELECT jobid, jobname, schedule
FROM cron.job
WHERE command ILIKE '%inventory_rankings%'   -- esperado: refresh-dashboard-rankings (job 36)
   OR command ILIKE '%refresh_dashboard_mvs%' -- esperado: refresh_dashboard_mvs (job 44)
ORDER BY jobid;


-- ─── 1. Funil + qualidade de conteúdo: 6h → 30min ──────────────────────────
-- mv_inventory_stats (core aprovados/pendentes, homolog_raw, cobertura). É o que
-- mais muda na migração e o que estava mais defasado. ~7s/run × 48 = ~5,6min CPU/dia.
SELECT cron.alter_job(36, schedule := '*/30 * * * *');   -- ajuste o jobid se o passo 0 mostrar outro

-- ─── 2. (opcional) Analytics de usuário/country: 10min → 5min ──────────────
-- mv_user_analytics_global + mv_country_stats. Custo ~0,5s/run, pode acelerar à vontade.
-- SELECT cron.alter_job(44, schedule := '*/5 * * * *');


-- ─── 3. City/country stats: estava SEM refresh — agendar ───────────────────
-- mv_geographic_stats alimenta dashboard_city_stats/country_stats e NÃO tinha cron.
-- 3a. Primeiro rode UMA vez manual e veja quanto demora (define a frequência segura):
--        SELECT core.refresh_geographic_stats();
-- 3b. Depois agende (hora em hora é um começo conservador; ajuste pelo tempo medido):
SELECT cron.schedule('refresh-geographic-stats', '0 * * * *',
                     $$ SELECT core.refresh_geographic_stats(); $$);


-- ─── 4. Verificação ────────────────────────────────────────────────────────
-- Cadências novas:
--   SELECT jobid, jobname, schedule, active FROM cron.job
--   WHERE jobid IN (36,44) OR jobname = 'refresh-geographic-stats' ORDER BY jobid;
-- Custo real depois de algumas execuções:
--   SELECT j.jobname, count(*) runs, round(avg(extract(epoch from (d.end_time-d.start_time)))::numeric,2) avg_s
--   FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid
--   WHERE d.start_time > now() - interval '3 hours'
--     AND (d.jobid IN (36,44) OR j.jobname='refresh-geographic-stats')
--   GROUP BY j.jobname;
