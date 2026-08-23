/**
 * What an FCM HTTP v1 per-token error means, and what may be done about it.
 *
 * Two codes used to share one consequence in `firebase-push-notification`
 * (`sendNotification`): a single `if` deactivated the row in `drive.fcm_tokens`
 * for `UNREGISTERED` OR `INVALID_ARGUMENT`. They do not mean the same thing.
 *
 *  - UNREGISTERED (HTTP 404) — "App instance was unregistered from FCM. This
 *    usually means that the token used is no longer valid and a new one must be
 *    used" (https://firebase.google.com/docs/cloud-messaging/error-codes). The
 *    documented action is to stop sending to it.
 *  - INVALID_ARGUMENT (HTTP 400) — "Request parameters were invalid". This is a
 *    SENDER error. Firebase is explicit that it does not indict the token:
 *    deleting the registration is safe only "if you are certain that the message
 *    payload is valid"
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
 * `UNREGISTERED` and nothing else. The FCM v1 error table has exactly eight
 * codes — UNSPECIFIED_ERROR, INVALID_ARGUMENT, UNREGISTERED, SENDER_ID_MISMATCH,
 * QUOTA_EXCEEDED, UNAVAILABLE, INTERNAL, THIRD_PARTY_AUTH_ERROR
 * (https://firebase.google.com/docs/cloud-messaging/error-codes) — and
 * `NOT_FOUND` is NOT one of them: it is the generic google.rpc status that
 * happens to ship alongside `errorCode: UNREGISTERED` on a 404.
 *
 * It used to be accepted here as a fallback, and that reopened the same
 * catastrophe through the other door: a 404 of SYSTEMIC origin — a rotated
 * `FIREBASE_PROJECT_ID`, a deleted Firebase project, a moved endpoint — answers
 * `status: NOT_FOUND` with NO `details[].errorCode`, is identical for every
 * token, and the deactivation branch has no rate brake of its own. One
 * misconfigured environment variable would have wiped the base one row at a
 * time. See `isUnclassifiedNotFound`.
 *
 * The cost of the strictness is the mirror image and much smaller: if FCM ever
 * answers a genuine dead registration without `details`, the token stays active
 * and keeps being tried — waste, not damage, and exactly the behaviour that ran
 * in production until 5de8be0.
 */
export function isDeadRegistration(code: string): boolean {
  return code === 'UNREGISTERED'
}

/**
 * A 404 that carries no FCM `errorCode`: the request did not reach a live FCM
 * resource, and the token is not the accused. Systemic until proven otherwise
 * (wrong project id, deleted project, wrong endpoint), so the answer is a loud
 * log and nothing else — never a write to `drive.fcm_tokens`.
 */
export function isUnclassifiedNotFound(code: string): boolean {
  return code === 'NOT_FOUND'
}

/**
 * The request was malformed. The fault is the sender's; the token may be
 * perfectly alive and must be left alone.
 */
export function isSenderPayloadError(code: string): boolean {
  return code === 'INVALID_ARGUMENT'
}

/**
 * The smallest number of attempts the abort brake is allowed to judge a rate on.
 *
 * The brake answers one question — "is FCM refusing this payload?" — and its
 * only evidence is the failure rate of what has been tried so far. That evidence
 * is worthless if the sample is tiny, and worse than worthless if somebody else
 * picks it. Both were true of the previous floor of 10:
 *
 *  - the broadcast audience comes from `core.get_audience_push_tokens`, which
 *    builds it with `array_agg(DISTINCT tok)`, and DISTINCT SORTS. The first
 *    tokens tried were never a sample of the base, they were its
 *    lexicographically smallest rows (measured 2026-08-23: `array_agg(distinct
 *    …)` over `zzz-token, !!!aaa, 0abc, mmm, APA91b-…` returns
 *    `["0abc","!!!aaa","APA91b-…","mmm","zzz-token"]`);
 *  - `drive.fcm_tokens` takes an INSERT from any signed-in user for their own
 *    `user_id`, and its only uniqueness is `(user_id, device_id)`. Rows holding
 *    junk that sorts early are therefore cheap to plant, and a malformed token
 *    answers 400 INVALID_ARGUMENT.
 *
 * Ten planted rows were enough to fail the first ten attempts of every broadcast
 * and stop the send for the entire base — a `break` any tourist could pull, and
 * on `/process-scheduled` the item is then marked `failed` with no retry. Two
 * changes answer it and both are needed: `sampledSendOrder` takes the choice of
 * sample away from whoever controls the ordering, and this floor makes the
 * sample large enough to mean something. Together they move the cost of forcing
 * an abort from 10 planted rows to roughly half of the whole audience.
 *
 * Why 50 and not 10: the brake is only consulted ON a failure, so inside a block
 * of junk `attempted` equals the failure count — which makes this floor exactly
 * the length a contiguous block of planted rows would need to reach, and 50 rows
 * is past any cluster that arrives by accident. Elsewhere in the run the rate
 * gate demands 25 failures in the first 50 attempts, which under `sampledSendOrder`
 * no longer follows from ordering. Why not 500: the price of judging late is only
 * wasted FCM round-trips (50 sequential calls, ~10 s) while the price of judging
 * early is a broadcast that dies for everyone. The asymmetry sets the number, not
 * roundness.
 *
 * Why the token format is NOT validated before sending instead: FCM publishes no
 * grammar for a registration token. The documentation says only "Make sure it
 * matches the registration token the client app receives from registering with
 * FCM. Do not truncate the token or add additional characters"
 * (https://firebase.google.com/docs/cloud-messaging/error-codes). A regex here
 * would be a second, invented source of truth about a string only FCM can judge,
 * and its failure mode is silently dropping real recipients — a worse outcome
 * than the one it would prevent.
 */
export const ABORT_MIN_SAMPLE = 50

/**
 * Should the send loop stop? A rejected payload fails EVERY token, so the signal
 * is the rate, not the count: at least half of everything attempted so far, over
 * a sample of at least `ABORT_MIN_SAMPLE` attempts.
 *
 * Why half and not all: a real base carries dead registrations, and with
 * `sampledSendOrder` they are spread through the run instead of clustered. A
 * single UNREGISTERED would break a "100% failed" streak and disarm the brake
 * forever, on precisely the run where it is needed.
 *
 * @param invalidArgumentCount INVALID_ARGUMENT failures so far in this run
 * @param attempted            tokens tried so far, successes included
 */
export function shouldAbortForBadPayload(
  invalidArgumentCount: number,
  attempted: number
): boolean {
  return attempted >= ABORT_MIN_SAMPLE && invalidArgumentCount * 2 >= attempted
}

/**
 * The order the send loop walks the recipients in — a uniform shuffle, which is
 * what makes the failure rate the brake reads a sample of the AUDIENCE instead
 * of a sample of its lexicographic head. See `ABORT_MIN_SAMPLE` for why the head
 * is attacker-controlled; without this, the brake is reachable from 25 planted
 * rows no matter how high the floor is set.
 *
 * Fisher-Yates over a copy: the input array is left alone, and every recipient
 * appears exactly once. Dropping or duplicating a token here would be a silent
 * delivery bug, which is why the tests pin the permutation and not just the
 * disorder.
 */
export function sampledSendOrder<T>(tokens: readonly T[]): T[] {
  const out = tokens.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
