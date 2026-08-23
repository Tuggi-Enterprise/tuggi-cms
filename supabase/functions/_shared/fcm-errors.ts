/**
 * What an FCM HTTP v1 per-token error means, and what may be done about it.
 *
 * Two codes used to share one consequence in `firebase-push-notification`
 * (`sendNotification`): a single `if` deactivated the row in `drive.fcm_tokens`
 * for `UNREGISTERED` OR `INVALID_ARGUMENT`. They do not mean the same thing.
 *
 *  - UNREGISTERED (HTTP 404, `error.status: NOT_FOUND`) — the registration is
 *    gone: uninstall, revoked permission, 270 idle days. The documented action
 *    is to stop sending to it.
 *  - INVALID_ARGUMENT (HTTP 400) — "Request parameters were invalid". This is a
 *    SENDER error. Firebase is explicit that it does not indict the token:
 *    "INVALID_ARGUMENT can also be returned in cases of issues in the message
 *    payload, so it signals an invalid registration only if the payload is
 *    completely valid"
 *    (https://firebase.google.com/docs/cloud-messaging/manage-tokens).
 *
 * The send loop walks token by token with the SAME payload, so a payload FCM
 * rejects fails every token with INVALID_ARGUMENT. Deactivating on it turns one
 * bad payload into the whole base being unreachable in a single run, recoverable
 * only when each user reopens the app and `FCMTokenService` re-registers.
 *
 * Where the code actually lives, and why this file reads three fields:
 * the FCM code is NOT in `error.message`. A 404 carries
 * `{ message: "Requested entity was not found.", status: "NOT_FOUND",
 *    details: [{ "@type": "…FcmError", errorCode: "UNREGISTERED" }] }`
 * — `details[].errorCode` is the FCM-specific SSOT, `status` is the generic
 * google.rpc mapping, and `message` is prose. Reading `message` (what the old
 * `error.includes('UNREGISTERED')` did) never matched either literal.
 */

/** Shape of the JSON body FCM returns on a non-2xx `messages:send`. */
export type FcmErrorBody = {
  error?: {
    code?: number
    message?: string
    status?: string
    details?: Array<{ '@type'?: string; errorCode?: string } | null> | null
  } | null
} | null

/**
 * The FCM error code of a failed `messages:send`, read from the field that
 * actually carries it. Returns '' when the body carries no recognizable code —
 * an unknown code must never be classified, and unclassified means "do nothing
 * to the token".
 */
export function fcmErrorCode(body: FcmErrorBody): string {
  const error = body?.error
  if (!error) return ''

  const fromDetails = (error.details ?? []).find(
    (d) => typeof d?.errorCode === 'string' && d.errorCode.length > 0
  )?.errorCode
  if (fromDetails) return fromDetails

  return typeof error.status === 'string' ? error.status : ''
}

/**
 * The registration is dead and will never be valid again — the only case where
 * deactivating the token is the right answer.
 *
 * `NOT_FOUND` is here because it is the google.rpc status that ships WITH
 * `errorCode: UNREGISTERED` on a 404; it is the fallback when `details` is
 * absent, and on a token send a 404 has no other meaning.
 */
export function isDeadRegistration(code: string): boolean {
  return code === 'UNREGISTERED' || code === 'NOT_FOUND'
}

/**
 * The request was malformed. The fault is the sender's; the token may be
 * perfectly alive and must be left alone.
 */
export function isSenderPayloadError(code: string): boolean {
  return code === 'INVALID_ARGUMENT'
}

/**
 * How many INVALID_ARGUMENT failures in one run before the send gives up.
 *
 * Why a floor at all, and why not 1: a token can be individually malformed —
 * a truncated row in `drive.fcm_tokens`, or a stale `drive.profiles.push_token`
 * (a pool with no `is_active` column, never cleaned, and appended as a
 * contiguous block to the end of the recipient list). One rotten token cannot
 * be allowed to kill a broadcast to the whole base.
 *
 * Why 10 and not 5: 5 is inside the plausible size of such a cluster, precisely
 * because the two token sources are concatenated rather than interleaved, so a
 * run of junk is not evidence of anything. 10 sits above that and still bounds
 * the damage: with a genuinely bad payload the loop stops after 10 sequential
 * FCM calls (~2-3 s) no matter whether the audience is 200 or 200,000 — the cost
 * of aborting late is a handful of wasted round-trips, while the cost of
 * aborting early is a duplicate push to everyone already reached when the
 * operator retries. The asymmetry is what sets the number, not roundness.
 */
export const INVALID_ARGUMENT_ABORT_FLOOR = 10

/**
 * Should the send loop stop? A rejected payload fails EVERY token, so the signal
 * is the rate, not the count: the floor must also be at least half of everything
 * attempted so far.
 *
 * The rate gate is what separates "the payload is broken" (100% of attempts
 * fail) from "the base carries some junk tokens" (a few percent, and the send
 * must go through). With a bad payload the condition is met on the 10th token,
 * since every attempt failed.
 *
 * @param invalidArgumentCount INVALID_ARGUMENT failures so far in this run
 * @param attempted            tokens tried so far, successes included
 */
export function shouldAbortForBadPayload(
  invalidArgumentCount: number,
  attempted: number
): boolean {
  return (
    invalidArgumentCount >= INVALID_ARGUMENT_ABORT_FLOOR &&
    invalidArgumentCount * 2 >= attempted
  )
}
