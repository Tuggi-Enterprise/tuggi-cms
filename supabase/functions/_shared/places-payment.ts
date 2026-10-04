// _shared/places-payment.ts — the payment of the Com história plan (#811, épico #802).
//
// Contract: `docs/contracts/places-pagamento.md` (workspace). Rules: BR-B2B-044, BR-B2B-045,
// BR-B2B-046, BR-B2B-049, BR-B2B-055; term `locais-2026-10-v2`, clauses 4.1–4.7.
//
// Three Edge Functions wire this module and do nothing else:
//   - `places-payment`         the portal's Worker (`x-places-secret` + the user's JWT);
//   - `places-payment-webhook` Asaas (`asaas-access-token`);
//   - `places-payment-sweep`   the daily cron (the project's secret key).
// Every dependency (database, Asaas, e-mail, clock) is injected, so the CMS tests run the whole
// flow under Node with Asaas mocked. Import-free except for the two pure siblings.
//
// The seven demands of the security review of #811, and where each one lives:
//   1. the function is chosen by the status RE-READ from Asaas, never by the event type
//      → `handleAsaasWebhook` / `paymentAction`;
//   2. both re-read ids go to the database (`externalReference` uuid and `subscription`)
//      → `paymentArgs`;
//   3. `p_amount_cents = Math.round(value * 100)`, from `value`, never `netValue` → `toCents`;
//   4. every owner flow proves the owner with the user's JWT (`core.portal_get_subscription` or the
//      `core.portal_*` it calls) and takes every id after that from the database → `ownerRow`;
//   5. a live Asaas subscription with the same `externalReference` is settled before another one is
//      attached → `clearLiveSubscriptions`;
//   6. the webhook token is compared in constant time; no body is logged, only event id, type and
//      outcome → `handleAsaasWebhook`;
//   7. 500 only on a database exception (and, see below, on a transport failure of the re-read);
//      alert on `amount_mismatch`, `subscription_mismatch`, `unknown_subscription`, `not_applicable`.
//
// RE-READ THAT FAILS IN TRANSIT IS A 500 TOO. Demand 7 bars a 500 for a business outcome — that
// would make Asaas resend forever and pause the queue after 15 failures. A timeout reading the
// payment is not an outcome: answering 200 would drop a paid charge on the floor, and the place
// would pay and stay in `awaiting_payment`. A 404 on the re-read IS an answer (the object does not
// exist: a forged or foreign event) → 200 + alert.

import { constantTimeEqual } from './constant-time.ts';
import { AsaasError, type AsaasClient, type AsaasCardHolder, type AsaasCreditCard, type AsaasPayment } from './asaas.ts';

// ─── dependencies ─────────────────────────────────────────────────────────────────────────────

export type DbError = { code?: string | null; details?: string | null; message?: string | null };
export type RpcResult = { data: unknown; error: DbError | null };
export type Rpc = (schema: 'partner' | 'core', fn: string, args: Record<string, unknown>) => Promise<RpcResult>;

/** What the EF needs of `partner.place_subscriptions`, read with `service_role`. */
export type SubscriptionIds = {
  subscription_id: string;
  provider_subscription_id: string | null;
  provider_customer_id: string | null;
  canceled_at: string | null;
};

export type Deps = {
  asaas: AsaasClient;
  /** `service_role`. */
  admin: Rpc;
  subscriptionIds: (submissionId: string) => Promise<SubscriptionIds | null>;
  /** Operator alert. Fields are ids and outcomes only — never a name, a document or an e-mail. */
  alert: (what: string, fields: Record<string, string | number | null | undefined>) => Promise<void>;
  /** Today in America/Sao_Paulo, `YYYY-MM-DD`. */
  today: () => string;
  now: () => Date;
};

export type PortalDeps = Deps & {
  /** The user's JWT: the database proves the owner. */
  user: Rpc;
  /** E-mail of the session's user, from the Auth (not from the request body). */
  userEmail: () => Promise<string | null>;
  sendEmail: (to: string, subject: string, text: string) => Promise<boolean>;
};

export type Reply = { status: number; body: Record<string, unknown> };
const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body });

// ─── small pure pieces ─────────────────────────────────────────────────────────────────────────

/** Demand 3. `value` is reais with cents; never `netValue`. */
export const toCents = (value: number): number => Math.round(value * 100);
const toReais = (cents: number): number => Math.round(cents) / 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `com_historia_<n>m:<uuid>` → the uuid; anything else → null. */
export function subscriptionIdFromReference(ref: unknown): string | null {
  if (typeof ref !== 'string') return null;
  const m = /^com_historia_\d+m:([0-9a-f-]{36})$/i.exec(ref.trim());
  return m && UUID.test(m[1]) ? m[1].toLowerCase() : null;
}

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export const PAID_STATUSES = new Set(['CONFIRMED', 'RECEIVED']);
/** Refunds that exist or may still land. Only a CANCELLED refund lets us ask again. */
export const hasLiveRefund = (p: AsaasPayment): boolean =>
  (p.refunds ?? []).some((r) => (r?.status ?? '').toUpperCase() !== 'CANCELLED');

