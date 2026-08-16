/**
 * Turns a typed refusal into the sentence the operator reads.
 *
 * The screen switches on `code` and never on the text of the database error: the two
 * SQLSTATEs that matter here (`TGM49`, `TGM63`) exist as separate codes exactly so this
 * mapping can be a `switch` and not a substring match. Nothing coming from `SQLERRM`
 * reaches this function — `lib/credit/errors.ts` keeps it on the server.
 *
 * The network case is the most important one on the screen (spec §9): a CMS grant is not
 * idempotent, so a timeout plus the reflex to retry is the one path that grants twice.
 * It tells the operator to check the history BEFORE trying again, and whoever renders it
 * gives it no retry button.
 */

import { formatDuration, nearestBlockValues } from '@/lib/format/duration'

export interface CreditFailure {
  code: string
  sqlstate?: string
  capMinutes?: number
  /**
   * The response carried no typed refusal — an HTML gateway timeout, a truncated body, a
   * proxy page. It is NOT the same as a refusal: nothing proves the grant did not happen,
   * so whoever runs a batch must treat it like a network failure and not offer a retry
   * (card #330, and `outcome.ts`).
   */
  unreadable?: true
}

/** `t` is bound to `Pages.AppUsers.credit`, so keys carry their group. */
type Translate = (key: string, values?: Record<string, string | number>) => string

export interface FailureContext {
  /** What was asked for, so `not_multiple` can name the two valid neighbours. */
  requestedMinutes?: number
  /** Latest date the period grant may reach — BR-MONETIZACAO-017. */
  maxUntilLabel?: string
}

export function creditFailureText(
  t: Translate,
  failure: CreditFailure,
  context: FailureContext = {}
): string {
  switch (failure.code) {
    case 'forbidden':
      return t('errors.forbidden')
    case 'no_profile':
      return t('errors.no_profile')
    case 'not_multiple': {
      const { lower, upper } = nearestBlockValues(context.requestedMinutes ?? 0)
      return t('errors.not_multiple', { lower, upper })
    }
    case 'above_cap':
      // Both units, like every other number on this screen: the operator types hours and
      // the cap arrives in minutes, and a refusal is the one moment they would have to
      // convert in their head. `formatDuration` is the same owner of the format used by
      // `form.total` and `confirm.sentence_minutes` — the cap itself is still read back
      // from the exception, never declared here (BR-MONETIZACAO-063).
      return failure.capMinutes
        ? t('errors.above_cap', {
            cap: failure.capMinutes,
            duration: formatDuration(failure.capMinutes),
          })
        : t('errors.above_cap_unknown')
    case 'grant_not_found':
      return t('revoke.not_found')
    case 'already_revoked':
      return t('revoke.already')
    case 'reason_required':
    case 'reason_too_long':
      return t('revoke.reason_required')
    case 'until_required':
      return t('form.until_required')
    case 'until_past':
      return t('form.until_past')
    case 'until_too_far':
      return t('form.until_max', { date: context.maxUntilLabel ?? '' })
    case 'invalid_tier':
      return t('form.license_required')
    case 'network':
      return t('errors.network')
    // The one refusal that reports a state instead of an error: the period is committed on
    // the profile and its ledger row is not. The sentence says so first, then forbids the
    // repeat with the damage it causes, and then says the history will be empty — because
    // `errors.network` above trained the operator to check the history before retrying, and
    // here it is empty on purpose. It is never shown beside a retry button (`outcome.ts`).
    case 'period_applied_no_record':
      return t('errors.period_applied_no_record')
    default:
      return t('errors.unknown', { code: failure.sqlstate ?? failure.code })
  }
}

/**
 * Reads a refusal out of a `fetch` response.
 *
 * A body that is not JSON is the shape a gateway timeout arrives in — Vercel answers 504
 * with an HTML page — and that is the case where the grant may have gone through and the
 * answer got lost. It comes back marked `unreadable`, so the caller can tell it apart from
 * a refusal the server actually made.
 */
export async function readFailure(response: Response): Promise<CreditFailure> {
  try {
    const body = await response.json()
    const error = body?.error
    if (error && typeof error.code === 'string') return error as CreditFailure
  } catch {
    return { code: 'unknown', sqlstate: String(response.status), unreadable: true }
  }
  return { code: 'unknown', sqlstate: String(response.status) }
}
