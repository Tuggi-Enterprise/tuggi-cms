-- ============================================================
-- RPC de diagnóstico read-only: ver atividade do banco pela CLI/REST.
-- Roda UMA VEZ no painel (é DDL). SECURITY DEFINER p/ ler pg_stat_activity
-- e cron.* (que o PostgREST não expõe diretamente).
-- ============================================================

CREATE OR REPLACE FUNCTION core.db_activity()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'active_backends', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'pid', pid, 'app', application_name, 'user', usename, 'state', state,
        'xact_age_s', round(extract(epoch FROM now() - xact_start)),
        'wait', wait_event_type, 'wait_event', wait_event,
        'query', left(query, 160))), '[]'::jsonb)
      FROM pg_stat_activity
      WHERE datname = current_database() AND state = 'active' AND pid <> pg_backend_pid()
    ),
    'cron_jobs', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'jobid', jobid, 'name', jobname, 'schedule', schedule, 'active', active,
        'command', left(command, 140)) ORDER BY jobid), '[]'::jsonb)
      FROM cron.job
    ),
    'cron_running', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'jobid', jobid, 'status', status, 'start', start_time,
        'running_s', round(extract(epoch FROM now() - start_time)),
        'command', left(command, 120))), '[]'::jsonb)
      FROM cron.job_run_details WHERE status = 'running'
    ),
    'cron_recent', (
      SELECT coalesce(jsonb_agg(j), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('jobid', jobid, 'status', status,
          'start', start_time, 'end', end_time,
          'dur_s', round(extract(epoch FROM coalesce(end_time, now()) - start_time)),
          'command', left(command, 90)) AS j
        FROM cron.job_run_details ORDER BY start_time DESC LIMIT 15
      ) t
    ),
    'blocking', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'blocked_pid', blocked.pid, 'blocker_pid', b.pid,
        'blocker_app', blocking.application_name,
        'blocker_query', left(blocking.query, 120))), '[]'::jsonb)
      FROM pg_stat_activity blocked
      JOIN LATERAL unnest(pg_blocking_pids(blocked.pid)) AS b(pid) ON true
      JOIN pg_stat_activity blocking ON blocking.pid = b.pid
      WHERE blocked.wait_event_type = 'Lock'
    )
  );
$$;

GRANT EXECUTE ON FUNCTION core.db_activity() TO service_role;
NOTIFY pgrst, 'reload schema';
