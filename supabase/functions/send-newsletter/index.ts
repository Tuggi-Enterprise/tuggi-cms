// Edge Function: send-newsletter
//
// Envia campanhas de newsletter via Resend, traduzidas por idioma do usuário,
// respeitando opt-out. Espelha o padrão da firebase-push-notification
// (router por path, CORS, admin client, logging por requestId).
//
// Rotas:
//   POST /send              { campaignId }  -> envia agora
//   POST /schedule          { campaignId, scheduledFor } -> agenda
//   POST /process-scheduled                 -> processa agendadas vencidas (cron)
//   POST /preview           { content, language } -> HTML renderizado (para o painel)
//   GET  /health
//
// Secrets: RESEND_API_KEY, RESEND_FROM, APP_URL, NEWSLETTER_SECRET
//   (+ TUGGI_SECRET_KEY / SUPABASE_URL já usados pelo _shared/supabase-client)

import { createAdminClient } from '../_shared/supabase-client.ts';
import { renderEmail, NewsletterContent } from '../_shared/emailLayout.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RESEND_BATCH_URL = 'https://api.resend.com/emails/batch';
const BATCH_SIZE = 100; // limite da Resend por chamada /emails/batch

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const toBase64Url = (bytes: Uint8Array): string => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};

const encodeEmail = (email: string): string =>
  toBase64Url(new TextEncoder().encode(email.toLowerCase().trim()));

// Assinatura HMAC-SHA256 do email (stateless): permite descadastro sem
// pré-popular linhas no banco e impede unsubscribe de emails arbitrários.
async function signEmail(email: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(email.toLowerCase().trim()));
  return toBase64Url(new Uint8Array(sig));
}

// O unsubscribe é hospedado no site público (tuggi.app), cujos locales são
// en/es/pt-br/pt-pt. Mapeamos o idioma do conteúdo (pt/en/es) para o locale do site.
const SITE_LOCALE: Record<string, string> = { pt: 'pt-br', en: 'en', es: 'es' };

async function buildUnsubscribeUrl(email: string, appUrl: string, secret: string, lang: string): Promise<string> {
  const e = encodeEmail(email);
  const s = await signEmail(email, secret);
  const base = appUrl.replace(/\/$/, '');
  const siteLocale = SITE_LOCALE[lang] || 'en';
  return `${base}/${siteLocale}/unsubscribe?e=${e}&s=${s}`;
}