export const ALERT_OUTCOMES = new Set(['amount_mismatch', 'subscription_mismatch', 'unknown_subscription', 'not_applicable']);

/** `YYYY-MM-DD` + n months, day clamped to the end of the month (Jan 31 + 1 → Feb 28/29). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

export function saoPauloDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}

const firstRow = <T>(data: unknown): T | null => (Array.isArray(data) ? ((data[0] as T) ?? null) : ((data as T) ?? null));

/** A `TGP*` raised by our functions, or a 42501 of the portal. Anything else is an exception. */
const isBusinessError = (e: DbError | null) => !!e?.code && /^(TGP\d\d|42501)$/.test(e.code);

/** Contract §5: TGP01 → 404, TGP10 → 409, TGP22 → 422; 42501 (no e-mail session) → 401. */
export function portalErrorReply(e: DbError): Reply {
  switch (e.code) {
    case 'TGP01':
      return reply(404, { error: 'not_found' });
    case 'TGP10':
      return reply(409, { error: 'not_allowed', reason: e.details ?? null });
    case 'TGP22':
      return reply(422, { error: 'invalid', field: e.details ?? null });
    case '42501':
      return reply(401, { error: 'relogin' });
    default:
      return reply(502, { error: 'unavailable' });
  }
}

// ─── checkout input ────────────────────────────────────────────────────────────────────────────

export type CheckoutInput = {
  submissionId: string;
  card: AsaasCreditCard;
  holder: Omit<AsaasCardHolder, 'email'>;
  remoteIp: string;
};

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const digits = (v: unknown) => str(v).replace(/\D/g, '');

/**
 * Shape check before anything is sent to Asaas. Returns the first bad field, never its value:
 * a card number in an error message is a card number in a log.
 */
export function parseCheckoutInput(body: unknown, today: string): CheckoutInput | { invalid: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const card = (b.card ?? {}) as Record<string, unknown>;
  const holder = (b.holder ?? {}) as Record<string, unknown>;

  if (!isUuid(b.submission_id)) return { invalid: 'submission_id' };
  const number = digits(card.number);
  if (number.length < 13 || number.length > 19 || !luhn(number)) return { invalid: 'card_number' };
  const holderName = str(card.holder_name);
  if (holderName.length < 2 || holderName.length > 100) return { invalid: 'card_holder_name' };
  const month = digits(card.expiry_month);
  let year = digits(card.expiry_year);
  if (year.length === 2) year = `20${year}`;
  if (!/^\d{1,2}$/.test(month) || Number(month) < 1 || Number(month) > 12 || !/^\d{4}$/.test(year)) {
    return { invalid: 'card_expiry' };
  }
  const [ty, tm] = today.split('-').map(Number);
  if (Number(year) < ty || (Number(year) === ty && Number(month) < tm) || Number(year) > ty + 20) {
    return { invalid: 'card_expiry' };
  }
  const ccv = digits(card.ccv);
  if (ccv.length < 3 || ccv.length > 4) return { invalid: 'card_ccv' };

  // CPF (11 digits) or CNPJ (14, alphanumeric since 2026-07; the Asaas field is a string).
  const cpfCnpj = str(holder.cpf_cnpj).replace(/[.\-/\s]/g, '').toUpperCase();
  if (!/^(\d{11}|[0-9A-Z]{12}\d{2})$/.test(cpfCnpj)) return { invalid: 'holder_cpf_cnpj' };
  const name = str(holder.name) || holderName;
  if (name.length < 2 || name.length > 100) return { invalid: 'holder_name' };
  const postalCode = digits(holder.postal_code);
  if (postalCode.length !== 8) return { invalid: 'holder_postal_code' };
  const addressNumber = str(holder.address_number);
  if (!addressNumber || addressNumber.length > 10) return { invalid: 'holder_address_number' };
  const phone = digits(holder.phone);
  if (phone.length < 10 || phone.length > 11) return { invalid: 'holder_phone' };
  const remoteIp = str(b.remote_ip);
  if (!remoteIp || remoteIp.length > 45 || !/^[0-9a-fA-F:.]+$/.test(remoteIp)) return { invalid: 'remote_ip' };

  return {
    submissionId: (b.submission_id as string).toLowerCase(),
    card: { holderName, number, expiryMonth: month.padStart(2, '0'), expiryYear: year, ccv },
    holder: { name, cpfCnpj, postalCode, addressNumber, phone },
    remoteIp,
  };
}

