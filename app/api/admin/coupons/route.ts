/**
 * GET  /api/admin/coupons        — list with search/status/pagination
 * POST /api/admin/coupons        — create a new coupon
 *
 * Admin-only. Mutations of drive.coupons go through service-role
 * (the table is RLS service-role-only by migration; the cms_users
 * auth check above keeps the endpoint locked to admins).
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  getSupabaseRouteHandler,
  getSupabaseService,
} from '@/lib/core/supabase-client';

interface AuthGateResult {
  ok: true;
  email: string;
}

interface AuthGateError {
  ok: false;
  response: NextResponse;
}

async function adminGate(): Promise<AuthGateResult | AuthGateError> {
  const cookieStore = await cookies();
  const supabaseAuth = getSupabaseRouteHandler(cookieStore);

  const { data: { session }, error: authError } =
    await supabaseAuth.auth.getSession();
  if (authError || !session) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const { data: cmsUser, error: cmsError } = await supabaseAuth
    .schema('core')
    .from('cms_users')
    .select('id, role, is_active')
    .eq('email', session.user.email as string)
    .eq('is_active', true)
    .single();

  if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Forbidden - Admin only' },
        { status: 403 }
      ),
    };
  }

  return { ok: true, email: session.user.email as string };
}

// ────────────────────────────────────────────────────────────────────────────
// GET: list coupons
// ────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const gate = await adminGate();
    if (!gate.ok) return gate.response;

    const params = request.nextUrl.searchParams;
    const search = params.get('search') || '';
    const status = params.get('status') || 'all'; // all | active | inactive
    const ownerClientId = params.get('owner_client_id') || '';
    const page = parseInt(params.get('page') || '1');
    const limit = parseInt(params.get('limit') || '20');
    const offset = (page - 1) * limit;

    const supabaseService = getSupabaseService();

    let query = supabaseService
      .schema('drive')
      .from('coupons')
      .select(
        'id, code, owner_client_id, duration_days, eligibility, stack_with_active, max_redemptions, max_redemptions_per_user, redeemed_count, valid_from, valid_until, is_active, notes, created_at, updated_at',
        { count: 'exact' }
      );

    if (status === 'active') query = query.eq('is_active', true);
    else if (status === 'inactive') query = query.eq('is_active', false);

    // Owner scoping — when the request comes from the per-client coupons tab,
    // restrict the list to that owner. Validated as a UUID so we don't pass
    // arbitrary user input into the query builder.
    if (ownerClientId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerClientId)) {
      query = query.eq('owner_client_id', ownerClientId);
    }

    if (search) {
      const safe = search.replace(/[%,]/g, '');
      query = query.ilike('code', `%${safe}%`);
    }

    const { data: coupons, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Single secondary fetch for owner summaries — only for the page we return.
    const ownerIds = Array.from(
      new Set((coupons || []).map((c: any) => c.owner_client_id).filter(Boolean))
    ) as string[];

    const ownerMap: Record<string, any> = {};
    if (ownerIds.length > 0) {
      const { data: owners, error: ownersErr } = await supabaseService
        .schema('core')
        .from('clients')
        .select('id, name, client_type, avatar_url')
        .in('id', ownerIds);
      if (!ownersErr && owners) {
        for (const o of owners) ownerMap[o.id] = o;
      }
    }

    const enriched = (coupons || []).map((c: any) => ({
      ...c,
      owner: c.owner_client_id ? ownerMap[c.owner_client_id] ?? null : null,
    }));

    return NextResponse.json({
      success: true,
      coupons: enriched,
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    console.error('❌ Error listing coupons:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// POST: create coupon
// ────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const gate = await adminGate();
    if (!gate.ok) return gate.response;

    const body = await request.json();
    const {
      code,
      owner_client_id,
      duration_days,
      eligibility,
      stack_with_active,
      max_redemptions,
      max_redemptions_per_user,
      valid_from,
      valid_until,
      notes,
    } = body as Record<string, any>;

    // Server-side validation — keep messages user-friendly.
    if (typeof code !== 'string' || code.trim().length < 3) {
      return NextResponse.json(
        { error: 'Code must be at least 3 characters' },
        { status: 400 }
      );
    }
    if (!Number.isFinite(duration_days) || duration_days < 1) {
      return NextResponse.json(
        { error: 'duration_days must be a positive integer' },
        { status: 400 }
      );
    }
    if (eligibility !== 'any' && eligibility !== 'new_subscribers_only') {
      return NextResponse.json(
        { error: 'eligibility must be "any" or "new_subscribers_only"' },
        { status: 400 }
      );
    }
    if (
      max_redemptions !== null &&
      max_redemptions !== undefined &&
      (!Number.isFinite(max_redemptions) || max_redemptions < 1)
    ) {
      return NextResponse.json(
        { error: 'max_redemptions must be NULL or a positive integer' },
        { status: 400 }
      );
    }
    if (
      !Number.isFinite(max_redemptions_per_user) ||
      max_redemptions_per_user < 1
    ) {
      return NextResponse.json(
        { error: 'max_redemptions_per_user must be a positive integer' },
        { status: 400 }
      );
    }

    const supabaseService = getSupabaseService();
    const { data, error } = await supabaseService
      .schema('drive')
      .from('coupons')
      .insert([
        {
          code: code.toUpperCase().trim(),
          owner_client_id: owner_client_id || null,
          duration_days,
          eligibility,
          stack_with_active: !!stack_with_active,
          max_redemptions: max_redemptions ?? null,
          max_redemptions_per_user,
          valid_from: valid_from || null,
          valid_until: valid_until || null,
          notes: notes || null,
        },
      ])
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A coupon with this code already exists' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, coupon: data }, { status: 201 });
  } catch (error) {
    console.error('❌ Error creating coupon:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
