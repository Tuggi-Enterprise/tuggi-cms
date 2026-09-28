/**
 * GET /api/admin/coupons/redemptions?coupon=<CODE>&owner=<client_id>&page=&limit=
 *
 * Admin-only, same gate as ../owners/route.ts. Wraps drive.list_coupon_redemptions (#787,
 * BR-MONETIZACAO-047): one row per redemption, newest first. The totals cover the whole filter,
 * the rows only the page, and minutes and days are totalled apart.
 *
 * The rows carry the account e-mail (personal data): nothing from a row, nor the raw database
 * message (it can quote a value), goes to the log — only the error code.
 *
 * Until the migration is applied the function does not exist: PostgREST answers PGRST202 and
 * the route turns it into 503 `not_available`, which the page shows as a friendly empty state.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  getSupabaseRouteHandler,
  getSupabaseService,
} from '@/lib/core/supabase-client';
import { UUID } from '@/lib/finance/input';
import { summarizeRedemptions, type CouponRedemption } from '@/lib/coupons/redemptions';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_CODE_LENGTH = 64;
/** PostgREST "function not found in the schema cache", and Postgres undefined_function. */
const FUNCTION_MISSING = new Set(['PGRST202', '42883']);

function positiveInt(raw: string | null, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
}

export async function GET(request: NextRequest) {
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

    const params = request.nextUrl.searchParams;
    const code = (params.get('coupon') ?? '').trim().toUpperCase();
    const owner = (params.get('owner') ?? '').trim();
    const limit = positiveInt(params.get('limit'), DEFAULT_LIMIT, MAX_LIMIT);
    const page = positiveInt(params.get('page'), 1, Number.MAX_SAFE_INTEGER);

    if (code.length > MAX_CODE_LENGTH) {
      return NextResponse.json({ error: 'coupon is too long' }, { status: 400 });
    }
    if (owner && !UUID.test(owner)) {
      return NextResponse.json({ error: 'owner must be a uuid' }, { status: 400 });
    }

    const supabaseService = getSupabaseService();

    let couponId: string | null = null;
    if (code) {
      const { data: coupon, error: couponError } = await supabaseService
        .schema('drive')
        .from('coupons')
        .select('id')
        .eq('code', code)
        .maybeSingle();
      if (couponError) {
        console.error('❌ coupon lookup failed:', couponError.code);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
      }
      // An unknown code is an empty filter, not "every coupon".
      if (!coupon) return respond([], page, limit);
      couponId = coupon.id as string;
    }

    const { data, error } = await supabaseService
      .schema('drive')
      .rpc('list_coupon_redemptions', {
        p_coupon_id: couponId,
        p_owner_client_id: owner || null,
      });

    if (error) {
      if (error.code && FUNCTION_MISSING.has(error.code)) {
        return NextResponse.json(
          { error: 'Redemptions list not available', code: 'not_available' },
          { status: 503 }
        );
      }
      console.error('❌ list_coupon_redemptions failed:', error.code);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    return respond((data ?? []) as CouponRedemption[], page, limit);
  } catch (error) {
    console.error('❌ Error listing coupon redemptions:', (error as Error)?.name);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function respond(rows: CouponRedemption[], page: number, limit: number) {
  const pages = Math.max(1, Math.ceil(rows.length / limit));
  const start = (page - 1) * limit;
  return NextResponse.json({
    success: true,
    redemptions: rows.slice(start, start + limit),
    totals: summarizeRedemptions(rows),
    pagination: { page, limit, total: rows.length, pages },
  });
}