// ─── portal: owner proof ───────────────────────────────────────────────────────────────────────

type OwnerRow = {
  submission_id: string;
  status: string;
  payment_method: string | null;
  billing_period: number;
  paid_through: string | null;
  renews: boolean;
  renewal_amount_cents: number | null;
  withdrawal_until: string | null;
};

/** Demand 4: the user's JWT answers whose the submission is; every id after this is the database's. */
async function ownerRow(deps: PortalDeps, submissionId: string): Promise<OwnerRow | Reply> {
  const { data, error } = await deps.user('core', 'portal_get_subscription', { p_submission_id: submissionId });
  if (error) return portalErrorReply(error);
  const row = firstRow<OwnerRow>(data);
  return row?.submission_id ? row : reply(404, { error: 'not_found' });
}
const isReply = (v: unknown): v is Reply => !!v && typeof v === 'object' && 'status' in v && 'body' in v && !('submission_id' in v);

type CheckoutRow = {
  subscription_id: string;
  status: string;
  attachable: boolean;
  external_reference: string;
  billing_cycle: string;
  billing_period: number;
  next_amount_cents: number;
  renewal_amount_cents: number;
  next_due_date: string | null;
  customer_name: string;
  customer_tax_id: string;
  customer_email: string;
};

// ─── portal: checkout (card) ───────────────────────────────────────────────────────────────────

/**
 * Card subscription for the first period (contract §3.1). The first charge is due today and Asaas
 * charges it on creation; the renewals are realigned to the approval by the daily sweep.
 *
 * FIRST CHARGE WITH A COUPON (contract §8): the subscription is created with `value` = the FIRST
 * charge (`next_amount_cents`). The sweep sets `value` = `renewal_amount_cents` on the first run
 * after approval, before any renewal is due. No second payment method, no token kept by us.
 */
export async function checkout(deps: PortalDeps, body: unknown): Promise<Reply> {
  const input = parseCheckoutInput(body, deps.today());
  if ('invalid' in input) return reply(400, { error: 'invalid', field: input.invalid });

  const owner = await ownerRow(deps, input.submissionId);
  if (isReply(owner)) return owner;

  const { data, error } = await deps.admin('partner', 'place_payment_checkout', { p_submission_id: owner.submission_id });
  if (error) return isBusinessError(error) ? portalErrorReply(error) : reply(502, { error: 'unavailable' });
  const co = firstRow<CheckoutRow>(data);
  if (!co) return reply(502, { error: 'unavailable' });
  // Null `next_due_date` = paid and waiting for approval; not `pending_payment` = nothing to pay.
  if (co.status !== 'pending_payment' || !co.attachable || !co.next_due_date) {
    return reply(409, { error: 'not_payable', reason: co.status });
  }

  try {
    // Demand 5, and the retry: a live subscription already PAID for this reference is attached,
    // not charged again; one that is not paid is deleted before the new one.
    const settled = await clearLiveSubscriptions(deps, owner.submission_id, co);
    if (settled) return settled;

    const customer =
      (await deps.asaas.findCustomerByReference(co.subscription_id)) ??
      (await deps.asaas.createCustomer({
        name: co.customer_name,
        cpfCnpj: co.customer_tax_id.replace(/[.\-/\s]/g, '').toUpperCase(),
        email: co.customer_email,
        externalReference: co.subscription_id,
      }));

    let created;
    try {
      created = await deps.asaas.createCardSubscription({
        customer: customer.id,
        value: toReais(co.next_amount_cents),
        nextDueDate: co.next_due_date,
        cycle: co.billing_cycle,
        description: `Tuggi · Com história · ${co.billing_period} ${co.billing_period === 1 ? 'mês' : 'meses'}`,
        externalReference: co.external_reference,
        creditCard: input.card,
        creditCardHolderInfo: { ...input.holder, email: co.customer_email },
        remoteIp: input.remoteIp,
      });
    } catch (e) {
      // 400 on a card subscription = the card or its holder data was refused; nothing was created.
      if (e instanceof AsaasError && e.status === 400) return reply(402, { error: 'card_refused' });
      throw e;
    }

    const attached = await deps.admin('partner', 'attach_place_subscription', {
      p_subscription_id: co.subscription_id,
      p_payment_method: 'credit_card',
      p_provider_customer_id: customer.id,
      p_provider_subscription_id: created.id,
      p_provider_authorization_id: null,
    });
    if (attached.error) {
      if (attached.error.code === 'TGP10' && attached.error.details === 'renewing') {
        // Contract §3.1: another subscription won the race; this one would be an orphan charging.
        await discardSubscription(deps, created.id, 'checkout_race');
        return reply(409, { error: 'not_allowed', reason: 'renewing' });
      }
      // Kept on purpose: it may already be charged, and the next checkout attaches it (above).
      await deps.alert('attach_failed', { subscription_id: co.subscription_id, provider_subscription_id: created.id, code: attached.error.code });
      return reply(502, { error: 'unavailable' });
    }

    const payments = await deps.asaas.listSubscriptionPayments(created.id);
    await holdNextChargeUntilApproval(deps, created.id, co.next_due_date, co.billing_period, payments);
    const paid = payments.some((p) => PAID_STATUSES.has(p.status));
    return reply(200, { result: paid ? 'paid' : 'processing' });
  } catch (e) {
    if (e instanceof AsaasError) {
      console.error('[places-payment] checkout asaas', e.message);
      return reply(502, { error: 'provider_unavailable' });
    }
    throw e;
  }
}

