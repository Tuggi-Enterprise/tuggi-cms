// Edge Function: places-legacy-access (#916)
//
// The clients from before the portal get into `/status`: for every approved venue of `core.clients`,
// the mirror submission (`partner.place_seed_legacy_submission`) and the portal access link, in the
// legacy e-mail (paying or free variant). Logic in `_shared/places-legacy-access.ts`; contract
// `docs/contracts/places-portal-rascunho.md` (workspace), the legacy client section.
//
// Body `{ "dry_run": true }` (the default, also for an empty body): reads `core.clients` and answers
// who would get the e-mail, writing nothing. `{ "dry_run": false }` seeds and sends. Rerun: no second
// submission; a claimed one gets nothing; an unclaimed one gets a new link.
//
// Caller: the operator with the project's secret key (`requireAdmin`, machine bypass). Deploy with
// `--no-verify-jwt`. The answer and the log carry ids, variant and codes only: no name, no e-mail.

import { requireAdmin } from '../_shared/auth-middleware.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';
import { json } from '../_shared/places-payment-runtime.ts';
import { isDryRun } from '../_shared/places-legacy-customers.ts';
import { issueAccessLink } from '../_shared/places-portal-draft.ts';
import { accessLinkDeps } from '../_shared/places-access-link-runtime.ts';
import { LEGACY_ACCESS_COLUMNS, LEGACY_ACCESS_FILTER, runLegacyAccess, type LegacyAccessRow } from '../_shared/places-legacy-access.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  // Machine key only: a CMS admin JWT also passes requireAdmin, and this e-mails real clients.
  if (auth.role !== 'service_role') return json(403, { error: 'forbidden' });

  const dryRun = isDryRun(await req.json().catch(() => null));
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema('core')
    .from('clients')
    .select(LEGACY_ACCESS_COLUMNS)
    .eq('client_type', LEGACY_ACCESS_FILTER.client_type)
    .eq('status', LEGACY_ACCESS_FILTER.status)
    .order('id');
  if (error) {
    console.error('[places-legacy-access] clients read failed', error.code ?? 'unknown');
    return json(500, { error: 'clients_read_failed' });
  }

  const links = accessLinkDeps(admin);
  const results = await runLegacyAccess(
    {
      seed: async (clientId) => {
        try {
          const { data, error } = await admin.schema('partner').rpc('place_seed_legacy_submission', { p_client_id: clientId });
          return { data, error: error ? { code: error.code, details: error.details, message: error.message } : null };
        } catch {
          return { data: null, error: { code: 'network' } };
        }
      },
      link: (submissionId, build) => issueAccessLink(links, submissionId, build),
      pause: (ms) => new Promise((r) => setTimeout(r, ms)),
    },
    (data ?? []) as LegacyAccessRow[],
    dryRun,
  );
  const counts: Record<string, number> = {};
  for (const r of results) counts[`${r.variant}:${r.status}`] = (counts[`${r.variant}:${r.status}`] ?? 0) + 1;
  console.log('[places-legacy-access]', JSON.stringify({ dry_run: dryRun, counts }));
  return json(200, { dry_run: dryRun, counts, results });
});
