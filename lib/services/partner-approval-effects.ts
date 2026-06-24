/**
 * Partner approval/rejection side-effects.
 *
 * ⚠️ MOVED TO THE DATABASE. These effects (Pro grant + push + email) now run from
 * DB triggers on core.clients — see migration 20260624140300_partner_notifications_db.sql
 * (core.notify_partner_status_change). The DB path is reliable regardless of the
 * CMS runtime env/deploy; the previous Next.js implementation depended on
 * process.env.SUPABASE_SERVICE_ROLE_KEY and was not firing (no approval emails in
 * Resend, no notification_logs).
 *
 * These remain as no-ops so the approve/reject routes keep compiling/calling them
 * without double-sending. Do NOT re-add the grant/notifications here.
 */

export async function applyPartnerApprovalEffects(
  _clientId: string,
  _grantedByCmsUserId: string
): Promise<void> {
  // no-op — handled by core.notify_partner_status_change (DB trigger)
}

export async function applyPartnerRejectionEffects(
  _clientId: string,
  _reason: string
): Promise<void> {
  // no-op — handled by core.notify_partner_status_change (DB trigger)
}
