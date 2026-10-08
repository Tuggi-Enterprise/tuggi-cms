// Edge Function: places-legacy-customers
//
// Registers the legacy partners that pay R$ 100/month (`LEGACY_FILTER`) as Asaas customers, with
// WhatsApp on in their billing notifications. Customer only: no subscription, no charge. Logic in
// `_shared/places-legacy-customers.ts`.
//
// Body `{ "dry_run": true }` (the default, also for an empty body): reads Asaas (GET only) and
// answers what would be sent, masked. `{ "dry_run": false }` writes. Idempotent: running it again
// changes nothing the first run did.
//
// Which Asaas: the `ASAAS_BASE_URL` secret, the same one the payment functions read; the answer
// says it in `environment`. Caller: the operator with the project's secret key (`requireAdmin`,
// machine bypass). Deploy with `--no-verify-jwt`.

import { requireAdmin } from '../_shared/auth-middleware.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';
import { asaasFromEnv, json } from '../_shared/places-payment-runtime.ts';
import {
  LEGACY_COLUMNS,
  LEGACY_FILTER,
  asaasEnvironment,
  isDryRun,
  registerLegacyCustomers,
  type LegacyClientRow,
} from '../_shared/places-legacy-customers.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  // Machine key only: a CMS admin JWT also passes requireAdmin, and this writes to Asaas production.
  if (auth.role !== 'service_role') return json(403, { error: 'forbidden' });

  const dryRun = isDryRun(await req.json().catch(() => null));
  const environment = asaasEnvironment((Deno.env.get('ASAAS_BASE_URL') ?? '').trim());
  const asaas = asaasFromEnv();
  if (!asaas) return json(503, { error: 'asaas_not_configured' });

  const { data, error } = await createAdminClient()
    .schema('core')
    .from('clients')
    .select(LEGACY_COLUMNS)
    .eq('client_type', LEGACY_FILTER.client_type)
    .eq('status', LEGACY_FILTER.status)
    .eq('monthly_fee_cents', LEGACY_FILTER.monthly_fee_cents)
    .eq('is_courtesy', LEGACY_FILTER.is_courtesy)
    .order('id');
  if (error) {
    console.error('[places-legacy-customers] clients read failed', error.code ?? 'unknown');
    return json(500, { error: 'clients_read_failed' });
  }

  const results = await registerLegacyCustomers(asaas, (data ?? []) as LegacyClientRow[], dryRun);
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  // Counts only: the results carry name and address number.
  console.log('[places-legacy-customers]', JSON.stringify({ environment, dry_run: dryRun, counts }));
  return json(200, { environment, dry_run: dryRun, counts, results });
});
