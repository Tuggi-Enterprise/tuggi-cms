/**
 * GET  /api/admin/marketing/campaigns  — lista campanhas de newsletter
 * POST /api/admin/marketing/campaigns  — cria campanha (draft)
 *
 * Admin-only. Mutações em marketing.newsletter_campaigns via service-role
 * (tabela é RLS service-role-only; o adminGate tranca o endpoint a admins).
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSupabaseRouteHandler, getSupabaseService } from '@/lib/core/supabase-client';

async function adminGate(): Promise<{ ok: true; email: string } | { ok: false; response: NextResponse }> {
  const cookieStore = await cookies();
  const supabaseAuth = getSupabaseRouteHandler(cookieStore);
  const { data: { session }, error } = await supabaseAuth.auth.getSession();
  if (error || !session) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const { data: cmsUser } = await supabaseAuth
    .schema('core').from('cms_users')
    .select('id, role, is_active')
    .eq('email', session.user.email as string).eq('is_active', true).single();
  if (!cmsUser || cmsUser.role !== 'admin') {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 }) };
  }
  return { ok: true, email: session.user.email as string };
}

export async function GET() {
  const gate = await adminGate();
  if (!gate.ok) return gate.response;

  const supabase = getSupabaseService();
  const { data, error } = await supabase
    .schema('marketing').from('newsletter_campaigns')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, campaigns: data });
}

export async function POST(request: NextRequest) {
  const gate = await adminGate();
  if (!gate.ok) return gate.response;

  const body = await request.json();
  const { name, default_language = 'pt', content = {}, audience_filters = {} } = body || {};
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const supabase = getSupabaseService();

  // created_by: id do cms_user (best-effort)
  const { data: cmsUser } = await supabase
    .schema('core').from('cms_users').select('id').eq('email', gate.email).single();

  const { data, error } = await supabase
    .schema('marketing').from('newsletter_campaigns')
    .insert({
      name,
      default_language,
      content,
      audience_filters,
      status: 'draft',
      created_by: cmsUser?.id ?? null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, campaign: data });
}
