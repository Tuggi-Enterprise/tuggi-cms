// _shared/places-payment-runtime.ts — the Deno wiring of `_shared/places-payment.ts` (#811).
//
// Everything with a side effect the tests replace lives here: the Supabase clients, the Asaas
// client from the secrets, Resend. The logic stays in `places-payment.ts`, which the CMS tests
// load under Node; this file imports esm.sh and runs only in the Edge runtime.
//
// Secrets: ASAAS_API_KEY, ASAAS_BASE_URL (sandbox `https://api-sandbox.asaas.com/v3`, production
// `https://api.asaas.com/v3` — no default: an unset URL refuses, it never guesses the environment),
// ASAAS_WEBHOOK_TOKEN (webhook only), RESEND_API_KEY, RESEND_FROM, PARTNER_ALERT_TO,
// PLACES_DRAFT_SECRET (the cookie's checkout, #863), PLACES_PORTAL_ORIGIN (the access link) and the
// invoice's ASAAS_INVOICE_SERVICE_CODE, ASAAS_INVOICE_SERVICE_NAME, ASAAS_INVOICE_ISS_RATE (#901,
// `places-invoice.ts`; unset = no invoice configured, one alert per subscription).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createAdminClient, getPublishableKey, getSupabaseUrl } from './supabase-client.ts';
import { asaasClient } from './asaas.ts';
import { SUPPORT_EMAIL, saoPauloDate, type CancelRedoRow, type Deps, type ExpiredCardRow, type Rpc, type SubscriptionIds } from './places-payment.ts';
import { issueAccessLink } from './places-portal-draft.ts';
import { INVOICE_ENV, MirrorReadError, parseInvoiceConfig, type InvoiceTarget } from './places-invoice.ts';
import { accessLinkDeps, fromWithName } from './places-access-link-runtime.ts';

const RESEND_URL = 'https://api.resend.com/emails';

export function asaasFromEnv() {
  const baseUrl = (Deno.env.get('ASAAS_BASE_URL') ?? '').trim();
  const apiKey = (Deno.env.get('ASAAS_API_KEY') ?? '').trim();
  if (!baseUrl || !apiKey) return null;
  return asaasClient({ baseUrl, apiKey, fetch: (url, init) => fetch(url, init) });
}

// deno-lint-ignore no-explicit-any
export function rpcOf(client: any): Rpc {
  return async (schema, fn, args) => {
    try {
      const { data, error } = await client.schema(schema).rpc(fn, args);
      return { data, error: error ? { code: error.code, details: error.details, message: error.message } : null };
    } catch {
      return { data: null, error: { code: 'network' } };
    }
  };
}

async function sendEmail(to: string, subject: string, text: string, mail: { html?: string; fromName?: string; replyTo?: string } = {}): Promise<boolean> {
  const key = (Deno.env.get('RESEND_API_KEY') ?? '').trim();
  if (!key) return false;
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromWithName((Deno.env.get('RESEND_FROM') ?? 'Tuggi <news@tuggi.app>').trim(), mail.fromName),
        to: [to],
        subject,
        ...(mail.html ? { html: mail.html } : {}),
        text,
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
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
  const to = (Deno.env.get('PARTNER_ALERT_TO') ?? SUPPORT_EMAIL).trim();
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

/** The invoice secrets; a set-but-invalid one is logged by name (never the value). */
function invoiceConfigFromEnv() {
  const config = parseInvoiceConfig((name) => Deno.env.get(name));
  if (!config && Object.values(INVOICE_ENV).some((n) => (Deno.env.get(n) ?? '').trim())) {
    console.error('[places-payment] invoice secrets incomplete or invalid:', Object.values(INVOICE_ENV).join(', '));
  }
  return config;
}

const INVOICE_TARGET_DAYS = 40;

export function baseDeps(asaas: NonNullable<ReturnType<typeof asaasFromEnv>>): Deps {
  const admin = createAdminClient();
  return {
    invoiceConfig: invoiceConfigFromEnv(),
    sendEmail,
    invoiceStatusOf: async (providerInvoiceId: string): Promise<string | null> => {
      const { data, error } = await admin.schema('partner').from('place_invoices').select('status').eq('provider_invoice_id', providerInvoiceId).maybeSingle();
      if (error) throw new MirrorReadError(error.code ?? null); // classified by `recordInvoice` (200 + alert when permanent)
      return data?.status ?? null;
    },
    invoiceTargets: async (): Promise<InvoiceTarget[]> => {
      const since = new Date(Date.now() - INVOICE_TARGET_DAYS * 24 * 3600 * 1000).toISOString();
      const { data, error } = await admin
        .schema('partner')
        .from('place_subscriptions')
        .select('id, provider_subscription_id, provider_customer_id, canceled_at')
        .not('provider_customer_id', 'is', null)
        .or(`canceled_at.is.null,canceled_at.gt.${since}`);
      if (error) throw new Error(`invoice targets read ${error.code}`);
      // deno-lint-ignore no-explicit-any
      return (data ?? []).map((r: any) => ({
        subscription_id: r.id,
        // an ended plan's subscription is gone at Asaas: only its invoices are re-read
        provider_subscription_id: r.canceled_at ? null : r.provider_subscription_id ?? null,
        provider_customer_id: r.provider_customer_id,
      }));
    },
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
    sentPayouts: async () => {
      const { data, error } = await admin
        .schema('partner')
        .from('place_payouts')
        .select('id, provider_transfer_id')
        .eq('status', 'sent')
        .not('provider_transfer_id', 'is', null)
        .limit(500);
      if (error) throw new Error(`sent payouts read ${error.code}`);
      // deno-lint-ignore no-explicit-any
      return (data ?? []).map((r: any) => ({ payout_id: r.id, provider_transfer_id: r.provider_transfer_id }));
    },
    // #916: the mirror submission of a client from before the portal (`legacy_client_id`).
    legacyOf: async (submissionId) => {
      const { data, error } = await admin.schema('partner').from('place_submissions').select('legacy_client_id, legacy_fee_ended_at').eq('id', submissionId).maybeSingle();
      if (error) throw new Error(`legacy read ${error.code}`);
      return typeof data?.legacy_client_id === 'string' ? { client_id: data.legacy_client_id, fee_ended_at: data.legacy_fee_ended_at ?? null } : null;
    },
    legacyFeesEnded: async () => {
      const { data, error } = await admin
        .schema('partner')
        .from('place_submissions')
        .select('legacy_client_id')
        .not('legacy_client_id', 'is', null)
        .not('legacy_fee_ended_at', 'is', null);
      if (error) throw new Error(`legacy fees read ${error.code}`);
      // deno-lint-ignore no-explicit-any
      return (data ?? []).map((r: any) => r.legacy_client_id as string);
    },
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
