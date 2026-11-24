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
 * Not atomic with the campaign write (no transaction across PostgREST calls). The order makes a
 * retry repair everything (#1193, security review of d5c956c8):
 *   1. `releaseLeavingCoupon` BEFORE the campaign write. The row still names the old coupon, so if
 *      turning it off fails the campaign is left as it was and the next save sees the same swap.
 *      Written after, the row would already name the new coupon and the retry would never see the
 *      old one again.
 *   2. the campaign write.
 *   3. `syncCampaignCoupon`, the coupon the campaign gives now: it reads only the row, so a retry
 *      repeats it.
 * Either coupon step that fails comes back as `coupon_sync_failed` (500), never a success.
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

/**
 * Step 1: the coupon the row gives now (`previous`) and the save is about to take out (`next` gives
 * another, or none) is turned off, unless another campaign that is on still gives it. Runs before
 * the campaign write; nothing to do on create, nor when the save keeps the coupon.
 */
export async function releaseLeavingCoupon(
  db: Db,
  campaignId: string,
  previous: PreviousCampaignCoupon,
  next: PreviousCampaignCoupon
): Promise<Sync> {
  const left = giftCoupon(previous)
  if (!left || left === giftCoupon(next)) return { ok: true }
  const shared = await sharedByAnotherActiveCampaign(db, left, campaignId)
  if (shared === null) return { ok: false }
  if (!shared && !(await writeCoupon(db, left, { is_active: false }))) return { ok: false }
  return { ok: true }
}

/** Step 3: the coupon the written campaign gives follows its state and its `ends_at`. */
export async function syncCampaignCoupon(db: Db, campaign: CampaignCouponState): Promise<Sync> {
  const current = giftCoupon(campaign)
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
