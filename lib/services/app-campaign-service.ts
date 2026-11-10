/**
 * The coupon a gift campaign gives lives and dies with the campaign (#1192, security review of #1190).
 *
 * A redeemed coupon of days keeps its code visible to whoever redeemed it, so a code that outlives
 * the campaign can be passed around. On every save the coupon follows the STATE of the campaign,
 * never the transition (a save that failed halfway and is repeated must still land):
 *
 *   - `valid_until` of the coupon = `ends_at` of the campaign (null with null: then the coupon ends
 *     when the campaign is turned off).
 *   - campaign on: its coupon on. Campaign off: its coupon off, unless another campaign that is on
 *     still gives the same coupon.
 *   - the coupon the campaign gave before this save, when it is no longer the one it gives (swapped
 *     for another, or the action left `redeem_coupon`), is turned off by the same "unless shared" rule.
 *
 * Not atomic with the campaign write (no transaction across PostgREST calls, and no migration in
 * this card): the campaign is written first, and a coupon write that fails comes back as
 * `coupon_sync_failed`, so the operator saves again and the next save repairs the coupon.
 * Server only: runs on the service role after `withAuth` proved an admin.
 */

import type { CampaignWriteFields } from '@/lib/campaigns/app-campaigns'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface CampaignCouponState {
  id: string
  is_active: boolean
  ends_at: string | null
  action_type: CampaignWriteFields['action_type']
  coupon_id: string | null
}

/** What the campaign row said about its coupon before this save (`null` on create). */
export type PreviousCampaignCoupon = Partial<Pick<CampaignCouponState, 'action_type' | 'coupon_id'>> | null

type Sync = { ok: true } | { ok: false }

function giftCoupon(c: PreviousCampaignCoupon): string | null {
  return c?.action_type === 'redeem_coupon' && c.coupon_id ? c.coupon_id : null
}

/** `true` when another campaign that is on gives this coupon; `null` when the lookup failed. */
async function sharedByAnotherActiveCampaign(db: Db, couponId: string, campaignId: string): Promise<boolean | null> {
  const { data, error } = await db
    .schema('drive')
    .from('in_app_campaigns')
    .select('id')
    .eq('coupon_id', couponId)
    .eq('is_active', true)
    .neq('id', campaignId)
    .limit(1)
  if (error) {
    console.error('[app-campaigns] coupon sharing lookup failed:', error.code)
    return null
  }
  return Array.isArray(data) && data.length > 0
}

async function writeCoupon(db: Db, couponId: string, patch: Record<string, unknown>): Promise<boolean> {
  // The effect is the proof: the row must come back, or nothing was written.
  const { data, error } = await db
    .schema('drive')
    .from('coupons')
    .update(patch)
    .eq('id', couponId)
    .select('id')
    .maybeSingle()
  if (error || !data) {
    console.error('[app-campaigns] coupon sync failed:', error?.code ?? 'no row')
    return false
  }
  return true
}

export async function syncCampaignCoupon(
  db: Db,
  campaign: CampaignCouponState,
  previous: PreviousCampaignCoupon
): Promise<Sync> {
  const current = giftCoupon(campaign)
  const left = giftCoupon(previous)

  if (left && left !== current) {
    const shared = await sharedByAnotherActiveCampaign(db, left, campaign.id)
    if (shared === null) return { ok: false }
    if (!shared && !(await writeCoupon(db, left, { is_active: false }))) return { ok: false }
  }

  if (!current) return { ok: true }
  const patch: { valid_until: string | null; is_active?: boolean } = { valid_until: campaign.ends_at }
  if (campaign.is_active) {
    patch.is_active = true
  } else {
    const shared = await sharedByAnotherActiveCampaign(db, current, campaign.id)
    if (shared === null) return { ok: false }
    if (!shared) patch.is_active = false
  }
  return (await writeCoupon(db, current, patch)) ? { ok: true } : { ok: false }
}
