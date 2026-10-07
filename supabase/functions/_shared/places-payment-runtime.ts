// _shared/places-payment-runtime.ts — the Deno wiring of `_shared/places-payment.ts` (#811).
//
// Everything with a side effect the tests replace lives here: the Supabase clients, the Asaas
// client from the secrets, Resend. The logic stays in `places-payment.ts`, which the CMS tests
// load under Node; this file imports esm.sh and runs only in the Edge runtime.
//
// Secrets: ASAAS_API_KEY, ASAAS_BASE_URL (sandbox `https://api-sandbox.asaas.com/v3`, production
// `https://api.asaas.com/v3` — no default: an unset URL refuses, it never guesses the environment),
// ASAAS_WEBHOOK_TOKEN (webhook only), RESEND_API_KEY, RESEND_FROM, PARTNER_ALERT_TO,
// PLACES_DRAFT_SECRET (the cookie's checkout, #863) and PLACES_PORTAL_ORIGIN (the access link).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createAdminClient, getPublishableKey, getSupabaseUrl } from './supabase-client.ts';
import { asaasClient } from './asaas.ts';
import { saoPauloDate, type CancelRedoRow, type Deps, type ExpiredCardRow, type Rpc, type SubscriptionIds } from './places-payment.ts';
import { issueAccessLink } from './places-portal-draft.ts';
import { accessLinkDeps } from './places-access-link-runtime.ts';

const RESEND_URL = 'https://api.resend.com/emails';

export function asaasFromEnv() {
  const baseUrl = (Deno.env.get('ASAAS_BASE_URL') ?? '').trim();
  const apiKey = (Deno.env.get('ASAAS_API_KEY') ?? '').trim();
  if (!baseUrl || !apiKey) return null;
  return asaasClient({ baseUrl, apiKey, fetch: (url, init) => fetch(url, init) });
}

// deno-lint-ignore no-explicit-any
function rpcOf(client: any): Rpc {
  return async (schema, fn, args) => {
    try {
      const { data, error } = await client.schema(schema).rpc(fn, args);
      return { data, error: error ? { code: error.code, details: error.details, message: error.message } : null };
    } catch {
      return { data: null, error: { code: 'network' } };
    }
  };
}

async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const key = (Deno.env.get('RESEND_API_KEY') ?? '').trim();
  if (!key) return false;
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: (Deno.env.get('RESEND_FROM') ?? 'Tuggi <news@tuggi.app>').trim(),
        to: [to],
        subject,
        text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Ids and outcomes only (see `Deps.alert`). Log line first: the e-mail may fail. */
export async function alert(what: string, fields: Record<string, string | number | null | undefined>): Promise<void> {
  console.error('[places-payment][ALERT]', what, JSON.stringify(fields));
  const to = (Deno.env.get('PARTNER_ALERT_TO') ?? 'suporte@tuggi.app').trim();
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v ?? '—'}`);
  await sendEmail(to, `[Tuggi pagamento] ${what}`, [`Alerta da EF de pagamento do Com história (#811): ${what}`, '', ...lines].join('\n'));
}

const SUBSCRIPTION_COLUMNS =
  'id, status, payment_method, provider_subscription_id, provider_customer_id, provider_authorization_id, canceled_at, early_termination_fee_cents, early_termination_paid_at';

// deno-lint-ignore no-explicit-any
function toIds(s: any): SubscriptionIds | null {
  return s
    ? {
        subscription_id: s.id,
        status: s.status,
        payment_method: s.payment_method ?? null,
        provider_subscription_id: s.provider_subscription_id ?? null,
        provider_customer_id: s.provider_customer_id ?? null,
        provider_authorization_id: s.provider_authorization_id ?? null,
        canceled_at: s.canceled_at ?? null,
        early_termination_fee_cents: s.early_termination_fee_cents ?? null,
        early_termination_paid_at: s.early_termination_paid_at ?? null,
      }
    : null;
}

export function baseDeps(asaas: NonNullable<ReturnType<typeof asaasFromEnv>>): Deps {
  const admin = createAdminClient();
  return {
    asaas,
    admin: rpcOf(admin),
    subscriptionIds: async (submissionId: string): Promise<SubscriptionIds | null> => {
      const { data, error } = await admin
        .schema('partner')
        .from('place_acceptances')
        .select(`place_subscriptions(${SUBSCRIPTION_COLUMNS})`)
        .eq('submission_id', submissionId)
        .maybeSingle();
      if (error) throw new Error(`subscription read ${error.code}`);
      const raw = data?.place_subscriptions;
      return toIds(Array.isArray(raw) ? raw[0] : raw);
    },
    subscriptionById: async (subscriptionId: string): Promise<SubscriptionIds | null> => {
      const { data, error } = await admin.schema('partner').from('place_subscriptions').select(SUBSCRIPTION_COLUMNS).eq('id', subscriptionId).maybeSingle();
      if (error) throw new Error(`subscription read ${error.code}`);
      return toIds(data);
    },
    alert,
    today: () => saoPauloDate(new Date()),
    now: () => new Date(),
    expiredLiveCards: async (): Promise<ExpiredCardRow[]> => {
      const { data, error } = await admin
        .schema('partner')
        .from('place_subscriptions')
        .select('id, provider_subscription_id, paid_through, early_termination_fee_cents, early_termination_paid_at')
        .eq('status', 'expired')
        .in('payment_method', ['credit_card', 'pix'])   // fees charged by the subscription itself (#898)
        .is('canceled_at', null)
        .not('provider_subscription_id', 'is', null);
      if (error) throw new Error(`expired cards read ${error.code}`);
      // deno-lint-ignore no-explicit-any
      return (data ?? []).map(({ id, ...r }: any) => ({ subscription_id: id, ...r }));
    },
    cancelsToRedo: async (): Promise<CancelRedoRow[]> => {
      const { data, error } = await admin
        .schema('partner')
        .from('place_subscriptions')
        .select(`${SUBSCRIPTION_COLUMNS}, paid_through`)
        .eq('renews', false)
        .not('early_termination_fee_cents', 'is', null)
        .is('early_termination_paid_at', null)
        .is('canceled_at', null)
        .not('provider_subscription_id', 'is', null)
        .not('paid_through', 'is', null);
      if (error) throw new Error(`cancels to redo read ${error.code}`);
      // deno-lint-ignore no-explicit-any
      return (data ?? []).map((r: any) => ({ ...toIds(r)!, paid_through: r.paid_through }));
    },
    submissionOfSubscription: async (subscriptionId, providerSubscriptionId) => {
      if (!subscriptionId && !providerSubscriptionId) return null;
      const q = admin.schema('partner').from('place_subscriptions').select('place_acceptances(submission_id)');
      const { data, error } = await (subscriptionId ? q.eq('id', subscriptionId) : q.eq('provider_subscription_id', providerSubscriptionId)).maybeSingle();
      if (error) throw new Error(`subscription read ${error.code}`);
      const acc = data?.place_acceptances;
      const sid = (Array.isArray(acc) ? acc[0] : acc)?.submission_id;
      return typeof sid === 'string' ? sid : null;
    },
    accessLink: async (submissionId) => (await issueAccessLink(accessLinkDeps(admin), submissionId)).kind,
  };
}

/** The user's JWT on every `core.portal_*` call: the database proves the owner (demand 4). */
export function userDeps(jwt: string) {
  const client = createClient(getSupabaseUrl(), getPublishableKey(), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  return {
    user: rpcOf(client),
    userEmail: async () => {
      const { data } = await client.auth.getUser(jwt);
      return data?.user?.email ?? null;
    },
    sendEmail,
  };
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
