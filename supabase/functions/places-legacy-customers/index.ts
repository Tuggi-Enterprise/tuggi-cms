// Edge Function: places-legacy-customers
//
// The legacy partners that pay R$ 100/month (`LEGACY_FILTER`), two actions, logic in
// `_shared/places-legacy-customers.ts`:
// - `"action": "customers"` (the default): registers them as Asaas customers, with WhatsApp on in
//   their billing notifications. No subscription, no charge.
// - `"action": "subscriptions"` (#917): one monthly subscription each at Asaas, `legacy:<client_id>`,
//   first due on the next day 20. Needs the customer from the action above.
//
// Body `{ "dry_run": true }` (the default, also for an empty body): reads Asaas (GET only) and
// answers what would be sent. `{ "dry_run": false }` writes. Idempotent: running it again changes
// nothing the first run did.
//
// Which Asaas: the `ASAAS_BASE_URL` secret, the same one the payment functions read; the answer
// says it in `environment`. Caller: the operator with the project's secret key (`requireAdmin`,
// machine bypass). Deploy with `--no-verify-jwt`.

import { requireAdmin } from '../_shared/auth-middleware.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';
import { asaasFromEnv, json } from '../_shared/places-payment-runtime.ts';
import { saoPauloDate } from '../_shared/places-payment.ts';
import {
  LEGACY_COLUMNS,
  LEGACY_FEE_COLUMNS,
  LEGACY_FILTER,
  asaasEnvironment,
  createLegacySubscriptions,
  isDryRun,
  registerLegacyCustomers,
  type LegacyClientRow,
  type LegacyFeeRow,
} from '../_shared/places-legacy-customers.ts';

const ACTIONS = ['customers', 'subscriptions'] as const;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  // Machine key only: a CMS admin JWT also passes requireAdmin, and this writes to Asaas production.
  if (auth.role !== 'service_role') return json(403, { error: 'forbidden' });

  const body = await req.json().catch(() => null);
  const dryRun = isDryRun(body);
  const action = (body as { action?: unknown } | null)?.action ?? 'customers';
  if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) return json(400, { error: 'unknown_action' });
  const environment = asaasEnvironment((Deno.env.get('ASAAS_BASE_URL') ?? '').trim());
  const asaas = asaasFromEnv();
  if (!asaas) return json(503, { error: 'asaas_not_configured' });

  const { data, error } = await createAdminClient()
    .schema('core')
    .from('clients')
    .select(action === 'subscriptions' ? LEGACY_FEE_COLUMNS : LEGACY_COLUMNS)
    .eq('client_type', LEGACY_FILTER.client_type)
    .eq('status', LEGACY_FILTER.status)
    .eq('monthly_fee_cents', LEGACY_FILTER.monthly_fee_cents)
    .eq('is_courtesy', LEGACY_FILTER.is_courtesy)
    .order('id');
  if (error) {
    console.error('[places-legacy-customers] clients read failed', error.code ?? 'unknown');
    return json(500, { error: 'clients_read_failed' });
  }

  const results =
    action === 'subscriptions'
      ? await createLegacySubscriptions(asaas, (data ?? []) as unknown as LegacyFeeRow[], dryRun, saoPauloDate(new Date()))
      : await registerLegacyCustomers(asaas, (data ?? []) as unknown as LegacyClientRow[], dryRun);
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  // Counts only: the customers results carry name and address number.
  console.log('[places-legacy-customers]', JSON.stringify({ environment, action, dry_run: dryRun, counts }));
  return json(200, { environment, action, dry_run: dryRun, counts, results });
});
