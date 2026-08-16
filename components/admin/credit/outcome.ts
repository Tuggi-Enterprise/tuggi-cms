/**
 * What one grant produced, and what the screen is allowed to do with it next.
 *
 * These are the decisions of `GrantCreditDialog` that must be provable without a browser,
 * and every one of them exists for the same reason: **a CMS grant is not idempotent**. The
 * unique event index of `drive.time_credit_grants` covers `purchase` and `coupon` only, the
 * ledger is immutable (BR-MONETIZACAO-047) and undoing a duplicate is a manual revoke that
 * somebody has to notice first.
 *
 * So the retry set is built from the outcome, never from `!ok`: "the server refused" and
 * "the server never answered" look the same to a `for` loop and are opposites here. A
 * refusal that arrived with a response proves nothing was written. A `fetch` that threw
 * proves nothing at all — the grant may have gone through and the answer got lost, and that
 * recipient's id is not in `grantedIds` precisely because no answer came back. Card #330.
 */

import type { GrantTarget } from './types'

/**
 * How a single `POST /credit` ended.
 *
 * - `granted` — 2xx with an envelope. The recipient goes into `grantedIds`.
 * - `refused` — the server answered with a typed refusal. Nothing was written.
 * - `no_answer` — `fetch` threw, or the answer was unreadable. **Uncertain.**
 */
export type GrantOutcome =
  | { kind: 'granted' }
  | { kind: 'refused'; code: string }
  | { kind: 'no_answer' }

/**
 * Refusals that arrived with a response and STILL must not be sent again.
 *
 * `period_applied_no_record` is the whole reason this is a set and not a boolean: the
 * access period was committed and only its ledger row failed, so the tourist already holds
 * the right. Repeating does not record the missing row — `drive.apply_non_renewing_pass`
 * stacks on live access (BR-MONETIZACAO-065) and the operator ends up granting the period
 * twice while chasing a row that a manual fix has to write.
 */
const NEVER_RETRYABLE = new Set(['period_applied_no_record'])

/** Can this recipient be sent again by the retry button? */
export function isRetryable(outcome: GrantOutcome): boolean {
  switch (outcome.kind) {
    case 'granted':
      return false
    case 'no_answer':
      return false
    case 'refused':
      return !NEVER_RETRYABLE.has(outcome.code)
  }
}

export interface RunResult {
  target: GrantTarget
  ok: boolean
  /** Decided by `isRetryable` at the moment the outcome was read, never re-derived. */
  retryable: boolean
  message: string
}

/**
 * The recipients the retry button sends again — and nobody else.
 *
 * `grantedIds` is checked as well, and it is not redundant with `ok`: a retry round starts
 * from a queue that already granted somebody in a previous round of the SAME dialog.
 */
export function retryTargets(results: RunResult[], grantedIds: string[]): GrantTarget[] {
  return results
    .filter((result) => result.retryable && !grantedIds.includes(result.target.userId))
    .map((result) => result.target)
}

/**
 * Does the result have to say that the period was STACKED?
 *
 * `drive.apply_non_renewing_pass` adds the duration on top of live access, so the date the
 * operator picked and the date the tourist got are frequently different (BR-MONETIZACAO-065,
 * and the confirmation/result split of `DS-COMPONENTE-013`). The comparison is between the
 * two dates **as they are displayed**, not between instants: the route asks for a duration
 * in whole days counted from now, so the two instants almost never coincide, and comparing
 * instants would light the warning on every single grant. Card #333.
 */
export function periodWasStacked(
  requestedEndsAt: string | null | undefined,
  effectiveEndsAt: string | null | undefined,
  toDisplayDate: (iso: string) => string
): boolean {
  if (!requestedEndsAt || !effectiveEndsAt) return false
  return toDisplayDate(effectiveEndsAt) !== toDisplayDate(requestedEndsAt)
}
