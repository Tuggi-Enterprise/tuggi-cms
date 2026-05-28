/**
 * PATCH /api/admin/coupons/:id — toggle is_active on an existing coupon
 *
 * Admin-only. Only the `is_active` flag is mutable from the CMS for now —
 * other fields (code, duration, eligibility, etc.) are immutable to avoid
 * silently invalidating already-printed campaigns. Delete the row + create
 * a fresh one if you really need to change them.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  getSupabaseRouteHandler,
  getSupabaseService,
} from '@/lib/core/supabase-client';

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
    const body = await request.json();
    const { is_active } = body as { is_active?: boolean };

    if (typeof is_active !== 'boolean') {
      return NextResponse.json(
        { error: 'Only is_active (boolean) is mutable' },
        { status: 400 }
      );
    }

    const supabaseService = getSupabaseService();
    const { data, error } = await supabaseService
      .schema('drive')
      .from('coupons')
      .update({ is_active })
      .eq('id', id)
      .select()
      .single();

    if (error) {
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
