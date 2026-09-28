/**
 * PATCH /api/admin/coupons/:id — update an existing coupon
 *
 * Admin-only. Immutable on purpose:
 *   - code              already printed/distributed in physical material;
 *                       silently renaming would orphan campaigns
 *   - owner_client_id   the partner attribution is the whole point of
 *                       owner-scoped coupons; re-pointing midflight would
 *                       misattribute past + future redemptions
 *   - redeemed_count    historical counter, written by the redeem flow
 *
 * Everything else is mutable — the grant (kind + amount), eligibility rules, redemption
 * limits, validity window, internal notes, and the is_active toggle.
 * The CMS shows a banner warning the admin when editing a coupon that
 * already has redemptions, so the impact on existing users is explicit.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  getSupabaseRouteHandler,
  getSupabaseService,
} from '@/lib/core/supabase-client';
import { couponWriteRefusal, parseCouponGrant } from '@/lib/coupons/grant';

async function isAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  const supabaseAuth = getSupabaseRouteHandler(cookieStore);

  const { data: { session }, error: authError } =
    await supabaseAuth.auth.getSession();
  if (authError || !session) return false;

  const { data: cmsUser, error: cmsError } = await supabaseAuth
    .schema('core')
    .from('cms_users')
    .select('role, is_active')
    .eq('email', session.user.email as string)
    .eq('is_active', true)
    .single();

  return !!cmsUser && !cmsError && cmsUser.role === 'admin';
}

/**
 * The grant travels as a unit (BR-MONETIZACAO-047): touching any of the three rewrites all
 * three, so a patch can never leave a row that `coupons_natureza_ck` refuses.
 */
const GRANT_FIELDS = ['grant_kind', 'grant_minutes', 'duration_days'] as const;

const EDITABLE_FIELDS = [
  'eligibility',
  'stack_with_active',
  'max_redemptions',
  'max_redemptions_per_user',
  'valid_from',
  'valid_until',
  'notes',
  'is_active',
] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json(
        { error: 'Forbidden - Admin only' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;

    // Build the update payload from the allow-list. Anything outside the
    // EDITABLE_FIELDS list is silently dropped — code/owner_client_id/
    // redeemed_count are intentionally not updatable here.
    const updateData: Record<string, unknown> = {};
    for (const field of EDITABLE_FIELDS) {
      if (field in body) {
        updateData[field] = body[field];
      }
    }

    if (GRANT_FIELDS.some(field => field in body)) {
      // Explicit kind required here: defaulting to `until` would silently turn an hours
      // coupon into a days coupon on a patch that only sent `duration_days`.
      if (!('grant_kind' in body)) {
        return NextResponse.json(
          { error: 'grant_kind is required when changing the grant' },
          { status: 400 }
        );
      }
      const grant = parseCouponGrant(body);
      if (!grant.ok) {
        return NextResponse.json({ error: grant.error }, { status: 400 });
      }
      Object.assign(updateData, grant.fields);
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No editable fields provided' },
        { status: 400 }
      );
    }

    // Server-side validation for shape — keep the same rules as POST.
    if ('eligibility' in updateData) {
      const v = updateData.eligibility;
      if (v !== 'any' && v !== 'new_subscribers_only') {
        return NextResponse.json(
          { error: 'eligibility must be "any" or "new_subscribers_only"' },
          { status: 400 }
        );
      }
    }
    if ('max_redemptions' in updateData) {
      const v = updateData.max_redemptions;
      if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 1)) {
        return NextResponse.json(
          { error: 'max_redemptions must be NULL or a positive integer' },
          { status: 400 }
        );
      }
    }
    if ('max_redemptions_per_user' in updateData) {
      const v = updateData.max_redemptions_per_user;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 1) {
        return NextResponse.json(
          { error: 'max_redemptions_per_user must be a positive integer' },
          { status: 400 }
        );
      }
    }
    if ('is_active' in updateData && typeof updateData.is_active !== 'boolean') {
      return NextResponse.json(
        { error: 'is_active must be a boolean' },
        { status: 400 }
      );
    }

    const supabaseService = getSupabaseService();
    const { data, error } = await supabaseService
      .schema('drive')
      .from('coupons')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      // BR-MONETIZACAO-063 item 7: the cap is the database's, raised as TGM63.
      const refusal = couponWriteRefusal(error);
      if (refusal) return NextResponse.json(refusal.body, { status: refusal.status });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, coupon: data });
  } catch (error) {
    console.error('❌ Error updating coupon:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
