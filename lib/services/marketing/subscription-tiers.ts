/**
 * The subscription tiers, read from whoever owns them.
 *
 * WHY THIS EXISTS. The tier picker of `AudienceFilter` carried the list by hand: a
 * `<SelectItem value="19ed18ca-c285-4d60-85cd-7e6b4810aa44">Free Plan</SelectItem>` next to a
 * `<SelectItem value="pro">Premium Plan</SelectItem>`. Two things wrong at once.
 *
 *  1. `core.build_audience_filter` does `(p_filters->>'subscription_tier_id')::uuid`, so the
 *     literal `'pro'` raised 22P02 — the paying segment NEVER worked, in push or in e-mail. The
 *     component's `catch` swallowed the error and painted `UNKNOWN`, which is how it survived.
 *  2. A uuid pasted into JSX is a second owner of one fact (CLAUDE.md §6, SSOT).
 *     `drive.subscription_tiers` is the first one; a new tier is born there and the CMS never
 *     hears about it.
 *
 * THE SAME READ ALREADY EXISTED, inline, in `components/admin/credit/GrantCreditDialog.tsx`
 * (`.schema('drive').from('subscription_tiers')`). Here it is a module because it now has two
 * callers — the audience filter is mounted by the newsletter and by push.
 *
 * DELIBERATE DIFFERENCE FROM THE CREDIT DIALOG: there `Free` is filtered out, because granting a
 * period on a free tier writes a paid end date onto a profile the app reads as free. Here `Free`
 * is a legitimate segment — "who has not subscribed yet" is the most obvious audience a campaign
 * has — so the list comes out whole.
 */

import { getSupabaseClient } from '@/lib/core/supabase-client'

export interface SubscriptionTierOption {
  id: string
  name: string
  display_name: string | null
}

/** The active tiers, in a stable order. Errors propagate — the caller decides what to show. */
export async function listSubscriptionTiers(): Promise<SubscriptionTierOption[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .schema('drive')
    .from('subscription_tiers')
    .select('id, name, display_name')
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  return (data ?? []) as SubscriptionTierOption[]
}

/** The label the operator reads. `display_name` is nullable in the table; `name` is NOT NULL. */
export function tierLabel(tier: SubscriptionTierOption): string {
  return tier.display_name?.trim() || tier.name
}
