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
// The status ladder and the bounce classifier are SHARED, and pure, so that they can be
// executed by a test instead of only read by one — see `_shared/newsletter-metrics.ts`.
import { highestStatus, isPermanentBounce } from '../_shared/newsletter-metrics.ts';

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

    // NO SECRET, NO WEBHOOK. This used to log a warning and process the event anyway, which was
    // survivable while a bounce only wrote `status` on a row we had already sent. It stopped
    // being survivable the moment this handler began writing CONSENT: the function is deployed
    // `--no-verify-jwt`, so an unverified POST is an anonymous POST, and an anonymous POST that
    // reaches the suppression branch unsubscribes somebody.
    //
    // 500 and not 401: a missing secret is our misconfiguration, not the caller's fault, and 5xx
    // is what makes Svix retry — so a real event survives until the secret is put back.
    if (!secret) {
      console.error(`[${requestId}] 🚨 RESEND_WEBHOOK_SECRET ausente — recusando o evento`);
      return new Response('Webhook secret not configured', { status: 500, headers: corsHeaders });
    }

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

    const event = JSON.parse(rawBody);
    const type: string = event?.type || '';
    const messageId: string | undefined = event?.data?.email_id;
    const now = new Date().toISOString();

    if (!messageId) {
      console.warn(`[${requestId}] ⚠️ evento sem email_id: ${type}`);
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createAdminClient();
    const table = supabase.schema('marketing').from('newsletter_recipients');

    // Every branch reads the row first, because the new status is a FUNCTION of the old one
    // (`highestStatus`) and no longer an assignment. The row is also what carries `open_count`
    // and `click_count`, which is why the two engagement branches already read it.
    // `email` is selected so suppression can use the address ON THE ROW instead of the one in
    // the payload. Both are the same address on a genuine event; they differ only on a forged
    // one, and then the row is the honest half — it is the address WE mailed, matched by a
    // `resend_message_id` we issued.
    const { data: rec } = await table
      .select('id, email, status, open_count, click_count, opened_at')
      .eq('resend_message_id', messageId)
      .maybeSingle();

    if (!rec) {
      // A message we did not send, or a row deleted with its campaign. 2xx on purpose: Svix
      // retries anything else, and there is nothing here a retry would fix.
      console.warn(`[${requestId}] ⚠️ ${type} for an unknown resend_message_id`);
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    /**
     * Writes the row, letting the ladder decide the status.
     *
     * `optional` carries columns that DO NOT EXIST YET: `bounce_type`, `bounce_subtype` and
     * `failed_at` arrive with `20260910_03_newsletter_recipient_bounce_type.sql`, which is the
     * `data` agent's and runs by hand in the panel. PostgREST refuses the WHOLE update with
     * PGRST204 when one column is unknown, so without this the merge would stop recording
     * bounces entirely until the migration lands — trading a defect for a worse one.
     */
    const patch = async (
      incoming: string,
      extra: Record<string, unknown> = {},
      optional: Record<string, unknown> = {}
    ) => {
      const status = highestStatus(rec.status, incoming);
      const { error } = await table.update({ status, ...extra, ...optional }).eq('id', rec.id);
      if (error?.code === 'PGRST204' && Object.keys(optional).length > 0) {
        console.error(
          `[${requestId}] 🚨 newsletter_recipients is missing ${Object.keys(optional).join('/')} — ` +
          'the migration has not run. Writing without them.'
        );
        await table.update({ status, ...extra }).eq('id', rec.id);
      } else if (error) {
        console.error(`[${requestId}] 💥 recipient update failed:`, JSON.stringify(error));
      }
    };

    if (type === 'email.delivered') {
      await patch('delivered', { delivered_at: now });
    } else if (type === 'email.opened') {
      // `open_count` and `click_count` are the counters that never go backwards — `computeStats`
      // reads THEM and not the status, exactly because of the demotion above.
      await patch('opened', {
        opened_at: rec.opened_at || now,
        open_count: (rec.open_count || 0) + 1,
      });
    } else if (type === 'email.clicked') {
      await patch('clicked', { click_count: (rec.click_count || 0) + 1 });
    } else if (type === 'email.bounced') {
      const bounce = event?.data?.bounce;
      const permanent = isPermanentBounce(bounce);
      const detail =
        `bounce ${bounce?.type ?? 'unknown'}/${bounce?.subType ?? 'unknown'}` +
        (bounce?.message ? `: ${String(bounce.message).slice(0, 400)}` : '');

      // `bounce_type` is OUR vocabulary — `hard`/`soft`, the CHECK in
      // `20260910_03_newsletter_recipient_bounce_type.sql` — while `bounce_subtype` keeps
      // Resend's own word (`Suppressed`, `MailboxFull`, …) so the provider's classification is
      // not lost in the translation. The 83 rows already in the table can never be classified:
      // the field was read and thrown away, and no UPDATE recovers what was never written.
      await patch(
        'bounced',
        { error_details: detail },
        {
          bounce_type: permanent ? 'hard' : 'soft',
          bounce_subtype: bounce?.subType ?? null,
          failed_at: now,
        }
      );

      if (permanent) {
        // HARD BOUNCE IS SUPPRESSION, and this is the fix for the measured defect: 83 bounces
        // across 67 distinct addresses, `email_unsubscribes` with `source='bounce'` at ZERO, and
        // 54 of those addresses mailed AGAIN in a later campaign, because
        // `marketing.get_newsletter_audience` filters on `email_unsubscribes` alone.
        //
        // The cost is not the wasted send. Accumulated bounces sink the sender reputation, and
        // the first mail to stop arriving when reputation drops is the TRANSACTIONAL one —
        // account confirmation and password recovery, same domain. That blocks account creation,
        // which is the top of the whole funnel.
        //
        // Suppression writes `rec.email`, never `event.data.to`: the blast radius of a forged
        // event is then one address we actually mailed, not any address the payload names.
        const { error: unsubErr } = await supabase.schema('marketing').from('email_unsubscribes')
          .upsert(
            { email: rec.email.toLowerCase().trim(), source: 'bounce' },
            { onConflict: 'email', ignoreDuplicates: true }
          );
        if (unsubErr) {
          console.error(`[${requestId}] 💥 bounce suppression failed:`, JSON.stringify(unsubErr));
        }
        console.log(`[${requestId}] 🚫 permanent bounce suppressed 1 address`);
      } else {
        // Soft bounce: recorded, NOT suppressed. Resend itself says it "may be delivered in the
        // future".
        console.log(`[${requestId}] ↩️ transient bounce (${bounce?.type ?? 'unknown'}) — not suppressed`);
      }
    } else if (type === 'email.complained') {
      await patch('complained');
      // Opt-out (SSOT) for the address ON THE ROW, same reason as the bounce branch above.
      // `ignoreDuplicates` so a second complaint does not overwrite the `source` of somebody who
      // had already unsubscribed through the footer link — the first reason is the true one.
      await supabase.schema('marketing').from('email_unsubscribes')
        .upsert(
          { email: rec.email.toLowerCase().trim(), source: 'complaint' },
          { onConflict: 'email', ignoreDuplicates: true }
        );
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
