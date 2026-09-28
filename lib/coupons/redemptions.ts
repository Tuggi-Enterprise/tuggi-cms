/**
 * Coupon redemptions list — card #787, spec `docs/design/spec-cms-resgates-de-cupom-2026-09.md`.
 *
 * BR-MONETIZACAO-047: a redemption grants EITHER minutes (hours balance) OR days (legacy `until`
 * coupon). The two units never add into one number: the totals keep them apart, and each row
 * prints the unit the redemption carries, never an inferred one.
 */

/** One row of `drive.list_coupon_redemptions`. `user_email` is personal data: never log it. */
export interface CouponRedemption {
  redemption_id: string
  coupon_id: string
  coupon_code: string
  owner_client_id: string | null
  owner_name: string | null
  user_id: string
  user_email: string | null
  redeemed_at: string
  minutes_granted: number | null
  days_granted: number | null
}

export interface RedemptionTotals {
  redemptions: number
  minutes_granted: number
  days_granted: number
}

/** Totals over EVERY row of the filter, not the page (spec, "Pronto quando" 1). */
export function summarizeRedemptions(rows: readonly CouponRedemption[]): RedemptionTotals {
  let minutes = 0
  let days = 0
  for (const r of rows) {
    minutes += Number(r.minutes_granted ?? 0)
    days += Number(r.days_granted ?? 0)
  }
  return { redemptions: rows.length, minutes_granted: minutes, days_granted: days }
}

/** The grant a row carries: minutes when present, otherwise days. `null` = neither is recorded. */
export function redemptionGrant(
  row: Pick<CouponRedemption, 'minutes_granted' | 'days_granted'>
): { unit: 'minutes' | 'days'; amount: number } | null {
  if (row.minutes_granted != null) return { unit: 'minutes', amount: Number(row.minutes_granted) }
  if (row.days_granted != null) return { unit: 'days', amount: Number(row.days_granted) }
  return null
}
