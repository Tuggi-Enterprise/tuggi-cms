// Edge Function: resend-webhook (público)
//
// Recebe eventos da Resend e atualiza marketing.newsletter_recipients por
// resend_message_id, alimentando as métricas (entregue / aberto / clicado /
// bounce / spam). Em 'complained' também registra opt-out.
//
// Verificação de assinatura Svix (padrão da Resend) via RESEND_WEBHOOK_SECRET.
//
// ⚠️ Esta função deve ser deployada com --no-verify-jwt (é chamada pela Resend,
//    não por um usuário autenticado).

import { createAdminClient } from '../_shared/supabase-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, svix-id, svix-timestamp, svix-signature',
};

const base64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

// Verificação Svix: HMAC-SHA256 sobre `${id}.${timestamp}.${body}`.
async function verifySvix(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  body: string
): Promise<boolean> {
  if (!secret || !svixId || !svixTimestamp || !svixSignature) return false;
  const secretBytes = base64ToBytes(secret.replace(/^whsec_/, ''));
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = `${svixId}.${svixTimestamp}.${body}`;
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
  const expected = bytesToBase64(new Uint8Array(sig));
  // O header pode conter várias assinaturas separadas por espaço: "v1,<sig> v1,<sig2>"
  return svixSignature
    .split(' ')
    .map((p) => p.split(',')[1])
    .some((s) => s === expected);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const requestId = crypto.randomUUID();

  try {
    const secret = (Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '').trim();
    const rawBody = await req.text();

    if (secret) {
      const ok = await verifySvix(
        secret,
        req.headers.get('svix-id') || '',
        req.headers.get('svix-timestamp') || '',
        req.headers.get('svix-signature') || '',
        rawBody
      );
      if (!ok) {
        console.warn(`[${requestId}] ❌ Assinatura Svix inválida`);
        return new Response('Invalid signature', { status: 401, headers: corsHeaders });
      }
    } else {
      console.warn(`[${requestId}] ⚠️ RESEND_WEBHOOK_SECRET ausente — pulando verificação`);
    }

    const event = JSON.parse(rawBody);
    const type: string = event?.type || '';
    const messageId: string | undefined = event?.data?.email_id;
    const toList: string[] = Array.isArray(event?.data?.to) ? event.data.to : event?.data?.to ? [event.data.to] : [];
    const now = new Date().toISOString();

    if (!messageId) {
      console.warn(`[${requestId}] ⚠️ evento sem email_id: ${type}`);
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createAdminClient();
    const table = supabase.schema('marketing').from('newsletter_recipients');

    if (type === 'email.delivered') {
      await table.update({ status: 'delivered', delivered_at: now }).eq('resend_message_id', messageId);
    } else if (type === 'email.opened') {
      // Marca aberto + incrementa open_count via RPC seria ideal; KISS: lê e soma.
      const { data: rec } = await table.select('id, open_count, opened_at').eq('resend_message_id', messageId).maybeSingle();
      if (rec) {
        await table.update({
          status: 'opened',
          opened_at: rec.opened_at || now,
          open_count: (rec.open_count || 0) + 1,
        }).eq('id', rec.id);
      }
    } else if (type === 'email.clicked') {
      const { data: rec } = await table.select('id, click_count').eq('resend_message_id', messageId).maybeSingle();
      if (rec) {
        await table.update({ status: 'clicked', click_count: (rec.click_count || 0) + 1 }).eq('id', rec.id);
      }
    } else if (type === 'email.bounced') {
      await table.update({ status: 'bounced' }).eq('resend_message_id', messageId);
    } else if (type === 'email.complained') {
      await table.update({ status: 'complained' }).eq('resend_message_id', messageId);
      // Registra opt-out (SSOT) para cada email do evento.
      for (const email of toList) {
        await supabase.schema('marketing').from('email_unsubscribes')
          .upsert({ email: email.toLowerCase().trim(), source: 'complaint' }, { onConflict: 'email' });
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error(`[${requestId}] 💥 webhook error:`, err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
