/**
 * engagement-ga4: the GA4 half of the CMS Engagement report (#1094). Read only, nothing is written.
 *
 *   POST {"from_month":"2026-08","platform":"ios"|"android"|null,"country":"BR"|null}
 *   -> 200 { months: [{ month, activeUsers, engagementSeconds, sessionsPerUser, engagedUsers, newEngagedUsers }],
 *            clicks: [{ month, screen, button, events, users }] }
 *   -> 400 bad body, 401 no valid caller, 403 a CMS user who is not admin, 405 any other method,
 *      502 Google refused or did not answer, 503 GA4_SERVICE_ACCOUNT_JSON missing
 *
 * Gate: `requireAdmin`, the one the CMS functions already use (our machine keys, or an active
 * admin of `core.cms_users`). The CMS server calls it with its secret key from
 * `/api/dashboard/engagement/ga4`, behind `withAuth({ roles: ['admin'] })`. Deploy with
 * `--no-verify-jwt`: the secret key is not a JWT.
 *
 * The credential is the secret social-collect already reads; the property is the app's. Only
 * aggregates leave: no user id exists in these reports. The log carries the error code only
 * (`ga4_report_403`), never Google's body.
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireAdmin } from '../_shared/auth-middleware.ts';
import { GA4_APP_PROPERTY_ID, GA4_CREDENTIALS_ENV, ga4Runner, parseServiceAccount } from '../_shared/ga4-data.ts';
import { parseEngagementGa4Query, readEngagementGa4 } from '../_shared/engagement-ga4.ts';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;

  const query = parseEngagementGa4Query(await req.json().catch(() => null));
  if (!query) return json({ error: 'invalid_query' }, 400);

  const sa = parseServiceAccount(Deno.env.get(GA4_CREDENTIALS_ENV));
  if (!sa) {
    console.error(`[engagement-ga4] ${GA4_CREDENTIALS_ENV} missing or not a service account`);
    return json({ error: 'ga4_not_configured' }, 503);
  }

  try {
    const report = await readEngagementGa4(ga4Runner(sa, GA4_APP_PROPERTY_ID, (url, init) => fetch(url, init)), query);
    return json(report, 200);
  } catch (error) {
    const code = error instanceof Error && /^ga4_(token|report)_\d+$/.test(error.message) ? error.message : 'ga4_unreachable';
    console.error(`[engagement-ga4] read failed: ${code}`);
    return json({ error: 'ga4_failed', code }, 502);
  }
});
