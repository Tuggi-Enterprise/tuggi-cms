/**
 * #1054 — which paid plan a place of the client record has, for the "Cancelar plano" button of the
 * Locais tab (spec `docs/design/spec-cancelamento-places-2026-10.md` §9.2). Pure, from what the
 * record already read: the portal records (`ClientPortalRecord`) and the client row with its
 * `legacy_plans`. It only decides whether to OFFER the button and what the plan line says; what the
 * cancel does, the date and the fee come from `places-payment` (`support_cancel_quote`), which
 * reads `partner.support_place_plans` — the database's one answer.
 */

import { isPaidPlan } from '@/lib/partnerships/portal-review'
import type { ClientPortalRecord } from '@/lib/services/portal-submission-review-service'
import type { Client } from '@/types/clients'

export type PlacePlan =
  | { plan: 'experience' | 'legacy'; state: 'active'; monthlyCents: number | null }
  | { plan: 'experience' | 'legacy'; state: 'canceled'; storyUntil: string | null }
  | null

/** Same filter as `partner.support_place_plans`: a paid plan whose subscription was attached or paid. */
function livePortalPayment(r: ClientPortalRecord): boolean {
  const p = r.payment
  if (!p || !isPaidPlan(r.acceptance?.planChoice)) return false
  if (p.status === 'paid' || p.status === 'past_due') return true
  return p.status === 'pending_payment' && (Boolean(p.paidAt) || Boolean(p.providerSubscriptionId))
}

export function placePlanOf(
  attractionId: string,
  client: Pick<Client, 'monthly_fee_cents' | 'is_courtesy' | 'legacy_plans'> | null,
  records: ClientPortalRecord[],
  now: Date = new Date()
): PlacePlan {
  const portal = records.filter((r) => r.attractionId === attractionId && livePortalPayment(r))
  const portalActive = portal.find((r) => !r.payment?.canceledAt)
  if (portalActive) return { plan: 'experience', state: 'active', monthlyCents: portalActive.payment?.renewalAmountCents ?? null }

  const legacyRows = client?.legacy_plans ?? []
  const legacyHere = legacyRows.filter((r) => r.attraction_id === attractionId)
  const fee = client?.monthly_fee_cents ?? 0
  const paying = fee > 0 && client?.is_courtesy !== true
  // A running mirror on this place, or a paying client who never opened the portal (no mirror at all).
  if (paying && (legacyHere.some((r) => !r.fee_ended_at) || legacyRows.length === 0)) {
    return { plan: 'legacy', state: 'active', monthlyCents: fee }
  }

  const portalCanceled = portal.find((r) => r.payment?.canceledAt)
  if (portalCanceled) return { plan: 'experience', state: 'canceled', storyUntil: portalCanceled.payment?.paidThrough ?? null }
  // An ended legacy fee is shown only while its story is still up.
  const legacyEnded = legacyHere.find((r) => r.fee_ended_at && r.story_until && new Date(r.story_until) > now)
  if (legacyEnded) return { plan: 'legacy', state: 'canceled', storyUntil: legacyEnded.story_until }
  return null
}

/** `YYYY-MM-DD` (the function's `ends_on`, a calendar day) as dd/mm/aaaa — never through `Date`, which would shift it a day. */
export function formatCalendarDay(day: string): string {
  const [y, m, d] = day.split('-')
  return `${d}/${m}/${y}`
}
