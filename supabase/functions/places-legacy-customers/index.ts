// Edge Function: places-legacy-customers
//
// The legacy partners that pay R$ 100/month (`LEGACY_FILTER`), two actions, logic in
// `_shared/places-legacy-customers.ts`:
// - `"action": "customers"` (the default): registers them as Asaas customers, with WhatsApp on in
//   their billing notifications. No subscription, no charge.
// - `"action": "subscriptions"` (#917): one monthly subscription each at Asaas, `legacy:<client_id>`,
//   first due on the next day 20. Needs the customer from the action above.
// - `"action": "mirror"` (#918): the subscriptions of the action above into `place_subscriptions`
//   (origin `cms_contract`) and their charges, through the webhook's own functions
//   (`mirrorContractSubscriptions`, `_shared/places-payment.ts`). Needs migration 20261008140000.
//   Optional `"contract_ends_on": "YYYY-MM-DD"`: the contract review date written on each registered
//   row (`set_contract_place_subscription_end`); the dry run says it would.
//
// Body `{ "dry_run": true }` (the default, also for an empty body): reads Asaas (GET only), never
// writes the database, and answers what would be sent. `{ "dry_run": false }` writes. Idempotent: running it again changes
// nothing the first run did.
//
// Which Asaas: the `ASAAS_BASE_URL` secret, the same one the payment functions read; the answer
// says it in `environment`. Caller: the operator with the project's secret key (`requireAdmin`,
// machine bypass). Deploy with `--no-verify-jwt`.

import { requireAdmin } from '../_shared/auth-middleware.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';
import { asaasFromEnv, json, rpcOf } from '../_shared/places-payment-runtime.ts';
import { calendarDate, mirrorContractSubscriptions, saoPauloDate } from '../_shared/places-payment.ts';
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

const ACTIONS = ['customers', 'subscriptions', 'mirror'] as const;

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
  const rawEndsOn = (body as { contract_ends_on?: unknown } | null)?.contract_ends_on;
  const contractEndsOn = rawEndsOn === undefined ? undefined : calendarDate(rawEndsOn);
  if (contractEndsOn === null || (contractEndsOn && action !== 'mirror')) return json(400, { error: 'invalid', field: 'contract_ends_on' });
  const environment = asaasEnvironment((Deno.env.get('ASAAS_BASE_URL') ?? '').trim());
  const asaas = asaasFromEnv();
  if (!asaas) return json(503, { error: 'asaas_not_configured' });

  const admin = createAdminClient();
  const { data, error } = await admin
    .schema('core')
    .from('clients')
    .select(action === 'customers' ? LEGACY_COLUMNS : LEGACY_FEE_COLUMNS)
    .eq('client_type', LEGACY_FILTER.client_type)
    .eq('status', LEGACY_FILTER.status)
    .eq('monthly_fee_cents', LEGACY_FILTER.monthly_fee_cents)
    .eq('is_courtesy', LEGACY_FILTER.is_courtesy)
    .order('id');
  if (error) {
    console.error('[places-legacy-customers] clients read failed', error.code ?? 'unknown');
    return json(500, { error: 'clients_read_failed' });
  }

  const today = saoPauloDate(new Date());
  const results =
    action === 'mirror'
      ? await mirrorContractSubscriptions(
          { asaas, admin: rpcOf(admin), today: () => today },
          ((data ?? []) as unknown as LegacyFeeRow[]).map((r) => r.id),
          dryRun,
          { contractEndsOn },
        )
      : action === 'subscriptions'
        ? await createLegacySubscriptions(asaas, (data ?? []) as unknown as LegacyFeeRow[], dryRun, today)
        : await registerLegacyCustomers(asaas, (data ?? []) as unknown as LegacyClientRow[], dryRun);
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  // Counts only: the customers results carry name and address number.
  console.log('[places-legacy-customers]', JSON.stringify({ environment, action, dry_run: dryRun, counts }));
  return json(200, { environment, action, dry_run: dryRun, counts, results });
});