/**
 * The second charge is generated by Asaas up to 40 days ahead, due one period after the SEND —
 * but the period starts at the approval (term 4.1). Until the sweep realigns it after approval,
 * the next charge is pushed two periods out and the early one is removed, so a slow validation
 * does not charge a renewal before there is a period to renew (`not_applicable` → refund).
 */
async function holdNextChargeUntilApproval(
  deps: Deps,
  providerSubscriptionId: string,
  firstDueDate: string,
  months: number,
  payments: AsaasPayment[],
): Promise<void> {
  try {
    for (const p of payments) {
      if (p.status === 'PENDING' && p.dueDate && p.dueDate > firstDueDate) await deps.asaas.deletePayment(p.id);
    }
    await deps.asaas.updateSubscription(providerSubscriptionId, { nextDueDate: addMonths(firstDueDate, 2 * months) });
  } catch (e) {
    // Not fatal: the charge is real and attached. The sweep realigns after approval; an early
    // renewal lands as `not_applicable`, which alerts.
    await deps.alert('hold_next_charge_failed', { provider_subscription_id: providerSubscriptionId, error: e instanceof Error ? e.message : 'unknown' });
  }
}

/** Returns a reply when an already-paid live subscription was (re)attached; null to go on. */
async function clearLiveSubscriptions(deps: PortalDeps, submissionId: string, co: CheckoutRow): Promise<Reply | null> {
  const ids = await deps.subscriptionIds(submissionId);
  const live = (await deps.asaas.listSubscriptionsByReference(co.external_reference)).filter(
    (s) => !s.deleted && s.status === 'ACTIVE',
  );
  const candidates = new Map(live.map((s) => [s.id, s]));
  if (ids?.provider_subscription_id && !ids.canceled_at && !candidates.has(ids.provider_subscription_id)) {
    candidates.set(ids.provider_subscription_id, null as never);
  }

  for (const id of candidates.keys()) {
    const payments = await deps.asaas.listSubscriptionPayments(id).catch((e) => {
      if (e instanceof AsaasError && e.status === 404) return [] as AsaasPayment[];
      throw e;
    });
    if (payments.some((p) => PAID_STATUSES.has(p.status))) {
      const sub = candidates.get(id) ?? (await deps.asaas.getSubscription(id));
      const customer = (sub as { customer?: string }).customer ?? ids?.provider_customer_id ?? null;
      const { error } = await deps.admin('partner', 'attach_place_subscription', {
        p_subscription_id: co.subscription_id,
        p_payment_method: 'credit_card',
        p_provider_customer_id: customer,
        p_provider_subscription_id: id,
        p_provider_authorization_id: null,
      });
      if (error && !(error.code === 'TGP10')) {
        await deps.alert('attach_failed', { subscription_id: co.subscription_id, provider_subscription_id: id, code: error.code });
        return reply(502, { error: 'unavailable' });
      }
      return reply(200, { result: 'paid' });
    }
  }

  for (const id of candidates.keys()) {
    await deps.asaas.deleteSubscription(id);
  }
  if (ids?.provider_subscription_id && !ids.canceled_at) {
    const { error } = await deps.admin('partner', 'cancel_place_subscription', {
      p_event_id: null,
      p_event_type: null,
      p_subscription_id: ids.subscription_id,
      p_provider_subscription_id: null,
      p_actor_kind: 'client',
    });
    if (error) {
      await deps.alert('cancel_failed', { subscription_id: ids.subscription_id, code: error.code });
      return reply(502, { error: 'unavailable' });
    }
  }
  return null;
}

