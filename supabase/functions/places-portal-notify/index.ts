// Edge Function: places-portal-notify (#813, BR-B2B-049 item 10)
//
// The approval and "no ar" e-mails of the Portal Locais, with the operator's own access token:
//  · `approved` — the CMS route that approves a submission
//    (`app/api/admin/partnerships/validation/[submissionId]/route.ts`), right after `in_review → approved`;
//  · `live` (#906) — the CMS publish route
//    (`app/api/admin/partnerships/clients/[clientId]/places/[attractionId]/publish/route.ts`), right
//    after `approved → live`.
// Logic and copy in `_shared/places-transition-email.ts` (`notifyApproved`, `notifyLive`); the daily
// `places-payment-sweep` is the net for "no ar" and sends the kit reminder.
//
// Body: `{"event": "approved" | "live", "submission_id": uuid}`. 200 sent · 400 invalid_body ·
// 404 not_found · 409 not_approved / not_live (the submission is not in that status: nothing is sent) ·
// 502 failed.
// Gate: `requireAdmin` (CMS admin JWT, or the project's secret key).

import { requireAdmin } from '../_shared/auth-middleware.ts';
import { notifyApproved, notifyLive, parseNotify } from '../_shared/places-transition-email.ts';
import { transitionDeps } from '../_shared/places-transition-email-runtime.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const STATUS = { sent: 200, not_found: 404, not_approved: 409, not_live: 409, failed: 502 } as const;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;

  const parsed = parseNotify(await req.json().catch(() => null));
  if (!parsed) return json(400, { error: 'invalid_body' });

  const deps = transitionDeps();
  const outcome = parsed.event === 'live'
    ? await notifyLive(deps, parsed.submissionId)
    : await notifyApproved(deps, parsed.submissionId);
  if (outcome !== 'sent') console.error('[places-portal-notify]', parsed.event, outcome, parsed.submissionId);
  return json(STATUS[outcome], outcome === 'sent' ? { ok: true } : { error: outcome });
});
