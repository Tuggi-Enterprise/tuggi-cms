// Edge Function: places-payment-sweep (#811, épico #802)
//
// The daily payment job of the Com história plan: unfinished refunds, expirations, and the
// alignment of each Asaas subscription with the renewal date and value of the database.
// Contract: `docs/contracts/places-pagamento.md` §3.3 (workspace); logic in
// `_shared/places-payment.ts` `runSweep`. Idempotent: running it twice a day changes nothing the
// first run did not.
//
// Since #813 it also sends the portal's transition e-mails (`runTransitionEmails`,
// `_shared/places-transition-email.ts`): published place → `live` + "no ar" e-mail, and the one kit
// reminder. That part does not need Asaas and runs even when the payment part cannot.
//
// Since #889 it also takes the paid description off when the payment ends, and puts it back when
// the partner pays again (`reconcilePartnerStories`, `_shared/places-story-suspension.ts`,
// BR-B2B-019). Database only — it runs even when Asaas is not configured.
//
// Since #901 `runSweep` also backfills the subscriptions' invoice settings and re-reads the invoices
// into `partner.place_invoices` (`reconcileInvoices`, `_shared/places-invoice.ts`).
//
// Since #903 it re-reads the transfer of every `sent` payout (`reconcileSentPayouts`, inside
// `runSweep`) and asks the CMS to close the month before (`triggerPayoutClose`): the payout
// calculation lives in the CMS (`lib/finance/payouts.ts`), so the job calls the CMS route
// `POST /api/finance/payouts/close` with CMS_JOB_SECRET; the route closes only a month never
// calculated, so the daily call repairs a failed day 1 and is a no-op otherwise. Secrets:
// CMS_ORIGIN (e.g. `https://cms.tuggi.app`) and CMS_JOB_SECRET (the same value on the CMS); unset =
// skipped, and the pending item `payout_period_not_calculated` is the net.
//
// Since #923, body `{"payment_links": true}` runs ONLY `backfillPaymentLinks`: the operator's load of
// the payments Asaas already issued (their link to pay, `partner.record_place_payment_link`). Safe to
// rerun: an upsert by `pay_` with the re-read payment. The cron sends no body and runs the rest.
// That mode answers 403 to anyone but the machine (`service_role`), CMS admins included.
//
// Caller: a pg_cron job with the project's secret key (`requireAdmin`, machine bypass), the same
// pattern as `daily-gamification-orchestrator`. Deploy with `--no-verify-jwt`.

import { requireAdmin } from '../_shared/auth-middleware.ts';
import { runPaymentLinksLoad, runSweep } from '../_shared/places-payment.ts';
import { asaasFromEnv, baseDeps, json } from '../_shared/places-payment-runtime.ts';
import { runTransitionEmails } from '../_shared/places-transition-email.ts';
import { transitionDeps } from '../_shared/places-transition-email-runtime.ts';
import { reconcilePartnerStories } from '../_shared/places-story-suspension.ts';
import { suspensionDeps } from '../_shared/places-story-suspension-runtime.ts';
import { triggerPayoutClose } from '../_shared/places-payout.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;

  const body = await req.json().catch(() => null);
  if (body && typeof body === 'object' && (body as Record<string, unknown>).payment_links === true) {
    // #923: the machine only (`runPaymentLinksLoad`), never a CMS admin session.
    const r = await runPaymentLinksLoad(auth.role, () => {
      const asaas = asaasFromEnv();
      return asaas ? baseDeps(asaas) : null;
    });
    return json(r.status, r.body);
  }

  let databaseOnly: Record<string, unknown>;
  try {
    databaseOnly = await runTransitionEmails(transitionDeps());
  } catch (e) {
    console.error('[places-payment-sweep] transition e-mails failed', e instanceof Error ? e.message.slice(0, 200) : 'unknown');
    databaseOnly = { transition_emails: 'failed' };
  }
  try {
    databaseOnly.story_suspension = await reconcilePartnerStories(suspensionDeps());
  } catch (e) {
    console.error('[places-payment-sweep] story suspension failed', e instanceof Error ? e.message.slice(0, 200) : 'unknown');
    databaseOnly.story_suspension = 'failed';
  }
  databaseOnly.payout_close = await triggerPayoutClose(
    (url, init) => fetch(url, init),
    (Deno.env.get('CMS_ORIGIN') ?? '').trim(),
    (Deno.env.get('CMS_JOB_SECRET') ?? '').trim(),
  );

  const asaas = asaasFromEnv();
  if (!asaas) {
    console.error('[places-payment-sweep] ASAAS_BASE_URL or ASAAS_API_KEY is not set');
    return json(503, { error: 'unavailable', ...databaseOnly });
  }
  try {
    const summary = { ...(await runSweep(baseDeps(asaas))), ...databaseOnly };
    console.log('[places-payment-sweep]', JSON.stringify(summary));
    return json(200, summary);
  } catch (e) {
    console.error('[places-payment-sweep] failed', e instanceof Error ? e.message.slice(0, 200) : 'unknown');
    return json(500, { error: 'failed', ...databaseOnly });
  }
});
