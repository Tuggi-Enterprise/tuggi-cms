// Edge Function: places-payout (#903, BR-B2B-044 item 6, term 5.4)
//
// The money-out half of the 10 % payout. Logic in `_shared/places-payout.ts`; contract
// `docs/contracts/places-pagamento.md` §3.5 (workspace).
//
// Caller: the CMS's Next server only, with its own secret key (`requireAdmin` machine bypass).
// The admin gate (B1: only an admin releases) and the "amount shown = amount on the server"
// check live in the CMS route `POST /api/finance/payouts/{id}/release`, which is the only door.
//
// Body:
//   {"action": "release", "payout_id": uuid, "released_by": core.cms_users.id}
//     → 200 {result: 'sent'|'unchanged'} · 404 · 409 {error: 'not_releasable', reason} · 502 · 500
//   {"action": "period_closed", "period_month": "YYYY-MM-01"}
//     → 200 {sent, failed}: the zero / negative month e-mails (the CMS calls it once per month).
//
// Deploy with `--no-verify-jwt` (the CMS's secret key is not a JWT; `requireAdmin` checks it).
// Never log a body or a Pix key: ids and outcomes only.

import { requireAdmin } from '../_shared/auth-middleware.ts';
import { notifyClosedPeriod, parsePeriod, parseRelease, releasePayout } from '../_shared/places-payout.ts';
import { payoutDeps } from '../_shared/places-payout-runtime.ts';
import { asaasFromEnv, json } from '../_shared/places-payment-runtime.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;

  const body = await req.json().catch(() => null);
  const action = (body as Record<string, unknown> | null)?.action;
  const asaas = asaasFromEnv();
  if (!asaas) {
    console.error('[places-payout] ASAAS_BASE_URL or ASAAS_API_KEY is not set');
    return json(503, { error: 'unavailable' });
  }
  try {
    if (action === 'release') {
      const input = parseRelease(body);
      if (!input) return json(400, { error: 'invalid_body' });
      const r = await releasePayout(payoutDeps(asaas), input);
      console.log('[places-payout] release', input.payoutId, r.status, String(r.body.result ?? r.body.error ?? ''));
      return json(r.status, r.body);
    }
    if (action === 'period_closed') {
      const period = parsePeriod(body);
      if (!period) return json(400, { error: 'invalid_body' });
      const r = await notifyClosedPeriod(payoutDeps(asaas), period);
      console.log('[places-payout] period_closed', period, JSON.stringify(r));
      return json(200, r);
    }
    return json(400, { error: 'invalid_body' });
  } catch (e) {
    console.error('[places-payout] failed', e instanceof Error ? e.message.slice(0, 200) : 'unknown');
    return json(500, { error: 'failed' });
  }
});
