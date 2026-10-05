// Edge Function: places-payment (#811, épico #802)
//
// The owner's payment actions of the Portal Locais. Contract: `docs/contracts/places-pagamento.md`
// (workspace); logic in `_shared/places-payment.ts`.
//
// Called server-to-server by the portal's Worker with `x-places-secret` AND the user's access
// token in `Authorization: Bearer`. The secret says "it is the portal"; the token says "it is the
// owner" — the database proves it in `core.portal_*` (demand 4 of the security review). Deploy
// with `--no-verify-jwt`, like the other `places-*`: the token is checked by the database call.
//
// Body: { action: 'checkout' | 'checkout_pix' | 'cancel_renewal' | 'refund' | 'withdraw', submission_id, ... }.
// The card goes to Asaas in the same request and is never stored, logged or echoed. `checkout_pix`
// answers { result: 'pix', pix: { payload, image, expires_at } }: the QR of the first charge.

import { isPlacesSecret, PLACES_SECRET_HEADER } from '../_shared/places-secret.ts';
import { cancelRenewal, checkout, checkoutPix, requestRefund, withdraw, type PortalDeps } from '../_shared/places-payment.ts';
import { asaasFromEnv, baseDeps, json, userDeps } from '../_shared/places-payment-runtime.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!isPlacesSecret(req.headers.get(PLACES_SECRET_HEADER))) return json(401, { error: 'unauthorized' });
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json(401, { error: 'relogin' });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: 'invalid_body' });
  }

  const asaas = asaasFromEnv();
  if (!asaas) {
    console.error('[places-payment] ASAAS_BASE_URL or ASAAS_API_KEY is not set');
    return json(503, { error: 'unavailable' });
  }
  const deps: PortalDeps = { ...baseDeps(asaas), ...userDeps(jwt) };
  const submissionId = typeof body.submission_id === 'string' ? body.submission_id : '';

  try {
    const r =
      body.action === 'checkout'
        ? await checkout(deps, body)
        : body.action === 'checkout_pix'
          ? await checkoutPix(deps, body)
        : body.action === 'cancel_renewal'
          ? await cancelRenewal(deps, submissionId)
          : body.action === 'refund'
            ? await requestRefund(deps, submissionId)
            : body.action === 'withdraw'
              ? await withdraw(deps, submissionId)
              : { status: 400, body: { error: 'invalid', field: 'action' } };
    console.log('[places-payment]', String(body.action).slice(0, 20), r.status);
    return json(r.status, r.body);
  } catch (e) {
    console.error('[places-payment] failed', e instanceof Error ? e.message.slice(0, 200) : 'unknown');
    return json(502, { error: 'unavailable' });
  }
});