/** Delete a subscription we must not keep, giving back whatever it already charged. */
async function discardSubscription(deps: Deps, providerSubscriptionId: string, why: string): Promise<void> {
  try {
    const payments = await deps.asaas.listSubscriptionPayments(providerSubscriptionId);
    for (const p of payments) {
      if (PAID_STATUSES.has(p.status) && !hasLiveRefund(p)) {
        await deps.asaas.refundPayment(p.id, p.value, 'Tuggi: cobrança duplicada devolvida');
      }
    }
    await deps.asaas.deleteSubscription(providerSubscriptionId);
    await deps.alert(`subscription_discarded:${why}`, { provider_subscription_id: providerSubscriptionId });
  } catch (e) {
    await deps.alert(`subscription_discard_failed:${why}`, {
      provider_subscription_id: providerSubscriptionId,
      error: e instanceof Error ? e.message : 'unknown',
    });
  }
}

// ─── portal: cancel renewal, regret refund, withdrawal ─────────────────────────────────────────

/** Contract §3.3 "Desligar renovação": owner → Asaas DELETE → database. Term 4.5: e-mail "no ato". */
export async function cancelRenewal(deps: PortalDeps, submissionId: string): Promise<Reply> {
  const owner = await ownerRow(deps, submissionId);
  if (isReply(owner)) return owner;
  if (!owner.renews) return reply(200, { result: 'not_renewing' });

  const ids = await deps.subscriptionIds(owner.submission_id);
  if (!ids) return reply(404, { error: 'not_found' });
  try {
    // Asaas first: if the database fails after this, `SUBSCRIPTION_DELETED` closes the same state.
    if (ids.provider_subscription_id) await deps.asaas.deleteSubscription(ids.provider_subscription_id);
  } catch (e) {
    console.error('[places-payment] cancel asaas', e instanceof Error ? e.message : 'unknown');
    return reply(502, { error: 'provider_unavailable' });
  }
  const { data, error } = await deps.admin('partner', 'cancel_place_subscription', {
    p_event_id: null,
    p_event_type: null,
    p_subscription_id: ids.subscription_id,
    p_provider_subscription_id: null,
    p_actor_kind: 'client',
  });
  if (error) {
    if (isBusinessError(error)) return portalErrorReply(error);
    await deps.alert('cancel_failed', { subscription_id: ids.subscription_id, code: error.code });
    return reply(502, { error: 'unavailable' });
  }
  const row = firstRow<{ outcome: string; paid_through: string | null }>(data);

  const to = await deps.userEmail();
  if (to) {
    const until = row?.paid_through ? formatDateBr(row.paid_through) : null;
    const sent = await deps.sendEmail(to, CANCEL_EMAIL.subject, CANCEL_EMAIL.text(until));
    if (!sent) await deps.alert('cancel_email_failed', { subscription_id: ids.subscription_id });
  }
  return reply(200, { result: 'canceled' });
}

/** Regret (BR-B2B-046 item 6) through `core.portal_request_refund`, then the Asaas part. */
export async function requestRefund(deps: PortalDeps, submissionId: string): Promise<Reply> {
  return ownerRefund(deps, submissionId, 'portal_request_refund', {});
}

/** Withdrawal during validation (term 4.2) through `core.portal_withdraw`, then the Asaas part. */
export async function withdraw(deps: PortalDeps, submissionId: string): Promise<Reply> {
  return ownerRefund(deps, submissionId, 'portal_withdraw', { p_note: null });
}

async function ownerRefund(deps: PortalDeps, submissionId: string, fn: string, extra: Record<string, unknown>): Promise<Reply> {
  if (!isUuid(submissionId)) return reply(400, { error: 'invalid', field: 'submission_id' });
  // The `core.portal_*` function proves the owner itself (TGP01 if not theirs).
  const { data, error } = await deps.user('core', fn, { p_submission_id: submissionId, ...extra });
  if (error) return portalErrorReply(error);
  const status = typeof data === 'string' ? data : null;

  // The database already moved: a failure below is retried by the daily sweep, so the owner gets
  // the database's answer either way.
  const ids = await deps.subscriptionIds(submissionId).catch(() => null);
  if (ids?.provider_subscription_id && !ids.canceled_at) {
    // Contract §3.3: a live subscription in `pending_payment` is not in the refund list.
    try {
      await deps.asaas.deleteSubscription(ids.provider_subscription_id);
      await deps.admin('partner', 'cancel_place_subscription', {
        p_event_id: null,
        p_event_type: null,
        p_subscription_id: ids.subscription_id,
        p_provider_subscription_id: null,
        p_actor_kind: 'client',
      });
    } catch {
      // the sweep finds the refund rows; an unpaid live subscription is caught by the next checkout
    }
  }
  const refunds = await pendingRefunds(deps);
  if (refunds) await processRefunds(deps, refunds.filter((r) => r.submission_id === submissionId));
  return reply(200, { result: status });
}

// ─── refunds (portal flows and the sweep) ──────────────────────────────────────────────────────

