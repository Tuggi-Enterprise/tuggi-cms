/**
 * GET    /api/admin/marketing/campaigns/[id]  — campanha + métricas agregadas
 * PATCH  /api/admin/marketing/campaigns/[id]  — atualiza (name/content/filters/lang)
 * DELETE /api/admin/marketing/campaigns/[id]
 *
 * Admin-only, service-role (mesmo padrão de coupons).
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSupabaseRouteHandler, getSupabaseService } from '@/lib/core/supabase-client';
import type { NewsletterCampaignStats } from '@/types/newsletter';

async function adminGate(): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const cookieStore = await cookies();
  const supabaseAuth = getSupabaseRouteHandler(cookieStore);
  const { data: { session }, error } = await supabaseAuth.auth.getSession();
  if (error || !session) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const { data: cmsUser } = await supabaseAuth
    .schema('core').from('cms_users')
    .select('role, is_active')
    .eq('email', session.user.email as string).eq('is_active', true).single();
  if (!cmsUser || cmsUser.role !== 'admin') {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 }) };
  }
  return { ok: true };
}

async function computeStats(campaignId: string): Promise<NewsletterCampaignStats> {
  const supabase = getSupabaseService();
  const recip = supabase.schema('marketing').from('newsletter_recipients');
  const countWhere = async (build: (q: any) => any) => {
    let q = recip.select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId);
    q = build(q);
    const { count } = await q;
    return count || 0;
  };

  const [total, delivered, opened, clicked, bounced] = await Promise.all([
    countWhere((q) => q),
    countWhere((q) => q.in('status', ['delivered', 'opened', 'clicked'])),
    countWhere((q) => q.in('status', ['opened', 'clicked'])),
    countWhere((q) => q.eq('status', 'clicked')),
    countWhere((q) => q.eq('status', 'bounced')),
  ]);

  return {
    total,
    delivered,
    opened,
    clicked,
    bounced,
    open_rate: delivered > 0 ? opened / delivered : 0,
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await adminGate();
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const supabase = getSupabaseService();
  const { data: campaign, error } = await supabase
    .schema('marketing').from('newsletter_campaigns').select('*').eq('id', id).single();
  if (error || !campaign) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const stats = await computeStats(id);
  return NextResponse.json({ success: true, campaign, stats });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await adminGate();
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const body = await request.json();
  const allowed = ['name', 'default_language', 'content', 'audience_filters'] as const;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) if (key in body) updates[key] = body[key];

  const supabase = getSupabaseService();
  const { data, error } = await supabase
    .schema('marketing').from('newsletter_campaigns')
    .update(updates).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, campaign: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await adminGate();
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const supabase = getSupabaseService();
  const { error } = await supabase.schema('marketing').from('newsletter_campaigns').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
