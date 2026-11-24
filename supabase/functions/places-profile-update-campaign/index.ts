// Edge Function: places-profile-update-campaign (#931)
//
// The e-mail that calls the partners (approved venues of `core.clients`, the recipients of
// `places-legacy-access`) to complete their place in the portal. Logic in
// `_shared/places-profile-update-campaign.ts`.
//
// Body `{ "dry_run": true }` (the default, also for an empty body): who would get it, by plan, with
// place and e-mail; writes and sends nothing. `{ "test_to": "<x>@tuggi.app" }`: ONE e-mail to that
// address, a real place name, the button on the sign-in page (no claim link). `{ "dry_run": false }`:
// the real run, once per client (`partner.place_submission_notices`, kind `profile_update_campaign`).
//
// Caller: the operator with the project's secret key (`requireAdmin`, machine bypass). Deploy with
// `--no-verify-jwt`. The log carries counts only: no name, no e-mail.

import { requireAdmin } from '../_shared/auth-middleware.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';
import { json } from '../_shared/places-payment-runtime.ts';
import { ACCESS_FROM_NAME } from '../_shared/places-portal-draft.ts';
import { accessLinkDeps, sendEmailWithId } from '../_shared/places-access-link-runtime.ts';
import { CAMPAIGN_COLUMNS, CAMPAIGN_FILTER, campaignAudience, parseCampaignBody, runCampaign, testMail, type CampaignRow } from '../_shared/places-profile-update-campaign.ts';

const TAG = '[places-profile-update-campaign]';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  // Machine key only: a CMS admin JWT also passes requireAdmin, and this e-mails real clients.
  if (auth.role !== 'service_role') return json(403, { error: 'forbidden' });

  const mode = parseCampaignBody(await req.json().catch(() => null));
  if ('error' in mode) return json(400, mode);

  const admin = createAdminClient();
  const { data, error } = await admin
    .schema('core')
    .from('clients')
    .select(CAMPAIGN_COLUMNS)
    .eq('client_type', CAMPAIGN_FILTER.client_type)
    .eq('status', CAMPAIGN_FILTER.status)
    .order('id');
  if (error) {
    console.error(TAG, 'clients read failed', error.code ?? 'unknown');
    return json(500, { error: 'clients_read_failed' });
  }
  const rows = (data ?? []) as CampaignRow[];

  if (mode.mode === 'dry_run') {
    const audience = campaignAudience(rows);
    console.log(TAG, JSON.stringify({ mode: 'dry_run', counts: audience.counts }));
    return json(200, { dry_run: true, total: rows.length, ...audience });
  }

  const links = accessLinkDeps(admin);
  if (mode.mode === 'test') {
    const { clientId, mail } = testMail(rows, links.origin);
    const id = await sendEmailWithId(mode.to, mail.subject, mail.html, mail.text, ACCESS_FROM_NAME);
    console.log(TAG, JSON.stringify({ mode: 'test', sent: id !== null }));
    return id === null ? json(502, { error: 'unavailable' }) : json(200, { test: true, sent: true, resend_id: id || null, name_from_client: clientId, subject: mail.subject });
  }

  const results = await runCampaign(
    {
      links,
      seed: async (clientId) => {
        try {
          const { data, error } = await admin.schema('partner').rpc('place_seed_legacy_submission', { p_client_id: clientId });
          return { data, error: error ? { code: error.code, details: error.details, message: error.message } : null };
        } catch {
          return { data: null, error: { code: 'network' } };
        }
      },
      recordNotice: async (submissionId, kind) => {
        try {
          const { data, error } = await admin.schema('partner').rpc('record_place_submission_notice', { p_submission_id: submissionId, p_kind: kind });
          return { data, error: error ? { code: error.code, details: error.details, message: error.message } : null };
        } catch {
          return { data: null, error: { code: 'network' } };
        }
      },
      pause: (ms) => new Promise((r) => setTimeout(r, ms)),
    },
    rows,
  );
  const counts: Record<string, number> = {};
  for (const r of results) counts[`${r.plan}:${r.status}`] = (counts[`${r.plan}:${r.status}`] ?? 0) + 1;
  console.log(TAG, JSON.stringify({ mode: 'send', counts }));
  return json(200, { dry_run: false, counts, results });
});
