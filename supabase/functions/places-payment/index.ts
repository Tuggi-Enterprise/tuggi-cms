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
// #863 (§7.2 of `places-portal-rascunho.md`): the cookie's checkout, before any account exists.
// `x-places-draft-secret` (`PLACES_DRAFT_SECRET`, the Worker's secret of the anonymous draft,
// constant time) + `token_sha256` of the draft cookie, no JWT; only `checkout` and `checkout_pix`.
// The submission comes from `portal_draft_payment_checkout`, never from the body.
//
// Body: { action: 'checkout' | 'checkout_pix' | 'cancel_quote' | 'cancel_renewal' | 'refund' | 'withdraw' | 'confirm_pix_key', submission_id, ... }.
// `confirm_pix_key` (#904): the owner confirms the payout Pix key (the contract's CNPJ) + anti-fraud e-mail.
// `cancel_renewal` takes an optional `expected_fee_cents` (the quote the owner saw; 409 `quote_changed` if it moved).
// `cancel_renewal` also takes an optional `feedback` { reason, comment, contact_consent, contact_consent_text }
// (#913, BR-B2B-060): sanitized, recorded after the cancel; never changes the cancel's answer.
// The card goes to Asaas in the same request and is never stored, logged or echoed. `checkout` and
// `checkout_pix` in the free month (#898) charge nothing and answer
// { result: 'scheduled', first_charge_on: 'YYYY-MM-DD' } — the database's `next_due_date`; an
// acceptance with no trial answers { result: 'paid' | 'processing' }.

import { isPlacesSecret, PLACES_SECRET_HEADER } from '../_shared/places-secret.ts';
import { isDraftSecret } from '../_shared/places-draft-secret.ts';
import { DRAFT_SECRET_HEADER } from '../_shared/places-portal-draft.ts';
import { cancelQuote, cancelRenewal, checkout, confirmPixKey, checkoutPix, draftCheckout, draftCheckoutPix, requestRefund, withdraw, type PortalDeps } from '../_shared/places-payment.ts';
import { asaasFromEnv, baseDeps, json, userDeps } from '../_shared/places-payment-runtime.ts';

/** The cookie's checkout (#863). The secret is checked before the body is read. */
async function draftPayment(req: Request): Promise<Response> {
  if (!isDraftSecret(req.headers.get(DRAFT_SECRET_HEADER), 'places-payment')) return json(401, { error: 'unauthorized' });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: 'invalid_body' });
  }
  if (body.action !== 'checkout' && body.action !== 'checkout_pix') return json(400, { error: 'invalid', field: 'action' });
  const token = typeof body.token_sha256 === 'string' ? body.token_sha256 : '';
  const asaas = asaasFromEnv();
  if (!asaas) {
    console.error('[places-payment] ASAAS_BASE_URL or ASAAS_API_KEY is not set');
    return json(503, { error: 'unavailable' });
  }
  try {
    const deps = baseDeps(asaas);
    const r = body.action === 'checkout' ? await draftCheckout(deps, body, token) : await draftCheckoutPix(deps, token);
    console.log('[places-payment] draft', String(body.action), r.status);
    return json(r.status, r.body);
  } catch (e) {
    console.error('[places-payment] draft failed', e instanceof Error ? e.message.slice(0, 200) : 'unknown');
    return json(502, { error: 'unavailable' });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (req.headers.has(DRAFT_SECRET_HEADER)) return draftPayment(req);
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
        : body.action === 'cancel_quote'
          ? await cancelQuote(deps, submissionId)
        : body.action === 'cancel_renewal'
          ? await cancelRenewal(deps, submissionId, body.expected_fee_cents, body.feedback)
          : body.action === 'refund'
            ? await requestRefund(deps, submissionId)
            : body.action === 'withdraw'
              ? await withdraw(deps, submissionId)
            : body.action === 'confirm_pix_key'
              ? await confirmPixKey(deps, submissionId)
              : { status: 400, body: { error: 'invalid', field: 'action' } };
    console.log('[places-payment]', String(body.action).slice(0, 20), r.status);
    return json(r.status, r.body);
  } catch (e) {
    console.error('[places-payment] failed', e instanceof Error ? e.message.slice(0, 200) : 'unknown');
    return json(502, { error: 'unavailable' });
  }
});
