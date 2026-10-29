/**
 * #1054 — the support cancels a place's paid plan (BR-B2B-060, support edge case). The CMS server
 * calls `places-payment` with `x-cms-job-secret` (`CMS_JOB_SECRET`, the secret the CMS and the
 * `places-*` functions already share) and the admin's own access token: the function validates the
 * token, reads the operator id from it and the database checks the admin again. The CMS never
 * holds the plan logic: quote and cancel are the function's (`support_cancel_quote`,
 * `support_cancel`), contract `docs/contracts/places-pagamento.md`.
 */

export const PLACES_PAYMENT_FUNCTION = 'places-payment'
/** Same header the EF reads (`CMS_JOB_SECRET_HEADER` in `_shared/places-payout.ts`). */
export const CMS_JOB_SECRET_HEADER = 'x-cms-job-secret'

export type SupportAction = 'support_cancel_quote' | 'support_cancel'
export type SupportReply = { status: number; body: Record<string, unknown> }

export async function callSupportCancel(
  action: SupportAction,
  args: { clientId: string; attractionId: string; expectedFeeCents?: number },
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<SupportReply> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = (process.env.CMS_JOB_SECRET ?? '').trim()
  if (!base || !secret) return { status: 503, body: { error: 'unavailable' } }
  const body: Record<string, unknown> = { action, client_id: args.clientId, attraction_id: args.attractionId }
  if (args.expectedFeeCents !== undefined) body.expected_fee_cents = args.expectedFeeCents
  try {
    const res = await fetchImpl(`${base}/functions/v1/${PLACES_PAYMENT_FUNCTION}`, {
      method: 'POST',
      headers: { [CMS_JOB_SECRET_HEADER]: secret, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { status: res.status, body: json }
  } catch {
    // Timeout: the cancel may have landed. A second click answers `already_canceled`.
    return { status: 504, body: { error: 'timeout' } }
  }
}