// Escolhe o conteúdo do idioma do usuário com fallback para o idioma padrão.
function pickContent(
  content: Record<string, NewsletterContent>,
  userLang: string | null,
  defaultLang: string
): { content: NewsletterContent; lang: string } {
  const norm = (userLang || '').slice(0, 2).toLowerCase();
  if (norm && content[norm]) return { content: content[norm], lang: norm };
  if (content[defaultLang]) return { content: content[defaultLang], lang: defaultLang };
  const first = Object.keys(content)[0];
  return { content: content[first] || {}, lang: first || defaultLang };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const requestId = crypto.randomUUID();
  console.log(`[${requestId}] 🚀 send-newsletter: ${req.method} ${req.url}`);

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/.*\/send-newsletter/, '') || '/';

    const RESEND_API_KEY = (Deno.env.get('RESEND_API_KEY') ?? '').trim();
    const RESEND_FROM = (Deno.env.get('RESEND_FROM') ?? 'Tuggi <news@tuggi.app>').trim();
    // URL pública que hospeda a página de unsubscribe (site tuggi.app, não o CMS).
    const APP_URL = (Deno.env.get('APP_URL') ?? 'https://www.tuggi.app').trim();
    const NEWSLETTER_SECRET = (Deno.env.get('NEWSLETTER_SECRET') ?? '').trim();

    const supabase = createAdminClient();

    // ---- /preview : renderiza sem enviar (usado pelo painel) ----
    if (path === '/preview') {
      const { content, language = 'pt' } = await req.json();
      const html = renderEmail(content || {}, {
        unsubscribeUrl: `${APP_URL.replace(/\/$/, '')}/${language}/unsubscribe?e=preview&s=preview`,
        locale: language,
      });
      return json({ success: true, html });
    }

    // ---- /send-test : envia 1 email para um endereço específico (ignora audiência) ----
    if (path === '/send-test') {
      if (!RESEND_API_KEY) return json({ error: 'RESEND_API_KEY ausente' }, 500);
      const { content, email, language = 'pt' } = await req.json();
      if (!email || !content) return json({ error: 'email and content required' }, 400);

      const unsubscribeUrl = await buildUnsubscribeUrl(email, APP_URL, NEWSLETTER_SECRET, language);
      const html = renderEmail(content, { unsubscribeUrl, locale: language });

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: [email],
          subject: `[TESTE] ${content.subject || 'Tuggi'}`,
          html,
          headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` },
        }),
      });
      const data = await res.json();
      if (!res.ok) return json({ error: data?.message || 'Resend error', detail: data }, 502);
      return json({ success: true, id: data?.id });
    }

    if (path === '/health') return json({ status: 'ok' });

    // Helper: envia uma campanha já carregada.
    const sendCampaign = async (campaign: any) => {
      if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY ausente');

      const content = (campaign.content || {}) as Record<string, NewsletterContent>;
      const defaultLang = campaign.default_language || 'pt';

      // 1. Resolve audiência (RPC já filtra opt-out e exige email não-nulo)
      const { data: audience, error: audErr } = await supabase
        .schema('marketing')
        .rpc('get_newsletter_audience', { p_filters: campaign.audience_filters || {} });
      if (audErr) throw audErr;

      const recipients: Array<{ email: string; user_id: string | null; language: string | null }> =
        audience || [];

      if (recipients.length === 0) {
        await supabase.schema('marketing').from('newsletter_campaigns')
          .update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', campaign.id);
        return { sent: 0, failed: 0 };
      }

      let sent = 0;
      let failed = 0;

      for (const group of chunk(recipients, BATCH_SIZE)) {
        // Monta o payload do lote + linhas de recipients (uma a uma p/ casar o resend id)
        const emails: any[] = [];
        const rows: any[] = [];

        for (const r of group) {
          const { content: c, lang } = pickContent(content, r.language, defaultLang);
          const unsubscribeUrl = await buildUnsubscribeUrl(r.email, APP_URL, NEWSLETTER_SECRET, lang);
          const html = renderEmail(c, { unsubscribeUrl, locale: lang });

          emails.push({
            from: RESEND_FROM,
            to: [r.email],
            subject: c.subject || campaign.name,
            html,
            headers: {
              // URL https → provedores abrem via GET (RFC 2369). A página
              // /unsubscribe trata o clique e grava o opt-out.
              'List-Unsubscribe': `<${unsubscribeUrl}>`,
            },
          });
          rows.push({
            campaign_id: campaign.id,
            email: r.email,
            user_id: r.user_id,
            language: lang,
          });
        }

        try {
          const res = await fetch(RESEND_BATCH_URL, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(emails),
          });
          const data = await res.json();

          if (!res.ok) {
            console.error(`[${requestId}] ❌ Resend batch failed:`, JSON.stringify(data));
            failed += rows.length;
            await supabase.schema('marketing').from('newsletter_recipients').insert(
              rows.map((row) => ({ ...row, status: 'failed', error_details: data?.message || 'batch error' }))
            );
            continue;
          }

          // Resend retorna { data: [{ id }, ...] } na mesma ordem
          const ids: Array<{ id: string }> = data?.data || [];
          const now = new Date().toISOString();
          await supabase.schema('marketing').from('newsletter_recipients').insert(
            rows.map((row, i) => ({
              ...row,
              resend_message_id: ids[i]?.id || null,
              status: 'sent',
              sent_at: now,
            }))
          );
          sent += rows.length;
        } catch (e) {
          console.error(`[${requestId}] 💥 batch exception:`, (e as Error).message);
          failed += rows.length;
          await supabase.schema('marketing').from('newsletter_recipients').insert(
            rows.map((row) => ({ ...row, status: 'failed', error_details: (e as Error).message }))
          );
        }
      }

      await supabase.schema('marketing').from('newsletter_campaigns')
        .update({
          status: failed > 0 && sent === 0 ? 'failed' : 'sent',
          sent_at: new Date().toISOString(),
        })
        .eq('id', campaign.id);

      return { sent, failed };
    };

    // ---- /send ----
    if (path === '/send') {
      const { campaignId } = await req.json();
      if (!campaignId) return json({ error: 'campaignId required' }, 400);

      const { data: campaign, error } = await supabase
        .schema('marketing').from('newsletter_campaigns').select('*').eq('id', campaignId).single();
      if (error || !campaign) return json({ error: 'campaign not found' }, 404);

      await supabase.schema('marketing').from('newsletter_campaigns')
        .update({ status: 'sending' }).eq('id', campaignId);

      const result = await sendCampaign(campaign);
      return json({ success: true, ...result });
    }

    // ---- /schedule ----
    if (path === '/schedule') {
      const { campaignId, scheduledFor } = await req.json();
      if (!campaignId || !scheduledFor) return json({ error: 'campaignId and scheduledFor required' }, 400);

      const { error } = await supabase.schema('marketing').from('newsletter_campaigns')
        .update({ status: 'scheduled', scheduled_for: scheduledFor }).eq('id', campaignId);
      if (error) throw error;
      return json({ success: true });
    }

    // ---- /process-scheduled (cron) ----
    if (path === '/process-scheduled') {
      const { data: due, error } = await supabase
        .schema('marketing').from('newsletter_campaigns')
        .select('*')
        .eq('status', 'scheduled')
        .lte('scheduled_for', new Date().toISOString())
        .limit(5);
      if (error) throw error;

      const results = [];
      for (const campaign of due || []) {
        await supabase.schema('marketing').from('newsletter_campaigns')
          .update({ status: 'sending' }).eq('id', campaign.id);
        try {
          const r = await sendCampaign(campaign);
          results.push({ id: campaign.id, ...r });
        } catch (e) {
          console.error(`[${requestId}] ⚠️ campaign ${campaign.id} failed:`, (e as Error).message);
          await supabase.schema('marketing').from('newsletter_campaigns')
            .update({ status: 'failed' }).eq('id', campaign.id);
          results.push({ id: campaign.id, error: (e as Error).message });
        }
      }
      return json({ success: true, processed: results.length, results });
    }

    return json({ error: 'Not found' }, 404);
  } catch (err: any) {
    console.error(`[${requestId}] 💥 Fatal:`, err);
    return json({ error: 'Internal Server Error', message: err.message, requestId }, 500);
  }
});
