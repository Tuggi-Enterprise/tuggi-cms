/**
 * GET    /api/admin/marketing/campaigns/[id]  — campanha + métricas agregadas
 * PATCH  /api/admin/marketing/campaigns/[id]  — atualiza (name/content/filters/lang) e cancela
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

/**
 * Métricas da campanha, contadas pelo dado que NÃO volta atrás.
 *
 * `status` é um só campo para um ciclo inteiro e a Resend manda `email.opened` a cada
 * reabertura: quem clicava e reabria voltava a ser `opened`, e o clique sumia. Medido em
 * 2026-09-10: 11 linhas com `status='clicked'` e mais 4 com `click_count > 0` gravadas como
 * `opened` — 27% de clique a menos.
 *
 * Então clique se conta por `click_count`, abertura por `opened_at`, e entrega por
 * `delivered_at` ou `opened_at` (abrir prova entrega). São colunas que só crescem; a ordem dos
 * eventos deixa de importar. O webhook também parou de rebaixar status
 * (`supabase/functions/resend-webhook/index.ts`, `highestStatus`), mas as duas correções são
 * independentes de propósito: esta aqui conserta as 6 campanhas JÁ enviadas, sem retroação.
 */
async function computeStats(
  campaignId: string,
  sentAt: string | null
): Promise<NewsletterCampaignStats> {
  const supabase = getSupabaseService();
  const recip = () => supabase.schema('marketing').from('newsletter_recipients');
  const countWhere = async (build: (q: any) => any) => {
    let q = recip().select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId);
    q = build(q);
    const { count } = await q;
    return count || 0;
  };

  const [total, delivered, opened, clicked, bounced] = await Promise.all([
    countWhere((q) => q),
    countWhere((q) => q.or('delivered_at.not.is.null,opened_at.not.is.null')),
    countWhere((q) => q.not('opened_at', 'is', null)),
    countWhere((q) => q.gt('click_count', 0)),
    countWhere((q) => q.eq('status', 'bounced')),
  ]);

  return {
    total,
    delivered,
    opened,
    clicked,
    bounced,
    unsubscribed: await countUnsubscribed(campaignId, sentAt),
    open_rate: delivered > 0 ? opened / delivered : 0,
  };
}

/**
 * Quantos destinatários desta campanha se descadastraram DEPOIS dela.
 *
 * A lista de descadastros é minúscula (7 linhas em 2026-09-10) e a de destinatários não é, então
 * a leitura começa pela pequena: pega os e-mails descadastrados desde o disparo e conta quantos
 * deles estão nesta campanha. O contrário — varrer os destinatários — cresce com a base.
 *
 * Sem `sent_at` (rascunho, ou agendada) a resposta é zero: não há "depois" de que falar.
 */
async function countUnsubscribed(campaignId: string, sentAt: string | null): Promise<number> {
  if (!sentAt) return 0;
  const supabase = getSupabaseService();

  const { data: unsubs } = await supabase
    .schema('marketing').from('email_unsubscribes')
    .select('email')
    .gte('unsubscribed_at', sentAt);

  const emails = (unsubs ?? []).map((u: { email: string }) => u.email).filter(Boolean);
  if (emails.length === 0) return 0;

  const { count } = await supabase
    .schema('marketing').from('newsletter_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .in('email', emails);

  return count || 0;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await adminGate();
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const supabase = getSupabaseService();
  const { data: campaign, error } = await supabase
    .schema('marketing').from('newsletter_campaigns').select('*').eq('id', id).single();
  if (error || !campaign) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const stats = await computeStats(id, campaign.sent_at ?? null);
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

  // `status` fica fora de `allowed` de propósito: o ciclo da campanha é do servidor, não do
  // corpo da requisição. A única transição que o operador dirige é cancelar o que ainda não
  // saiu — e ela precisa existir, porque o agendamento é a única janela de undo do módulo.
  //
  // Até 2026-09-10 `status` era descartado em silêncio aqui e a rota respondia 200: a tela
  // "cancelava" e a campanha continuava agendada. Recusar alto é o ponto.
  if ('status' in body) {
    if (body.status !== 'cancelled') {
      return NextResponse.json(
        { error: `Status '${body.status}' não é atribuível pela API; só 'cancelled'.` },
        { status: 422 },
      );
    }
    const { data: current, error: readError } = await supabase
      .schema('marketing').from('newsletter_campaigns')
      .select('status').eq('id', id).single();
    if (readError || !current) {
      return NextResponse.json({ error: readError?.message ?? 'Campanha não encontrada' }, { status: 404 });
    }
    // `sending` fica de fora: a Edge Function já está no laço e o lote em voo não volta.
    if (current.status !== 'draft' && current.status !== 'scheduled') {
      return NextResponse.json(
        { error: `Campanha em '${current.status}' não pode ser cancelada.` },
        { status: 409 },
      );
    }
    updates.status = 'cancelled';
  }
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
