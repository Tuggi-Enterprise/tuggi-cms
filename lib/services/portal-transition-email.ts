/**
 * The approval and "no ar" e-mails of the Portal Locais (#813, #906, BR-B2B-049 item 10): asks the
 * `places-portal-notify` Edge Function, which owns the copy, the recipient (the acceptance
 * e-mail) and Resend. Called right after the transition: the decision route after
 * `in_review → approved`, the publish route after `approved → live`.
 *
 * The operator's own access token goes as the Bearer — the secret key is not a JWT (same pattern
 * as `app/api/system-audio/route.ts`). Never throws: the approval is already done when this runs,
 * and a failed e-mail must not turn it into an error on the screen.
 */

export const PORTAL_NOTIFY_FUNCTION = 'places-portal-notify'

export type PortalNotifyEvent = 'approved' | 'live'

async function notifyPortal(
  event: PortalNotifyEvent,
  accessToken: string | null | undefined,
  submissionId: string,
  fetchImpl: typeof fetch
): Promise<boolean> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!accessToken || !base) return false
  try {
    const res = await fetchImpl(`${base}/functions/v1/${PORTAL_NOTIFY_FUNCTION}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, submission_id: submissionId }),
      signal: AbortSignal.timeout(15_000),
    })
    return res.ok
  } catch {
    return false
  }
}

export function notifyPortalApproval(
  accessToken: string | null | undefined,
  submissionId: string,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  return notifyPortal('approved', accessToken, submissionId, fetchImpl)
}

export function notifyPortalLive(
  accessToken: string | null | undefined,
  submissionId: string,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  return notifyPortal('live', accessToken, submissionId, fetchImpl)
}
