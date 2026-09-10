-- 09 — nine maintenance and orchestrator functions stop being callable from a browser.
--
-- Same class as migration 08, found by sweeping for it after 08: SECURITY DEFINER, no gate of
-- their own, `GRANT EXECUTE TO authenticated`, and nothing a client should ever call. `core` and
-- `drive` both have USAGE for `authenticated` and are exposed through PostgREST, so every one of
-- these was one `/rest/v1/rpc/<name>` away from any of the 522 app profiles.
--
-- WHY THE REVOKE IS SAFE, measured on 2026-09-10 before writing this file:
--   * all 35 cron jobs run as `username = 'postgres'` (`cron.job`), and `postgres` keeps EXECUTE;
--   * `grep` across tuggi-cms (app/lib/components/scripts), tuggi-drive-v2/src and
--     tuggi-enterprise/src: ZERO client callers for all nine names;
--   * `service_role` keeps EXECUTE where it had it, and is not reachable with a publishable key.
--
-- WHAT EACH ONE HANDED OVER
--
-- The four that spend our machine identity read `ef_secret_key` from the Vault and POST to an
-- Edge Function with it. The caller does not see the key, but does get to spend it — and the
-- damage is not the HTTP call, it is what the call does on the other side.
--
--   core.trigger_daily_fomo_orchestrator  ⚠ and drive.trigger_fomo_orchestrator
--     Both POST to `daily-gamification-orchestrator`, which sends the daily push. Anyone could
--     fire the whole base's push, as often as they liked. The cost is not the notification: it
--     is the iOS permission the tourist revokes afterwards, and on iOS that one does not come
--     back (BR-COMUNICACAO-012). It also blows straight through the cadence cap that
--     BR-COMUNICACAO-014 exists to enforce.
--
--     These two are the SAME decision implemented twice (§6 DRY). Only `drive.` is wired to
--     cron ('fomo-hourly-push-orchestrator', jobid 31); `core.trigger_daily_fomo_orchestrator`
--     is in no job and no client — an orphan. It is revoked here rather than dropped, because
--     dropping it is destructive and belongs to the operator (§3). See `docs/dev/`.
--
--   core.automated_audio_cleanup   ⚠ this one was open to `anon` as well — no login needed.
--   core.trigger_city_correction_monitor   (in no cron job either; second orphan)
--
-- The five that delete are bounded by their own WHERE clauses, so the honest severity is loss of
-- history and of audit trail, not loss of live data:
--
--   drive.cleanup_old_email_logs(days_to_keep)  — `0` erases every delivered/sent e-mail log.
--   drive.cleanup_old_fcm_tokens(days_old)      — `0` erases inactive tokens only.
--   core.automated_storage_cleanup              — deletes `storage.objects` for removed POIs.
--   core.cleanup_audit_logs                     — hardcoded 90 days, so a caller only makes it
--                                                 run early; kept here for the class, not the bang.
--   drive.cleanup_expired_caches                — expired rows only. Same reasoning.
--
-- NOT REVOKED, on purpose: `core.replace_trigger_points_atomic`. It carries its own in-body
-- authorization (#128), the CMS calls it while authenticated as `authenticated`, and revoking
-- would break the screen to remove a check that is already there.

BEGIN;

-- Orchestrators: they spend `ef_secret_key` and reach the push pipeline.
REVOKE EXECUTE ON FUNCTION core.trigger_daily_fomo_orchestrator()  FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION drive.trigger_fomo_orchestrator()       FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION core.automated_audio_cleanup()          FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION core.trigger_city_correction_monitor()  FROM authenticated, anon, PUBLIC;

-- Maintenance: they delete.
REVOKE EXECUTE ON FUNCTION core.automated_storage_cleanup()             FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION core.cleanup_audit_logs()                    FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION drive.cleanup_expired_caches()               FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION drive.cleanup_old_email_logs(integer)        FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION drive.cleanup_old_fcm_tokens(integer)        FROM authenticated, anon, PUBLIC;

COMMENT ON FUNCTION drive.trigger_fomo_orchestrator() IS
  'Cron entry point for the daily push (job fomo-hourly-push-orchestrator). Reads ef_secret_key '
  'from the Vault and posts to daily-gamification-orchestrator, so EXECUTE is limited to postgres '
  'and service_role: a client that can call this can push the entire base at will.';

COMMENT ON FUNCTION core.trigger_daily_fomo_orchestrator() IS
  'ORPHAN — same job as drive.trigger_fomo_orchestrator, which is the one cron actually runs. '
  'Kept only because dropping is the operator''s act (§3). Do not wire anything to this one.';

COMMIT;

-- Down.
--
-- Restores the grants this migration removed. Written for completeness, not as a recommendation:
-- every one of these reopens a door that no client ever knocked on.
--
-- BEGIN;
-- GRANT EXECUTE ON FUNCTION core.trigger_daily_fomo_orchestrator()   TO authenticated;
-- GRANT EXECUTE ON FUNCTION drive.trigger_fomo_orchestrator()        TO authenticated;
-- GRANT EXECUTE ON FUNCTION core.automated_audio_cleanup()           TO authenticated, anon;
-- GRANT EXECUTE ON FUNCTION core.trigger_city_correction_monitor()   TO authenticated;
-- GRANT EXECUTE ON FUNCTION core.automated_storage_cleanup()         TO authenticated;
-- GRANT EXECUTE ON FUNCTION core.cleanup_audit_logs()                TO authenticated;
-- GRANT EXECUTE ON FUNCTION drive.cleanup_expired_caches()           TO authenticated;
-- GRANT EXECUTE ON FUNCTION drive.cleanup_old_email_logs(integer)    TO authenticated;
-- GRANT EXECUTE ON FUNCTION drive.cleanup_old_fcm_tokens(integer)    TO authenticated;
-- COMMIT;