export type RefundRow = {
  subscription_id: string;
  submission_id: string;
  provider_subscription_id: string | null;
  provider_payment_id: string;
  amount_cents: number;
  paid_on: string | null;
  pending_since: string;
};

async function pendingRefunds(deps: Deps): Promise<RefundRow[] | null> {
  const { data, error } = await deps.admin('partner', 'place_pending_refunds', {});
  if (error) {
    console.error('[places-payment] place_pending_refunds', error.code ?? 'unknown');
    return null;
  }
  return (Array.isArray(data) ? data : []) as RefundRow[];
}

/** Webhook that never arrives: after this long a pending refund is the operator's. */
export const REFUND_STALE_MS = 3 * 24 * 3600 * 1000;

/**
 * Contract §3.3 "Reembolso inacabado". Idempotent by the re-read: a payment with a refund that is
 * not CANCELLED is never asked again (the Asaas refund is asynchronous and a payment accepts more
 * than one; asking twice while the first is PENDING refunds twice).
 */
export async function processRefunds(deps: Deps, rows: RefundRow[]): Promise<{ requested: number; skipped: number; failed: number }> {
  const out = { requested: 0, skipped: 0, failed: 0 };
  const subs = new Set(rows.map((r) => r.provider_subscription_id).filter((s): s is string => !!s));
  for (const s of subs) {
    try {
      await deps.asaas.deleteSubscription(s);
    } catch (e) {
      console.error('[places-payment] refund delete subscription', e instanceof Error ? e.message : 'unknown');
    }
  }
  for (const r of rows) {
    if (deps.now().getTime() - new Date(r.pending_since).getTime() > REFUND_STALE_MS) {
      await deps.alert('refund_stale', { subscription_id: r.subscription_id, provider_payment_id: r.provider_payment_id, pending_since: r.pending_since });
    }
    try {
      const p = await deps.asaas.getPayment(r.provider_payment_id);
      if (hasLiveRefund(p) || !PAID_STATUSES.has(p.status)) {
        out.skipped++;
        if (!hasLiveRefund(p) && !/^REFUND/.test(p.status)) {
          await deps.alert('refund_unexpected_status', { provider_payment_id: p.id, status: p.status });
        }
        continue;
      }
      if (toCents(p.value) < r.amount_cents) {
        out.skipped++;
        await deps.alert('refund_amount_above_charge', { provider_payment_id: p.id, amount_cents: r.amount_cents, value_cents: toCents(p.value) });
        continue;
      }
      await deps.asaas.refundPayment(p.id, toReais(r.amount_cents), 'Tuggi: devolução integral');
      out.requested++;
    } catch (e) {
      out.failed++;
      await deps.alert('refund_failed', { provider_payment_id: r.provider_payment_id, error: e instanceof Error ? e.message : 'unknown' });
    }
  }
  return out;
}

// ─── webhook ───────────────────────────────────────────────────────────────────────────────────

export const ASAAS_TOKEN_HEADER = 'asaas-access-token';

/** Payment events that can move money state; every other event is answered 200 and ignored. */
const PAYMENT_EVENTS = new Set([
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_OVERDUE',
  'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
  'PAYMENT_REFUNDED',
]);
const SUBSCRIPTION_END_EVENTS = new Set(['SUBSCRIPTION_DELETED', 'SUBSCRIPTION_INACTIVATED']);

type PaymentFn = 'confirm_place_charge' | 'fail_place_charge' | 'settle_place_refund';

