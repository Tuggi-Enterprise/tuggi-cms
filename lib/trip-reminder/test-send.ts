/**
 * The CMS server calls the `trip-message-test` Edge Function (#1231) for the "send a test to me"
 * button, BR-COMUNICACAO-024 item 9. Interface fixed with #1231: POST `{ piece, channel }`, reply
 * `{ ok, channel, error_code? }`.
 *
 * Authentication is the one `places-payment` support actions use (#1054,
 * `lib/services/place-plan-cancel-service.ts`): the CMS's `x-cms-job-secret` (`CMS_JOB_SECRET`) and
 * the admin's own access token. The function validates the token, reads the admin id from it (the
 * test goes to that admin's e-mail and `core.cms_users.phone`) and checks the role again. No id
 * travels in the body. The CMS never holds a provider secret: sending is the function's.
 */

import { CMS_JOB_SECRET_HEADER } from '@/lib/services/place-plan-cancel-service'
import { toTestSendResult, type TemplatePiece, type TestChannel, type TestSendResult } from '@/lib/trip-reminder/settings'

export const TRIP_MESSAGE_TEST_FUNCTION = 'trip-message-test'

export async function callTripMessageTest(
  input: { piece: TemplatePiece; channel: TestChannel },
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ status: number; body: TestSendResult }> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = (process.env.CMS_JOB_SECRET ?? '').trim()
  if (!base || !secret) return { status: 503, body: { ok: false, channel: input.channel, error_code: 'unavailable' } }
  try {
    const res = await fetchImpl(`${base}/functions/v1/${TRIP_MESSAGE_TEST_FUNCTION}`, {
      method: 'POST',
      headers: {
        [CMS_JOB_SECRET_HEADER]: secret,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ piece: input.piece, channel: input.channel }),
      signal: AbortSignal.timeout(30_000),
    })
    const json = await res.json().catch(() => null)
    const body = toTestSendResult(res.status, json, input.channel)
    // The function answered in the interface: its verdict is the result, a failure included.
    const answered = json !== null && typeof (json as { ok?: unknown }).ok === 'boolean'
    return { status: answered ? 200 : res.status >= 400 ? res.status : 502, body }
  } catch {
    // Timeout: the message may still arrive. The send log tells.
    return { status: 504, body: { ok: false, channel: input.channel, error_code: 'timeout' } }
  }
}
