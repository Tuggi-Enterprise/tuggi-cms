/**
 * Typed refusals of the hour-credit ledger — the contract between
 * `app/api/admin/users/[userId]/credit/*` and the screen.
 *
 * Two rules decide the shape of this module, and both come from written decisions:
 *
 * 1. **Classification is by SQLSTATE, never by matching a substring of the message.**
 *    `docs/contracts/entitlement.md`, "As duas recusas de quantidade": `TGM49` and
 *    `TGM63` exist as separate codes precisely so the CMS can pick a different message
 *    without reading prose. `22023` already means nine different things inside
 *    `drive.record_time_credit_grant`, so it classifies nothing on its own and stays
 *    `unknown`: picking between the nine would be the substring match again.
 *
 * 2. **The database message never crosses to the browser.** `message`, `details` and
 *    `hint` of a PostgREST error carry identifiers — the uuid of the profile, the name
 *    of the routine — and the operator's screen gets photographed into a support
 *    ticket (spec §9). The only thing extracted from the text is the cap integer of
 *    `TGM63`, because BR-MONETIZACAO-063 item 1 requires the cap to be told to the
 *    operator and `drive.manual_grant_cap_minutes()` is its single owner: reading the
 *    number back is not a second declaration of it, restating `2700` here would be.
 *
 * One code classifies a **state** instead of an exception: `period_applied_no_record`. A
 * period grant is two transactions, and when the second one fails the tourist holds the
 * right while the ledger holds nothing. Which SQLSTATE the second call raised does not
 * change what the operator must do — what matters is that repeating STACKS the period
 * (BR-MONETIZACAO-065). It is decided by `grantUntil` in
 * `app/api/admin/users/[userId]/credit/route.ts`, not here; the atomic door is card #328.
 */

/** What the screen switches on. One value, one message key under `Pages.AppUsers.credit.errors`. */
export type CreditErrorCode =
  | 'forbidden'
  | 'no_profile'
  | 'not_multiple'
  | 'above_cap'
  | 'period_applied_no_record'
  | 'grant_not_found'
  | 'already_revoked'
  | 'unknown'

export interface CreditError {
  code: CreditErrorCode
  /** Raw SQLSTATE, carried only so `errors.unknown` can print `Código {code}`. */
  sqlstate?: string
  /** Cap in minutes, read back from the `TGM63` exception text. Never declared here. */
  capMinutes?: number
}

/**
 * Which call raised the error, stated by the caller.
 *
 * It used to select a message: a `22023` from the second call of `until` was read as "the
 * period was not applied yet". That step is gone with its message — reaching the second
 * call means the period is already committed, so the sentence would have ordered the
 * operator to apply a period that exists, and applying it again STACKS it
 * (BR-MONETIZACAO-065). `grantUntil` answers `period_applied_no_record` for that whole
 * call, and the atomic door of #328 removes the ordering altogether, so the state never
 * comes back. Today no SQLSTATE branches on the step: classification is by SQLSTATE alone,
 * and the step is what the call sites and `tests/api/credit-surface.test.ts` vary to prove
 * that none of them changes the answer.
 */
export type CreditCallStep = 'read' | 'grant' | 'revoke' | 'apply_period'

interface PostgrestLikeError {
  code?: string | null
  message?: string | null
}

/** Cap, in minutes, as `drive.record_time_credit_grant` states it inside the TGM63 text. */
function readCapFromMessage(message: string | null | undefined): number | undefined {
  if (!message) return undefined
  const match = /teto de (\d+) minutos/.exec(message)
  if (!match) return undefined
  const cap = Number.parseInt(match[1], 10)
  return Number.isFinite(cap) ? cap : undefined
}

/**
 * The step is named by every call site and read by none: the underscore says so out loud.
 * It stays because "which call failed" is exactly what this function is not allowed to
 * classify on, and the argument is what the test varies to prove it.
 */
export function classifyLedgerError(
  error: PostgrestLikeError | null | undefined,
  _step: CreditCallStep
): CreditError {
  const sqlstate = error?.code ?? undefined

  switch (sqlstate) {
    case '42501':
      return { code: 'forbidden', sqlstate }
    case 'P0002':
      return { code: 'no_profile', sqlstate }
    case 'TGM49':
      return { code: 'not_multiple', sqlstate }
    case 'TGM63':
      return { code: 'above_cap', sqlstate, capMinutes: readCapFromMessage(error?.message) }
    default:
      return { code: 'unknown', sqlstate }
  }
}

/** HTTP status this route answers with. The ledger's own statuses, not PostgREST's. */
export function creditErrorStatus(error: CreditError): number {
  switch (error.code) {
    case 'forbidden':
      return 403
    case 'no_profile':
      return 404
    case 'not_multiple':
    case 'above_cap':
      return 400
    // Nothing the operator sent is wrong, and nothing they can send fixes it: the access
    // period is committed in `drive.profiles` and its ledger row is missing. 500 is what
    // keeps this out of the "correct your input and send it again" family.
    case 'period_applied_no_record':
      return 500
    case 'grant_not_found':
      return 404
    case 'already_revoked':
      return 409
    default:
      return 500
  }
}

/**
 * Envelope refusals of `drive.revoke_time_credit`. They arrive inside a 200 with
 * `ok: false`, because a business outcome is an envelope and a gate is an exception
 * (`docs/contracts/entitlement.md`, "Um escritor, várias portas").
 */
export function classifyRevokeEnvelope(reason: string | null | undefined): CreditError {
  switch (reason) {
    case 'grant_not_found':
      return { code: 'grant_not_found' }
    case 'already_revoked':
      return { code: 'already_revoked' }
    default:
      return { code: 'unknown' }
  }
}
