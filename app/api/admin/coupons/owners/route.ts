/**
 * GET /api/admin/coupons/owners — list owner-level coupon performance
 *
 * Admin-only. Wraps the SECURITY DEFINER RPC drive.list_owner_coupon_performance
 * so the CMS dashboard can render the partner-facing view ("Neymar drove
 * X redemptions, Y converted to paid").
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  getSupabaseRouteHandler,
  getSupabaseService,
} from '@/lib/core/supabase-client';

export async function GET(_request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabaseAuth = getSupabaseRouteHandler(cookieStore);

    const { data: { session }, error: authError } =
      await supabaseAuth.auth.getSession();
    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: cmsUser, error: cmsError } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('id, role, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single();

    if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden - Admin only' },
        { status: 403 }
      );
    }

    const supabaseService = getSupabaseService();
    const { data, error } = await supabaseService
      .schema('drive')
      .rpc('list_owner_coupon_performance');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, owners: data ?? [] });
  } catch (error) {
    console.error('❌ Error fetching owner performance:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
