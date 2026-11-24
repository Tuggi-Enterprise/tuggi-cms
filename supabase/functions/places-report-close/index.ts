// Edge Function: places-report-close (#993)
//
// Closes the cycle report of the Portal Locais (BR-B2B-059 items 3, 4, 5 and 7e): freezes the
// numbers of every live place (`partner.report_cycle_compute`), adds the site block from GA4
// (property 494999879), publishes (`partner.report_cycle_publish`) and sends the owner one e-mail
// per place and cycle. Logic in `_shared/places-report-close.ts`; contract
// `docs/contracts/places-cms.md` (workspace).
//
// Body `{ "cycle_end"?: "YYYY-MM-20", "send_email"?: boolean, "dry_run"?: boolean }`; empty = the last
// closed cycle, e-mail on. `dry_run` writes nothing and sends nothing: it lists each place with the
// site block it would get. Rerun: a published cycle is not recalculated, and a place that got the
// e-mail does not get a second one.
//
// Caller: the pg_cron job `places-report-cycle-close` (day 21, 09:00 UTC = 06:00 in Brasília) with
// the project's secret key (`requireAdmin`, machine bypass, as `places-payment-sweep`), or the
// operator with the same key. A CMS admin JWT is refused: this e-mails real clients. Secrets:
// GA4_SERVICE_ACCOUNT_JSON (without it nothing is published, 503), RESEND_API_KEY, RESEND_FROM,
// PLACES_PORTAL_ORIGIN. Deploy with `--no-verify-jwt`.

import { requireAdmin } from '../_shared/auth-middleware.ts';
import { json } from '../_shared/places-payment-runtime.ts';
import { runReportClose } from '../_shared/places-report-close.ts';
import { reportCloseDeps } from '../_shared/places-report-close-runtime.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'service_role') return json(403, { error: 'forbidden' });

  const raw = await req.text().catch(() => '');
  const r = await runReportClose(reportCloseDeps(), raw);
  const { results: _results, ...summary } = r.body;
  console.log('[places-report-close]', r.status, JSON.stringify(summary));
  return json(r.status, r.body);
});
