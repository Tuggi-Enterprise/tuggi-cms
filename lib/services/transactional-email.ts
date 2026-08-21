/**
 * The one door to `send-transactional`, and the only place that knows its ROUTE.
 *
 * WHY THIS EXISTS, and the defect that pays for it. Until 2026-08-21 the two contract
 * callers each assembled the invocation on their own, with the same comment copied and the
 * same `'send-transactional'` literal — and the literal was WRONG in both.
 * `docs/contracts/edge-functions.md` declares `POST /send` and `GET /health`, the function
 * answers `404 not_found` to any other path, and `functions.invoke('send-transactional')`
 * hits the root. No contract e-mail ever reached the body of the function:
 *
 *     POST | 404 | https://<project>.supabase.co/functions/v1/send-transactional
 *
 * Two copies of one decision go wrong together and nobody notices, which is the corollary of
 * CLAUDE.md §6 in a line. Here the route is a single fact, `TRANSACTIONAL_EMAIL_ROUTE`, and
 * `tests/api/partner-contract.test.ts` asserts it against the route in the contract.
 *
 * THE ENVELOPE IS READ, NOT JUST `error`. `functions.invoke` resolves for any HTTP answer
 * and only fills `error` on a non-2xx, so a 200 carrying `{ error }` is a failure that looks
 * like success. This function reduces both ways of failing to one boolean.
 *
 * NO `href` LEAVES FROM HERE. The body carries data and, when the template needs it, the raw
 * TOKEN; the origin of every link is composed inside the Edge Function from a secret of
 * ours. That function is reachable with the publishable key until #346, and a template that
 * accepted an href from its caller would be a phishing kit signed with our DKIM.
 */

import { getSupabaseService } from '@/lib/core/supabase-client'

/** The deployment slug. On its own it is not an address: the route below is. */
export const TRANSACTIONAL_EMAIL_FUNCTION = 'send-transactional'

/**
 * What `functions.invoke` receives — the slug PLUS the `POST /send` route declared in
 * `docs/contracts/edge-functions.md`. Without the suffix the function answers 404.
 */
export const TRANSACTIONAL_EMAIL_ROUTE = `${TRANSACTIONAL_EMAIL_FUNCTION}/send`

/**
 * The closed list of templates, in the order of the contract. A type outside it answers
 * `500 unknown type` and sends nothing, on purpose.
 */
export type TransactionalEmailType =
  | 'partner_new'
  | 'partner_received'
  | 'partner_approved'
  | 'partner_rejected'
  | 'partner_contract_sign'
  | 'partner_contract_signed'

export interface TransactionalEmailInput {
  type: TransactionalEmailType
  to: string
  /** Both contract types are always `pt`; the partner's own types follow their language. */
  lang?: string
  data?: Record<string, unknown>
  /** Named in the log when the send fails, so the log says WHICH send failed. */
  context: string
}

/**
 * Sends, and answers whether it went out. Never throws: an e-mail that does not leave must
 * not bring down the act that produced it — the signature is already committed, the link is
 * already minted, and the caller decides what to tell the operator.
 */
export async function sendTransactionalEmail(input: TransactionalEmailInput): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseService().functions.invoke(
      TRANSACTIONAL_EMAIL_ROUTE,
      {
        body: {
          type: input.type,
          to: input.to,
          lang: input.lang ?? 'pt',
          data: input.data ?? {},
        },
      }
    )

    if (error || (data && typeof data === 'object' && 'error' in data)) {
      console.error(`[transactional] ${input.context} refused by ${TRANSACTIONAL_EMAIL_ROUTE}`)
      return false
    }
    return true
  } catch (err) {
    console.error(
      `[transactional] ${input.context} failed:`,
      err instanceof Error ? err.message : err
    )
    return false
  }
}