/** Demand 1: the function follows the RE-READ status. Null = nothing to apply. */
export function paymentAction(eventType: string, status: string): PaymentFn | null {
  if (PAID_STATUSES.has(status)) return 'confirm_place_charge';
  if (status === 'REFUNDED') return 'settle_place_refund';
  if (status === 'OVERDUE') return 'fail_place_charge';
  if (status === 'PENDING' && eventType === 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED') return 'fail_place_charge';
  return null;
}

/** Demand 2: both re-read ids. */
export function paymentArgs(fn: PaymentFn, eventId: string, eventType: string, p: AsaasPayment, today: string) {
  const base = {
    p_event_id: eventId,
    p_event_type: eventType,
    p_subscription_id: subscriptionIdFromReference(p.externalReference),
    p_provider_subscription_id: p.subscription ?? null,
    p_provider_payment_id: p.id,
  };
  if (fn === 'settle_place_refund') return base;
  if (fn === 'confirm_place_charge') {
    return { ...base, p_amount_cents: toCents(p.value), p_paid_on: p.confirmedDate ?? p.paymentDate ?? p.clientPaymentDate ?? today };
  }
  return { ...base, p_amount_cents: toCents(p.value), p_due_date: p.dueDate ?? today };
}

export async function handleAsaasWebhook(
  deps: Deps,
  expectedToken: string,
  providedToken: string | null,
  body: unknown,
): Promise<Reply> {
  // Demand 6. An unset token refuses everyone: "no token" never reads as "no token needed".
  if (!expectedToken || !providedToken || !constantTimeEqual(providedToken, expectedToken)) {
    return reply(401, { error: 'unauthorized' });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const eventId = str(b.id);
  const eventType = str(b.event);
  if (!eventId || !eventType) return reply(400, { error: 'invalid_body' });
  const log = (outcome: string) => console.log('[places-payment-webhook]', eventId, eventType, outcome);

  if (eventType.startsWith('PAYMENT_CHARGEBACK')) {
    // Contract §8: not handled — the operator answers the dispute.
    await deps.alert('chargeback', { event_id: eventId, event_type: eventType, provider_payment_id: str((b.payment as Record<string, unknown>)?.id) });
    log('alerted');
    return reply(200, { outcome: 'alerted' });
  }

  let fn: string;
  let args: Record<string, unknown>;
  try {
    if (PAYMENT_EVENTS.has(eventType)) {
      const paymentId = str((b.payment as Record<string, unknown>)?.id);
      if (!paymentId) return reply(400, { error: 'invalid_body' });
      const p = await deps.asaas.getPayment(paymentId);
      const action = paymentAction(eventType, (p.status ?? '').toUpperCase());
      if (!action) {
        log(`stale:${p.status}`);
        return reply(200, { outcome: 'stale' });
      }
      fn = action;
      args = paymentArgs(action, eventId, eventType, p, deps.today());
    } else if (SUBSCRIPTION_END_EVENTS.has(eventType)) {
      const subId = str((b.subscription as Record<string, unknown>)?.id);
      if (!subId) return reply(400, { error: 'invalid_body' });
      let ended = true;
      let reference: string | null = null;
      try {
        const s = await deps.asaas.getSubscription(subId);
        ended = !!s.deleted || s.status !== 'ACTIVE';
        reference = s.externalReference ?? null;
      } catch (e) {
        if (!(e instanceof AsaasError && e.status === 404)) throw e;
      }
      if (!ended) {
        log('stale:ACTIVE');
        return reply(200, { outcome: 'stale' });
      }
      fn = 'cancel_place_subscription';
      args = {
        p_event_id: eventId,
        p_event_type: eventType,
        p_subscription_id: subscriptionIdFromReference(reference),
        p_provider_subscription_id: subId,
        p_actor_kind: 'provider',
      };
    } else {
      log('ignored');
      return reply(200, { outcome: 'ignored' });
    }
  } catch (e) {
    if (e instanceof AsaasError && e.status === 404) {
      await deps.alert('reread_not_found', { event_id: eventId, event_type: eventType });
      log('reread_not_found');
      return reply(200, { outcome: 'reread_not_found' });
    }
    // Transport failure of the re-read: Asaas resends (see the header).
    console.error('[places-payment-webhook]', eventId, eventType, 'reread_failed', e instanceof Error ? e.message : 'unknown');
    return reply(500, { error: 'reread_failed' });
  }

  if (!args.p_subscription_id && !args.p_provider_subscription_id) {
    await deps.alert('unknown_subscription', { event_id: eventId, event_type: eventType });
    log('unknown_subscription');
    return reply(200, { outcome: 'unknown_subscription' });
  }

  const { data, error } = await deps.admin('partner', fn, args);
  if (error) {
    // Demand 7: a database exception (TGP22 included — our defect, not the event's) → 500, and the
    // event is not recorded, so Asaas' resend reprocesses it.
    console.error('[places-payment-webhook]', eventId, eventType, 'db_error', error.code ?? 'unknown');
    if (error.code === 'TGP22') await deps.alert('webhook_tgp22', { event_id: eventId, event_type: eventType, field: error.details });
    return reply(500, { error: 'db_error' });
  }
  const outcome = firstRow<{ outcome?: string }>(data)?.outcome ?? 'unknown';
  if (ALERT_OUTCOMES.has(outcome)) {
    await deps.alert(outcome, {
      event_id: eventId,
      event_type: eventType,
      function: fn,
      subscription_id: (args.p_subscription_id as string) ?? null,
      provider_subscription_id: (args.p_provider_subscription_id as string) ?? null,
      provider_payment_id: (args.p_provider_payment_id as string) ?? null,
    });
  }
  log(outcome);
  return reply(200, { outcome });
}

// ─── daily sweep ───────────────────────────────────────────────────────────────────────────────

type ExpiredRow = {
  subscription_id: string;
  provider_subscription_id: string | null;
  canceled_at: string | null;
};

type ScheduleRow = {
  subscription_id: string;
  provider_subscription_id: string;
  renewal_amount_cents: number;
  billing_period: number;
  renewal_date: string;
  notice_date: string;
};

/**
 * Contract §3.3, in this order: unfinished refunds, expirations (an expired place must not be
 * charged), then the renewal alignment. Each part runs even if the one before failed.
 */
export async function runSweep(deps: Deps): Promise<Record<string, unknown>> {
  const summary: Record<string, unknown> = {};

  const refunds = await pendingRefunds(deps);
  summary.refunds = refunds ? await processRefunds(deps, refunds) : 'db_error';

  const expired = await deps.admin('partner', 'expire_place_subscriptions', {});
  if (expired.error) {
    summary.expired = 'db_error';
    await deps.alert('sweep_expire_failed', { code: expired.error.code });
  } else {
    let n = 0;
    for (const r of (Array.isArray(expired.data) ? expired.data : []) as ExpiredRow[]) {
      if (!r.provider_subscription_id || r.canceled_at) continue;
      try {
        await deps.asaas.deleteSubscription(r.provider_subscription_id);
        const { error } = await deps.admin('partner', 'cancel_place_subscription', {
          p_event_id: null,
          p_event_type: null,
          p_subscription_id: r.subscription_id,
          p_provider_subscription_id: null,
          p_actor_kind: 'system',
        });
        if (error) throw new Error(`db ${error.code}`);
        n++;
      } catch (e) {
        await deps.alert('sweep_expire_cancel_failed', { subscription_id: r.subscription_id, error: e instanceof Error ? e.message : 'unknown' });
      }
    }
    summary.expired = n;
  }

  const schedule = await deps.admin('partner', 'place_renewal_schedule', {});
  if (schedule.error) {
    summary.aligned = 'db_error';
    await deps.alert('sweep_schedule_failed', { code: schedule.error.code });
  } else {
    let changed = 0;
    for (const r of (Array.isArray(schedule.data) ? schedule.data : []) as ScheduleRow[]) {
      try {
        if (await alignRenewal(deps, r)) changed++;
      } catch (e) {
        await deps.alert('sweep_align_failed', { subscription_id: r.subscription_id, error: e instanceof Error ? e.message : 'unknown' });
      }
    }
    summary.aligned = changed;
  }
  return summary;
}

/**
 * Makes the Asaas subscription charge `renewal_amount_cents` on `renewal_date` and nothing before
 * it. `nextDueDate` does not move a charge Asaas already generated (up to 40 days ahead), so a
 * pending charge for THIS renewal on another date is deleted, and the subscription points either
 * at the renewal (nothing generated yet) or at the one after it (renewal already generated).
 * A pending charge more than half a period after the renewal belongs to the next cycle and stays.
 * Returns true when something was changed.
 */
export async function alignRenewal(deps: Deps, r: ScheduleRow): Promise<boolean> {
  const target = r.renewal_date.slice(0, 10);
  const halfPeriodEnd = shiftDays(target, r.billing_period * 15);
  const pending = await deps.asaas.listSubscriptionPayments(r.provider_subscription_id, 'PENDING');
  let changed = false;

  const match = pending.find((p) => p.dueDate === target) ?? null;
  for (const p of pending) {
    if (p === match || !p.dueDate || p.dueDate >= halfPeriodEnd) continue;
    await deps.asaas.deletePayment(p.id);
    changed = true;
  }

  const sub = await deps.asaas.getSubscription(r.provider_subscription_id);
  const nextDueDate = match ? addMonths(target, r.billing_period) : target;
  const valueOk = toCents(sub.value) === r.renewal_amount_cents && (!match || toCents(match.value) === r.renewal_amount_cents);
  if (sub.nextDueDate !== nextDueDate || !valueOk) {
    await deps.asaas.updateSubscription(r.provider_subscription_id, {
      nextDueDate,
      value: toReais(r.renewal_amount_cents),
      updatePendingPayments: true,
    });
    changed = true;
  }
  return changed;
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── e-mail copy ───────────────────────────────────────────────────────────────────────────────

export function formatDateBr(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** Term 4.5: "a TUGGI confirma o cancelamento por e-mail no ato". */
export const CANCEL_EMAIL = {
  subject: 'Renovação do Com história cancelada',
  text: (until: string | null) =>
    [
      'Olá,',
      '',
      'Cancelamos a renovação automática do plano Com história. Nada mais será cobrado.',
      until
        ? `A história do seu local continua no ar até ${until}. Depois disso, o local segue no mapa do app no plano No mapa, sem custo.`
        : 'O local segue no mapa do app no plano No mapa, sem custo, quando o período pago terminar.',
      '',
      'Se mudar de ideia, contrate um novo período pelo portal.',
      '',
      'Equipe Tuggi',
    ].join('\n'),
};
