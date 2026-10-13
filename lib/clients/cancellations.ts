/**
 * The cancellations of the Com história plan made in the Portal Locais, with the survey answers
 * (#913, BR-B2B-060). Read from `partner.list_place_cancellation_feedback()` and shown in
 * `/admin/clients/cancellations` and in the client record (Fiscal & Pagamentos).
 *
 * Pure: types, the filter of the URL, and the one contact state the list and the record share.
 */

/**
 * BR-B2B-060 item 3, the closed list. The EF keeps the same list in
 * `supabase/functions/_shared/places-payment.ts` (`CANCEL_REASONS`): Deno source, which the
 * repo's `tsc` cannot import. A new code is an amendment of the rule, and changes both.
 */
export const CANCEL_REASONS = ['too_expensive', 'no_results', 'few_tourists', 'closing_business', 'portal_or_payment_issue', 'other'] as const
export type CancelReason = (typeof CANCEL_REASONS)[number]

export const isCancelReason = (v: unknown): v is CancelReason => (CANCEL_REASONS as readonly unknown[]).includes(v)

/** BR-B2B-060 items 5 and 7: one state, never only a color. */
export type ContactState = 'pending' | 'done' | 'declined'
export const CONTACT_STATES: readonly ContactState[] = ['pending', 'done', 'declined']
export const isContactState = (v: unknown): v is ContactState => (CONTACT_STATES as readonly unknown[]).includes(v)

/** A row of `partner.list_place_cancellation_feedback()`, only the columns the CMS reads. */
export interface CancellationFeedbackRow {
  feedback_id: string
  client_id: string | null
  place_name: string | null
  renewal_canceled_at: string | null
  reason: string | null
  comment: string | null
  contact_consent: boolean
  contacted_at: string | null
  contacted_by: string | null
  created_at: string
}

/** What the route answers per row: no e-mail, no consent text, no signer (the screen shows none). */
export interface Cancellation {
  feedbackId: string
  clientId: string | null
  placeName: string | null
  /** `renewal_canceled_at`, or the record's own time when the subscription lost it. */
  canceledAt: string
  reason: CancelReason | null
  comment: string | null
  contact: ContactState
  contactedAt: string | null
  /** `operatorLabel` of `contacted_by`; null under service_role or when Auth does not answer. */
  contactedBy: string | null
}

/** Consent and nobody talked → pending; consent and somebody did → done; no consent → declined. */
export function contactStateOf(row: Pick<CancellationFeedbackRow, 'contact_consent' | 'contacted_at'>): ContactState {
  if (!row.contact_consent) return 'declined'
  return row.contacted_at ? 'done' : 'pending'
}

export interface CancellationFilter {
  contact: ContactState | null
  reason: CancelReason | null
  clientId: string | null
}

/**
 * Newest first (spec §5, "Ordem"); the RPC sorts pending first, the queue is `?contact=pending`.
 * An unknown filter value is no filter.
 */
export function toCancellations(
  rows: CancellationFeedbackRow[],
  filter: CancellationFilter,
  names: Map<string, string>
): Cancellation[] {
  return rows
    .map((r) => ({
      feedbackId: r.feedback_id,
      clientId: r.client_id,
      placeName: r.place_name,
      canceledAt: r.renewal_canceled_at ?? r.created_at,
      reason: isCancelReason(r.reason) ? r.reason : null,
      comment: r.comment,
      contact: contactStateOf(r),
      contactedAt: r.contacted_at,
      contactedBy: r.contacted_by ? (names.get(r.contacted_by) ?? null) : null,
    }))
    .filter(
      (c) =>
        (!filter.contact || c.contact === filter.contact) &&
        (!filter.reason || c.reason === filter.reason) &&
        (!filter.clientId || c.clientId === filter.clientId)
    )
    .sort((a, b) => b.canceledAt.localeCompare(a.canceledAt))
}

/**
 * The database's refusals of the list and mark/unmark functions, as HTTP. Anything else is 500 with the
 * code only in the log (the raw message can quote a value).
 */
export function contactErrorStatus(code: string | null | undefined): { status: number; error: string } {
  if (code === '42501') return { status: 403, error: 'forbidden' }
  // The only 22023 of mark/unmark is `no_contact_consent` (BR-B2B-060 item 5: no consent, no contact).
  if (code === '22023') return { status: 409, error: 'no_contact_consent' }
  if (code === 'P0002') return { status: 404, error: 'feedback_not_found' }
  if (code === 'PGRST202' || code === '42883') return { status: 503, error: 'not_available' }
  return { status: 500, error: 'internal' }
}
