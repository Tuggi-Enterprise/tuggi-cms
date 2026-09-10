-- 08 — core.dispatch_partner_user_notification stops being callable by every signed-in user.
--
-- Found by the security review of `feat/marketing-correcoes` on 2026-09-10, in the neighbourhood
-- migration 07 audited and walked past.
--
-- The function is SECURITY DEFINER with no gate of its own and carries `authenticated=X/postgres`.
-- The `core` schema has USAGE for `authenticated` and is exposed through PostgREST — the push
-- screen already calls into it from the browser — so any of the 522 app profiles, or any of the
-- 39 `cms_users` with role 'client', could POST to /rest/v1/rpc/dispatch_partner_user_notification
-- with an ARBITRARY p_user_id and free-text p_reason, and get:
--
--   * an e-mail signed with our SPF/DKIM/DMARC, carrying the attacker's words, and
--   * a push notification, to a person of the attacker's choosing.
--
-- It reads `vault.decrypted_secrets` and posts with the `ef_secret_key`, so the caller also
-- borrows our machine identity. And the Resend rate limit is 10 requests per second PER TEAM,
-- shared with `send-transactional` — a loop on this eats the headroom that account confirmation
-- and password recovery run in.
--
-- WHO STILL NEEDS IT: nobody outside the database. Measured before writing this file —
--   * callers: `partner.notify_team_new_partner` and `partner.notify_partner_status_change`, both
--     SECURITY DEFINER owned by `postgres`, so they execute as `postgres` and are covered by the
--     `postgres=X/postgres` entry that stays;
--   * `grep` across tuggi-cms, tuggi-drive-v2 and tuggi-enterprise: no client calls it by RPC.
--
-- `service_role` keeps EXECUTE: it is the identity the Edge Functions and the panel use, and it
-- is not reachable with a publishable key.

BEGIN;

REVOKE EXECUTE ON FUNCTION core.dispatch_partner_user_notification(text, uuid, text, text, text)
  FROM authenticated, anon, PUBLIC;

COMMENT ON FUNCTION core.dispatch_partner_user_notification(text, uuid, text, text, text) IS
  'Sends the partner-journey e-mail and push for one user. SECURITY DEFINER with no gate of its '
  'own, so EXECUTE is deliberately limited to postgres and service_role: it is called from '
  'database triggers, never from a client. Granting it to authenticated hands any signed-in user '
  'our DKIM signature and an arbitrary recipient.';

COMMIT;

-- Down.
--
-- Restores the state this migration removed. Kept for completeness, NOT because rolling back is
-- advisable: re-granting reopens the hole described above.
--
-- BEGIN;
-- GRANT EXECUTE ON FUNCTION core.dispatch_partner_user_notification(text, uuid, text, text, text)
--   TO authenticated;
-- COMMIT;
