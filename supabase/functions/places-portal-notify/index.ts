// Edge Function: places-portal-notify (#813, BR-B2B-049 item 10)
//
// The approval e-mail of the Portal Locais: the CMS route that approves a submission
// (`app/api/admin/partnerships/validation/[submissionId]/route.ts`) calls this right after
// `in_review → approved`, with the operator's own access token. Logic and copy in
// `_shared/places-transition-email.ts` (`notifyApproved`); "no ar" and the kit reminder are in the
// daily `places-payment-sweep`.
//
// Body: `{"event": "approved", "submission_id": uuid}`. 200 sent · 400 invalid_body · 404 not_found ·
// 409 not_approved (the submission is not in `approved`: nothing is sent) · 502 failed.
// Gate: `requireAdmin` (CMS admin JWT, or the project's secret key).

import { requireAdmin } from '../_shared/auth-middleware.ts';
import { notifyApproved, parseNotify } from '../_shared/places-transition-email.ts';
import { transitionDeps } from '../_shared/places-transition-email-runtime.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const STATUS = { sent: 200, not_found: 404, not_approved: 409, failed: 502 } as const;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;

  const parsed = parseNotify(await req.json().catch(() => null));
  if (!parsed) return json(400, { error: 'invalid_body' });

  const outcome = await notifyApproved(transitionDeps(), parsed.submissionId);
  if (outcome !== 'sent') console.error('[places-portal-notify]', outcome, parsed.submissionId);
  return json(STATUS[outcome], outcome === 'sent' ? { ok: true } : { error: outcome });
});
