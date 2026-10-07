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
// Caller: a pg_cron job with the project's secret key (`requireAdmin`, machine bypass), the same
// pattern as `daily-gamification-orchestrator`. Deploy with `--no-verify-jwt`.

import { requireAdmin } from '../_shared/auth-middleware.ts';
import { runSweep } from '../_shared/places-payment.ts';
import { asaasFromEnv, baseDeps, json } from '../_shared/places-payment-runtime.ts';
import { runTransitionEmails } from '../_shared/places-transition-email.ts';
import { transitionDeps } from '../_shared/places-transition-email-runtime.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;

  let emails: Record<string, unknown>;
  try {
    emails = await runTransitionEmails(transitionDeps());
  } catch (e) {
    console.error('[places-payment-sweep] transition e-mails failed', e instanceof Error ? e.message.slice(0, 200) : 'unknown');
    emails = { transition_emails: 'failed' };
  }

  const asaas = asaasFromEnv();
  if (!asaas) {
    console.error('[places-payment-sweep] ASAAS_BASE_URL or ASAAS_API_KEY is not set');
    return json(503, { error: 'unavailable', ...emails });
  }
  try {
    const summary = { ...(await runSweep(baseDeps(asaas))), ...emails };
    console.log('[places-payment-sweep]', JSON.stringify(summary));
    return json(200, summary);
  } catch (e) {
    console.error('[places-payment-sweep] failed', e instanceof Error ? e.message.slice(0, 200) : 'unknown');
    return json(500, { error: 'failed', ...emails });
  }
});
