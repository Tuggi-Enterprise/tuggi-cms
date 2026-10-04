// Edge Function: places-payment-webhook (#811, épico #802) — PUBLIC
//
// Asaas webhook of the Com história subscription. Contract: `docs/contracts/places-pagamento.md`
// §3.2 (workspace); logic in `_shared/places-payment.ts` `handleAsaasWebhook`.
//
// Authentication: the `asaas-access-token` header, compared in constant time with
// ASAAS_WEBHOOK_TOKEN. Asaas has no HMAC, so the token only filters noise: nothing in the body is
// trusted — every payment and subscription is RE-READ from the Asaas API before the database is
// called, and the database gets the re-read values. Idempotency: the Asaas event `id`
// (`place_payment_events` UNIQUE), recorded in the same transaction as the change.
//
// Deploy with `--no-verify-jwt` (Asaas sends no Supabase JWT). Answers 200 for every business
// outcome; 500 only when the database or the re-read fails, so Asaas resends.
// Never log the body: it carries name, CPF/CNPJ, e-mail and phone.

import { ASAAS_TOKEN_HEADER, handleAsaasWebhook } from '../_shared/places-payment.ts';
import { asaasFromEnv, baseDeps, json } from '../_shared/places-payment-runtime.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const expected = (Deno.env.get('ASAAS_WEBHOOK_TOKEN') ?? '').trim();
  if (!expected) console.error('[places-payment-webhook] ASAAS_WEBHOOK_TOKEN is not set; refusing every call');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_body' });
  }
  const asaas = asaasFromEnv();
  if (!asaas) {
    console.error('[places-payment-webhook] ASAAS_BASE_URL or ASAAS_API_KEY is not set');
    return json(500, { error: 'unavailable' });
  }
  try {
    const r = await handleAsaasWebhook(baseDeps(asaas), expected, req.headers.get(ASAAS_TOKEN_HEADER), body);
    return json(r.status, r.body);
  } catch (e) {
    console.error('[places-payment-webhook] failed', e instanceof Error ? e.message.slice(0, 200) : 'unknown');
    return json(500, { error: 'failed' });
  }
});
