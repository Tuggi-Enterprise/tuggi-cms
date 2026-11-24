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
// Body `{ "action": "create_accounts", "dry_run": true }` (#997): every mirror without an owner gets its
// portal account (Auth user of `contact_email`, then `partner.place_bind_legacy_account`), with no
// e-mail and no link. Dry run by default, as above: it lists the mirrors and writes nothing.
//
// Caller: the operator with the project's secret key (`requireAdmin`, machine bypass). Deploy with
// `--no-verify-jwt`. The answer and the log carry ids, variant and codes only: no name, no e-mail.

import { requireAdmin } from '../_shared/auth-middleware.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';
import { json } from '../_shared/places-payment-runtime.ts';
import { isDryRun } from '../_shared/places-legacy-customers.ts';
import { issueAccessLink } from '../_shared/places-portal-draft.ts';
import { accessLinkDeps, createPortalUser, listUsersPage } from '../_shared/places-access-link-runtime.ts';
import {
  LEGACY_ACCESS_COLUMNS,
  LEGACY_ACCESS_FILTER,
  LEGACY_ACCOUNT_COLUMNS,
  runLegacyAccess,
  runLegacyAccounts,
  userFinder,
  type LegacyAccessRow,
  type LegacyAccountRow,
} from '../_shared/places-legacy-access.ts';

type Admin = ReturnType<typeof createAdminClient>;

function countBy<T>(results: T[], key: (r: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of results) counts[key(r)] = (counts[key(r)] ?? 0) + 1;
  return counts;
}

/** #997: the account of every mirror without an owner. No e-mail, no link. */
async function createAccounts(admin: Admin, dryRun: boolean): Promise<Response> {
  const { data, error } = await admin
    .schema('partner')
    .from('place_submissions')
    .select(LEGACY_ACCOUNT_COLUMNS)
    .not('legacy_client_id', 'is', null)
    .is('account_id', null)
    .order('id');
  if (error) {
    console.error('[places-legacy-access] mirrors read failed', error.code ?? 'unknown');
    return json(500, { error: 'mirrors_read_failed' });
  }
  const results = await runLegacyAccounts(
    {
      createUser: (email) => createPortalUser(admin, email),
      findUser: userFinder(listUsersPage(admin)),
      bind: async (submissionId, userId) => {
        const { data, error } = await admin.schema('partner').rpc('place_bind_legacy_account', { p_submission_id: submissionId, p_user_id: userId });
        return { data, error: error ? { code: error.code, details: error.details, message: error.message } : null };
      },
    },
    (data ?? []) as LegacyAccountRow[],
    dryRun,
  );
  const counts = countBy(results, (r) => r.status);
  console.log('[places-legacy-access]', JSON.stringify({ action: 'create_accounts', dry_run: dryRun, counts }));
  return json(200, { action: 'create_accounts', dry_run: dryRun, counts, results });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  // Machine key only: a CMS admin JWT also passes requireAdmin, and this e-mails real clients and
  // creates their accounts.
  if (auth.role !== 'service_role') return json(403, { error: 'forbidden' });

  const body = await req.json().catch(() => null);
  const dryRun = isDryRun(body);
  const action = body && typeof body === 'object' ? (body as Record<string, unknown>).action : undefined;
  if (action !== undefined && action !== 'create_accounts') return json(400, { error: 'invalid', field: 'action' });
  const admin = createAdminClient();
  if (action === 'create_accounts') return createAccounts(admin, dryRun);

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
  const counts = countBy(results, (r) => `${r.variant}:${r.status}`);
  console.log('[places-legacy-access]', JSON.stringify({ dry_run: dryRun, counts }));
  return json(200, { dry_run: dryRun, counts, results });
});
