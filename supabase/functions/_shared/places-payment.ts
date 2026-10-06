// _shared/places-payment.ts — the payment of the Com história plan (#811, épico #802).
//
// Contract: `docs/contracts/places-pagamento.md` (workspace). Rules: BR-B2B-044, BR-B2B-045,
// BR-B2B-046, BR-B2B-049, BR-B2B-055; term `locais-2026-10-v2`, clauses 4.1–4.7.
//
// Three Edge Functions wire this module and do nothing else:
//   - `places-payment`         the portal's Worker (`x-places-secret` + the user's JWT), or — the
//                              cookie's checkout before any account exists (#863, §7.2 of
//                              `places-portal-rascunho.md`) — `x-places-draft-secret` + the sha256
//                              of the draft cookie (`draftCheckout`, `draftCheckoutPix`);
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
//      the cookie's checkout proves it with the cookie (`portal_draft_payment_checkout`), and every
//      id comes from the database too → `draftPayable`;
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
//
// MONTHLY WITH A COMMITMENT (operator 2026-10-06, #863): every Asaas subscription is `MONTHLY` and
// charges the monthly fee; `billing_period` (1/3/6) is only the commitment length. Turning the
// renewal off does not stop the fees: the subscription runs to the end of the commitment, and the
// sweep sets its `endDate` (`alignRenewal`). Each `PAYMENT_CONFIRMED`/`RECEIVED` is one fee, and
// `confirm_place_charge` checks the amount against it.

import { constantTimeEqual } from './constant-time.ts';
import {
  AsaasError,
  type AsaasClient,
  type AsaasCardHolder,
  type AsaasCreditCard,
  type AsaasPayment,
  type AsaasPixAuthorization,
} from './asaas.ts';

// ─── dependencies ─────────────────────────────────────────────────────────────────────────────

export type DbError = { code?: string | null; details?: string | null; message?: string | null };
export type RpcResult = { data: unknown; error: DbError | null };
export type Rpc = (schema: 'partner' | 'core', fn: string, args: Record<string, unknown>) => Promise<RpcResult>;

/** What the EF needs of `partner.place_subscriptions`, read with `service_role`. */
export type SubscriptionIds = {
  subscription_id: string;
  status: string;
  payment_method: string | null;
  provider_subscription_id: string | null;
  provider_customer_id: string | null;
  provider_authorization_id: string | null;
  canceled_at: string | null;
};

export type Deps = {
  asaas: AsaasClient;
  /** `service_role`. */
  admin: Rpc;
  subscriptionIds: (submissionId: string) => Promise<SubscriptionIds | null>;
  /** Same row, by `partner.place_subscriptions.id` (the uuid of `externalReference`/`contractId`). */
  subscriptionById: (subscriptionId: string) => Promise<SubscriptionIds | null>;
  /** Operator alert. Fields are ids and outcomes only — never a name, a document or an e-mail. */
  alert: (what: string, fields: Record<string, string | number | null | undefined>) => Promise<void>;
  /** Today in America/Sao_Paulo, `YYYY-MM-DD`. */
  today: () => string;
  now: () => Date;
  /** `place_subscriptions.acceptance_id → place_acceptances.submission_id`, by our id or Asaas' `sub_…`. */
  submissionOfSubscription: (subscriptionId: string | null, providerSubscriptionId: string | null) => Promise<string | null>;
  /** `issueAccessLink` of `places-portal-draft.ts` (#863, §7.3): the access e-mail of a settled submission. */
  accessLink: (submissionId: string) => Promise<'sent' | 'owned' | 'failed'>;
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

/**
 * Pix Automático `contractId` (max 35 chars, so the uuid without hyphens). It is the only field of
 * the authorization we set and Asaas gives back on the re-read: it maps the authorization to
 * `partner.place_subscriptions` before there is an Asaas subscription to map it by.
 */
export const contractIdOf = (subscriptionId: string): string => subscriptionId.replace(/-/g, '').toLowerCase();
export function subscriptionIdFromContractId(contractId: unknown): string | null {
  if (typeof contractId !== 'string' || !/^[0-9a-f]{32}$/i.test(contractId.trim())) return null;
  const h = contractId.trim().toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const PAID_STATUSES = new Set(['CONFIRMED', 'RECEIVED']);
/** Refunds that exist or may still land. Only a CANCELLED refund lets us ask again. */
export const hasLiveRefund = (p: AsaasPayment): boolean =>
  (p.refunds ?? []).some((r) => (r?.status ?? '').toUpperCase() !== 'CANCELLED');

export const ALERT_OUTCOMES = new Set(['amount_mismatch', 'subscription_mismatch', 'unknown_subscription', 'not_applicable']);

/**
 * Database names of migration `20261006130000` (data, #863) — PROVISIONAL: swap them here, and only
 * here, when `docs/contracts/places-portal-rascunho.md` names them.
 */
export const COMMITMENT_DB = {
  /** `partner.<fn>(p_subscription_id uuid, p_actor_kind text) → outcome, paid_through`: renewal off, the fees go on. */
  stopRenewal: 'stop_place_renewal',
  /** Column of `partner.place_renewal_schedule()`: the day the commitment ends when it will NOT renew (null = renews). */
  endsOn: 'commitment_ends_on',
} as const;

/** Months between two charges of an Asaas cycle (`MONTHLY` since 2026-10-06). */
export const FREQUENCY_MONTHS: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, SEMIANNUALLY: 6 };
export const cycleMonths = (cycle: string | null | undefined): number => FREQUENCY_MONTHS[(cycle ?? '').toUpperCase()] ?? 1;

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

/** Asaas sandbox approval card (docs.asaas.com, "Testando pagamento com cartão de crédito"). It fails
 * Luhn; the production Asaas refuses it, so letting it through only skips our pre-check. */
const ASAAS_SANDBOX_APPROVED_CARD = '4444444444444444';

function luhn(digits: string): boolean {
  if (digits === ASAAS_SANDBOX_APPROVED_CARD) return true;
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
  if (!isUuid(b.submission_id)) return { invalid: 'submission_id' };
  const card = parseCardInput(b, today);
  return 'invalid' in card ? card : { submissionId: (b.submission_id as string).toLowerCase(), ...card };
}

/** The card, its holder and the payer's IP: the whole checkout body but the submission. */
export function parseCardInput(body: unknown, today: string): Omit<CheckoutInput, 'submissionId'> | { invalid: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const card = (b.card ?? {}) as Record<string, unknown>;
  const holder = (b.holder ?? {}) as Record<string, unknown>;

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
 * Card subscription, `MONTHLY` (contract §3.1). The first fee is due today and Asaas charges it on
 * creation; the next fees are realigned to the approval by the daily sweep.
 *
 * FIRST FEE WITH A COUPON (contract §8): the subscription is created with `value` = the FIRST fee
 * (`next_amount_cents`). The sweep sets `value` = `renewal_amount_cents` on the first run after
 * approval, before the second fee is due. No second payment method, no token kept by us.
 */
export async function checkout(deps: PortalDeps, body: unknown): Promise<Reply> {
  const input = parseCheckoutInput(body, deps.today());
  if ('invalid' in input) return reply(400, { error: 'invalid', field: input.invalid });

  const owner = await ownerRow(deps, input.submissionId);
  if (isReply(owner)) return owner;
  const co = await payableCheckout(deps, owner.submission_id);
  if (isReply(co)) return co;
  return chargeCard(deps, owner.submission_id, co, input);
}

/**
 * The cookie's card checkout (#863, contract §7.2): accepted by clickwrap, no account yet. The
 * submission and every id come from `portal_draft_payment_checkout(sha256 of the cookie)`; a
 * `submission_id` in the body is ignored. Holder phone, postal code, number and document still come
 * from the card form — the database gives none of them to a cookie.
 */
export async function draftCheckout(deps: Deps, body: unknown, tokenSha256: string): Promise<Reply> {
  const input = parseCardInput(body, deps.today());
  if ('invalid' in input) return reply(400, { error: 'invalid', field: input.invalid });
  const co = await draftPayable(deps, tokenSha256);
  if (isReply(co)) return co;
  return chargeCard(deps, co.submission_id, co, input);
}

async function chargeCard(deps: Deps, submissionId: string, co: CheckoutRow, input: Omit<CheckoutInput, 'submissionId'>): Promise<Reply> {
  try {
    const customer = await prepareCustomer(deps, submissionId, co);
    if (isReply(customer)) return customer;

    let created;
    try {
      created = await deps.asaas.createCardSubscription({
        customer: customer.id,
        value: toReais(co.next_amount_cents),
        nextDueDate: co.next_due_date!,
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
    await holdNextChargeUntilApproval(deps, created.id, co.next_due_date!, cycleMonths(co.billing_cycle), payments);
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

/** `place_payment_checkout`, refused unless there is a first period to pay now. */
async function payableCheckout(deps: Deps, submissionId: string): Promise<CheckoutRow | Reply> {
  const { data, error } = await deps.admin('partner', 'place_payment_checkout', { p_submission_id: submissionId });
  if (error) return isBusinessError(error) ? portalErrorReply(error) : reply(502, { error: 'unavailable' });
  return payableRow(firstRow<CheckoutRow>(data));
}

/** Null `next_due_date` = paid and waiting for approval; not `pending_payment` = nothing to pay. */
function payableRow<T extends CheckoutRow>(co: T | null): T | Reply {
  if (!co) return reply(502, { error: 'unavailable' });
  if (co.status !== 'pending_payment' || !co.attachable || !co.next_due_date) {
    return reply(409, { error: 'not_payable', reason: co.status });
  }
  return co;
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * `portal_draft_payment_checkout` (§7.2): the same columns as `place_payment_checkout`, plus the
 * submission. `TGP10` (`not_accepted`, or the status of a submission with no paid plan) →
 * `409 not_payable` + `reason`, like the signed-in checkout; `TGP01` (no such cookie) → 404.
 */
async function draftPayable(deps: Deps, tokenSha256: string): Promise<(CheckoutRow & { submission_id: string }) | Reply> {
  if (!HEX64.test(tokenSha256)) return reply(400, { error: 'invalid', field: 'token_sha256' });
  const { data, error } = await deps.admin('partner', 'portal_draft_payment_checkout', { p_token_sha256: tokenSha256 });
  if (error) {
    if (error.code === 'TGP10') return reply(409, { error: 'not_payable', reason: error.details ?? null });
    return isBusinessError(error) ? portalErrorReply(error) : reply(502, { error: 'unavailable' });
  }
  const co = firstRow<CheckoutRow & { submission_id: string }>(data);
  if (co && !isUuid(co.submission_id)) return reply(502, { error: 'unavailable' });
  return payableRow(co);
}

/**
 * Common to both methods, before anything new is created in Asaas: demand 5 (a live subscription
 * already PAID is attached, not charged again; an unpaid one is ended), then the customer, then
 * any Pix QR of an earlier attempt is cancelled — switching method must not leave a second way
 * to pay the same period open. Asaas errors propagate (the callers answer `provider_unavailable`).
 */
async function prepareCustomer(deps: Deps, submissionId: string, co: CheckoutRow): Promise<{ id: string } | Reply> {
  const settled = await clearLiveSubscriptions(deps, submissionId, co);
  if (settled) return settled;
  const customer =
    (await deps.asaas.findCustomerByReference(co.subscription_id)) ??
    (await deps.asaas.createCustomer({
      name: co.customer_name,
      cpfCnpj: co.customer_tax_id.replace(/[.\-/\s]/g, '').toUpperCase(),
      email: co.customer_email,
      externalReference: co.subscription_id,
    }));
  await cancelOpenPixAuthorizations(deps, customer.id);
  return customer;
}

/**
 * Authorizations still waiting for the QR to be paid (`CREATED`) are cancelled. Best effort: if it
 * fails, the old QR still expires in `PIX_QR_EXPIRATION_SECONDS`, and paying it after another
 * payment lands as `not_applicable`, which alerts the operator to refund.
 */
async function cancelOpenPixAuthorizations(deps: Deps, customerId: string): Promise<void> {
  try {
    const open = (await deps.asaas.listPixAutomaticAuthorizations(customerId)).filter(
      (a) => a.customerId === customerId && (a.status ?? '').toUpperCase() === 'CREATED',
    );
    for (const a of open) await deps.asaas.cancelPixAutomaticAuthorization(a.id);
  } catch (e) {
    console.error('[places-payment] cancel open pix authorizations', e instanceof Error ? e.message : 'unknown');
  }
}

// ─── portal: checkout (Pix Automático) ─────────────────────────────────────────────────────────

/** Seconds the QR of the first charge stays payable; the portal polls for as long. */
export const PIX_QR_EXPIRATION_SECONDS = 30 * 60;

export type PixQr = { payload: string; image: string | null; expires_at: string | null };

export function pixQrOf(a: AsaasPixAuthorization): PixQr | null {
  const payload = a.payload ?? a.immediateQrCode?.payload ?? null;
  if (!payload) return null;
  return {
    payload,
    image: a.encodedImage ?? a.immediateQrCode?.encodedImage ?? null,
    expires_at: a.immediateQrCode?.expirationDate ?? null,
  };
}

/**
 * Pix Automático, journey 3 (term 4.1; contract §3.1): one QR pays the first period
 * (`immediateQrCode.originalValue` = `next_amount_cents`, coupon included) and authorizes the
 * renewals (`value` = `renewal_amount_cents`, `paymentCreationMode: SUBSCRIPTION`).
 *
 * NOTHING IS ATTACHED HERE. Asaas creates the subscription only when the payer's bank activates the
 * authorization, so `attach_place_subscription` (which needs the `sub_…`) runs in the webhook, on
 * `PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED`. The first charge is confirmed before that, by
 * its `PAYMENT_RECEIVED`, mapped through the customer's `externalReference` (see the webhook).
 *
 * `startDate` = one period after today: the recurrence never starts before the earliest possible
 * renewal (approval + N months), and the sweep moves the renewal to the right date after approval.
 */
export async function checkoutPix(deps: PortalDeps, body: unknown): Promise<Reply> {
  const submissionId = (body as Record<string, unknown> | null)?.submission_id;
  if (!isUuid(submissionId)) return reply(400, { error: 'invalid', field: 'submission_id' });
  const owner = await ownerRow(deps, submissionId.toLowerCase());
  if (isReply(owner)) return owner;
  const co = await payableCheckout(deps, owner.submission_id);
  if (isReply(co)) return co;
  return pixQr(deps, owner.submission_id, co);
}

/** The cookie's Pix checkout (#863, §7.2): the same QR, the submission from the cookie. */
export async function draftCheckoutPix(deps: Deps, tokenSha256: string): Promise<Reply> {
  const co = await draftPayable(deps, tokenSha256);
  if (isReply(co)) return co;
  return pixQr(deps, co.submission_id, co);
}

async function pixQr(deps: Deps, submissionId: string, co: CheckoutRow): Promise<Reply> {
  try {
    const customer = await prepareCustomer(deps, submissionId, co);
    if (isReply(customer)) return customer;
    const description = `Tuggi Com história ${co.billing_period} ${co.billing_period === 1 ? 'mês' : 'meses'}`;
    const auth = await deps.asaas.createPixAutomaticAuthorization({
      customerId: customer.id,
      contractId: contractIdOf(co.subscription_id),
      description,
      frequency: co.billing_cycle,
      startDate: addMonths(co.next_due_date!, cycleMonths(co.billing_cycle)),
      value: toReais(co.renewal_amount_cents),
      immediateQrCode: {
        expirationSeconds: PIX_QR_EXPIRATION_SECONDS,
        originalValue: toReais(co.next_amount_cents),
        description,
      },
    });
    const qr = pixQrOf(auth);
    if (!qr) {
      await deps.alert('pix_qr_missing', { subscription_id: co.subscription_id, authorization_id: auth.id });
      await deps.asaas.cancelPixAutomaticAuthorization(auth.id).catch(() => true);
      return reply(502, { error: 'provider_unavailable' });
    }
    return reply(200, { result: 'pix', pix: qr });
  } catch (e) {
    if (e instanceof AsaasError) {
      console.error('[places-payment] checkout_pix asaas', e.message);
      return reply(502, { error: 'provider_unavailable' });
    }
    throw e;
  }
}

/** Ends the provider side of a subscription: the Asaas subscription and, on Pix, the authorization. */
async function endProviderSubscription(
  deps: Deps,
  ids: { provider_subscription_id: string | null; provider_authorization_id?: string | null },
): Promise<void> {
  if (ids.provider_subscription_id) await deps.asaas.deleteSubscription(ids.provider_subscription_id);
  if (ids.provider_authorization_id) await deps.asaas.cancelPixAutomaticAuthorization(ids.provider_authorization_id);
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
async function clearLiveSubscriptions(deps: Deps, submissionId: string, co: CheckoutRow): Promise<Reply | null> {
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
      const pix = id === ids?.provider_subscription_id && ids?.payment_method === 'pix_automatic';
      const { error } = await deps.admin('partner', 'attach_place_subscription', {
        p_subscription_id: co.subscription_id,
        p_payment_method: pix ? 'pix_automatic' : 'credit_card',
        p_provider_customer_id: customer,
        p_provider_subscription_id: id,
        p_provider_authorization_id: pix ? ids?.provider_authorization_id ?? null : null,
      });
      if (error && !(error.code === 'TGP10')) {
        await deps.alert('attach_failed', { subscription_id: co.subscription_id, provider_subscription_id: id, code: error.code });
        return reply(502, { error: 'unavailable' });
      }
      return reply(200, { result: 'paid' });
    }
  }

  for (const id of candidates.keys()) {
    await endProviderSubscription(deps, {
      provider_subscription_id: id,
      provider_authorization_id: id === ids?.provider_subscription_id ? ids?.provider_authorization_id : null,
    });
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

/**
 * Contract §3.3 "Desligar renovação": owner → database. Nothing in Asaas here: the fees go on to
 * the end of the commitment, and the sweep sets the subscription's `endDate` (`alignRenewal`).
 * Term 4.5: e-mail "no ato".
 */
export async function cancelRenewal(deps: PortalDeps, submissionId: string): Promise<Reply> {
  const owner = await ownerRow(deps, submissionId);
  if (isReply(owner)) return owner;
  if (!owner.renews) return reply(200, { result: 'not_renewing' });

  const ids = await deps.subscriptionIds(owner.submission_id);
  if (!ids) return reply(404, { error: 'not_found' });
  const { data, error } = await deps.admin('partner', COMMITMENT_DB.stopRenewal, {
    p_subscription_id: ids.subscription_id,
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
      await endProviderSubscription(deps, ids);
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
/** A recurring Pix charge the payer's bank refused to schedule or settle (contract §3.2: `fail`). */
const PIX_INSTRUCTION_REFUSED = 'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_REFUSED';
const PIX_AUTHORIZATION_ACTIVATED = 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED';
const PIX_AUTHORIZATION_END_EVENTS = new Set([
  'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED',
  'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_EXPIRED',
  'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED',
]);

type PaymentFn = 'confirm_place_charge' | 'fail_place_charge' | 'settle_place_refund';

/** Demand 1: the function follows the RE-READ status. Null = nothing to apply. */
export function paymentAction(eventType: string, status: string): PaymentFn | null {
  if (PAID_STATUSES.has(status)) return 'confirm_place_charge';
  if (status === 'REFUNDED') return 'settle_place_refund';
  if (status === 'OVERDUE') return 'fail_place_charge';
  if (status === 'PENDING' && (eventType === 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED' || eventType === PIX_INSTRUCTION_REFUSED)) {
    return 'fail_place_charge';
  }
  return null;
}

/** Demand 2: both re-read ids (`ids` overrides them when they were resolved from the customer). */
export function paymentArgs(
  fn: PaymentFn,
  eventId: string,
  eventType: string,
  p: AsaasPayment,
  today: string,
  ids?: { subscriptionId: string | null; providerSubscriptionId: string | null },
) {
  const base = {
    p_event_id: eventId,
    p_event_type: eventType,
    p_subscription_id: ids ? ids.subscriptionId : subscriptionIdFromReference(p.externalReference),
    p_provider_subscription_id: ids ? ids.providerSubscriptionId : p.subscription ?? null,
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
    if (PAYMENT_EVENTS.has(eventType) || eventType === PIX_INSTRUCTION_REFUSED) {
      const paymentId =
        eventType === PIX_INSTRUCTION_REFUSED
          ? str((b.paymentInstruction as Record<string, unknown>)?.paymentId)
          : str((b.payment as Record<string, unknown>)?.id);
      if (!paymentId) return reply(400, { error: 'invalid_body' });
      const p = await deps.asaas.getPayment(paymentId);
      const action = paymentAction(eventType, (p.status ?? '').toUpperCase());
      if (!action) {
        log(`stale:${p.status}`);
        return reply(200, { outcome: 'stale' });
      }
      fn = action;
      args = paymentArgs(action, eventId, eventType, p, deps.today(), await chargeIds(deps, p));
    } else if (eventType === PIX_AUTHORIZATION_ACTIVATED) {
      return await pixAuthorizationActivated(deps, b, eventId, eventType, log);
    } else if (PIX_AUTHORIZATION_END_EVENTS.has(eventType)) {
      const authId = str((b.authorization as Record<string, unknown>)?.id);
      if (!authId) return reply(400, { error: 'invalid_body' });
      const a = await deps.asaas.getPixAutomaticAuthorization(authId);
      if ((a.status ?? '').toUpperCase() === 'ACTIVE') {
        log('stale:ACTIVE');
        return reply(200, { outcome: 'stale' });
      }
      const ref = subscriptionIdFromContractId(a.contractId);
      const row = ref ? await deps.subscriptionById(ref) : null;
      if (!ref || !row) {
        await deps.alert('unknown_subscription', { event_id: eventId, event_type: eventType, authorization_id: a.id });
        log('unknown_subscription');
        return reply(200, { outcome: 'unknown_subscription' });
      }
      // Only the authorization that renews this plan ends the renewal: the attached one, or — when
      // none is attached yet — the one whose QR paid the period (consent refused after the money).
      // An old QR that expired after the owner paid some other way is noise.
      const attached = row.provider_authorization_id === a.id;
      const paidUnattached = !row.provider_subscription_id && (row.status === 'paid' || row.status === 'past_due');
      if (!attached && !paidUnattached) {
        log('stale:not_attached');
        return reply(200, { outcome: 'stale' });
      }
      // The Asaas subscription of an ended authorization would only generate charges nobody can pay.
      if (attached && row.provider_subscription_id) await deps.asaas.deleteSubscription(row.provider_subscription_id);
      fn = 'cancel_place_subscription';
      args = {
        p_event_id: eventId,
        p_event_type: eventType,
        p_subscription_id: ref,
        p_provider_subscription_id: row.provider_subscription_id,
        p_actor_kind: 'provider',
      };
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
  const row = firstRow<{ outcome?: string; submission_status?: string }>(data);
  const outcome = row?.outcome ?? 'unknown';
  // #863 (§7.3 b): the first charge moved an ownerless submission to `in_review` — the access link
  // goes now, from the server, whether or not the tab that paid is still open. Only on `applied`:
  // a resend is `duplicate_event`, and the RECEIVED after the CONFIRMED of the same charge is
  // `duplicate_charge`, so one charge sends one e-mail (a second would expire the first link).
  const link = fn === 'confirm_place_charge' && outcome === 'applied' && row?.submission_status === 'in_review' ? await accessLinkAfterPayment(deps, args, eventId, eventType) : null;
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
  log(link ? `${outcome} link:${link}` : outcome);
  return reply(200, { outcome });
}

/**
 * Best effort, and never a 500: the charge is already recorded, so a resend would only be a
 * `duplicate_event` and send nothing. A failure alerts the operator; the owner still has
 * "Reenviar o link" in the paying tab and the sign-in by e-mail, which issues a new access link.
 */
async function accessLinkAfterPayment(deps: Deps, args: Record<string, unknown>, eventId: string, eventType: string): Promise<'sent' | 'owned' | 'failed'> {
  const subscriptionId = typeof args.p_subscription_id === 'string' ? args.p_subscription_id : null;
  const providerSubscriptionId = typeof args.p_provider_subscription_id === 'string' ? args.p_provider_subscription_id : null;
  let r: 'sent' | 'owned' | 'failed' = 'failed';
  try {
    const submissionId = await deps.submissionOfSubscription(subscriptionId, providerSubscriptionId);
    if (submissionId) r = await deps.accessLink(submissionId);
  } catch (e) {
    console.error('[places-payment-webhook]', eventId, eventType, 'access_link', e instanceof Error ? e.message.slice(0, 120) : 'unknown');
  }
  if (r === 'failed') await deps.alert('access_link_failed', { event_id: eventId, event_type: eventType, subscription_id: subscriptionId, provider_subscription_id: providerSubscriptionId });
  return r;
}

/**
 * The two ids of a re-read charge. A card charge carries `externalReference` (we send it). A Pix
 * Automático charge is generated by Asaas from the authorization and carries neither our reference
 * nor — for the first, immediate charge — a subscription we have attached (the `sub_…` exists only
 * after the activation, which comes AFTER `PAYMENT_RECEIVED`). So, without a reference, the plan is
 * found through the customer, whose `externalReference` is our uuid (one customer per plan, created
 * in `prepareCustomer`); and while nothing is attached, `p_provider_subscription_id` goes null, or
 * the database would call the first charge a `subscription_mismatch` and drop the payment.
 */
async function chargeIds(deps: Deps, p: AsaasPayment): Promise<{ subscriptionId: string | null; providerSubscriptionId: string | null }> {
  const ref = subscriptionIdFromReference(p.externalReference);
  if (ref || !p.customer) return { subscriptionId: ref, providerSubscriptionId: p.subscription ?? null };
  const c = await deps.asaas.getCustomer(p.customer);
  const viaCustomer = isUuid(c.externalReference) ? c.externalReference.toLowerCase() : null;
  if (!viaCustomer) return { subscriptionId: null, providerSubscriptionId: p.subscription ?? null };
  const row = await deps.subscriptionById(viaCustomer);
  return { subscriptionId: viaCustomer, providerSubscriptionId: row?.provider_subscription_id ? p.subscription ?? null : null };
}

/**
 * `PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED`: the payer's bank consented and Asaas created
 * the subscription. Re-read, then `attach_place_subscription` with the re-read ids. Idempotent by
 * state, not by event id (the attach records no event): an authorization already attached is a
 * `duplicate_event`, and nothing is touched — a resend must never re-hold a charge the sweep aligned.
 */
async function pixAuthorizationActivated(
  deps: Deps,
  b: Record<string, unknown>,
  eventId: string,
  eventType: string,
  log: (outcome: string) => void,
): Promise<Reply> {
  const authId = str((b.authorization as Record<string, unknown>)?.id);
  if (!authId) return reply(400, { error: 'invalid_body' });
  const a = await deps.asaas.getPixAutomaticAuthorization(authId);
  if ((a.status ?? '').toUpperCase() !== 'ACTIVE') {
    log(`stale:${a.status}`);
    return reply(200, { outcome: 'stale' });
  }
  const ref = subscriptionIdFromContractId(a.contractId);
  const row = ref ? await deps.subscriptionById(ref) : null;
  if (!ref || !row || !a.customerId) {
    await deps.alert('unknown_subscription', { event_id: eventId, event_type: eventType, authorization_id: a.id });
    log('unknown_subscription');
    return reply(200, { outcome: 'unknown_subscription' });
  }
  if (!a.subscriptionId) {
    // The doc says the subscription is born with the activation; if the re-read races it, Asaas resends.
    console.error('[places-payment-webhook]', eventId, eventType, 'subscription_not_ready');
    return reply(500, { error: 'subscription_not_ready' });
  }
  if (row.provider_authorization_id === a.id && row.provider_subscription_id === a.subscriptionId) {
    log('duplicate_event');
    return reply(200, { outcome: 'duplicate_event' });
  }

  const { error } = await deps.admin('partner', 'attach_place_subscription', {
    p_subscription_id: ref,
    p_payment_method: 'pix_automatic',
    p_provider_customer_id: a.customerId,
    p_provider_subscription_id: a.subscriptionId,
    p_provider_authorization_id: a.id,
  });
  if (error) {
    if (error.code === 'TGP10' || error.code === 'TGP01') {
      // Another live subscription (the owner paid by card meanwhile), a refunded plan (withdrawal
      // before the activation) or no plan: this authorization would charge for nothing.
      await endProviderSubscription(deps, { provider_subscription_id: a.subscriptionId, provider_authorization_id: a.id });
      await deps.alert('pix_authorization_discarded', { event_id: eventId, subscription_id: ref, authorization_id: a.id, reason: error.details ?? error.code });
      log('discarded');
      return reply(200, { outcome: 'discarded' });
    }
    console.error('[places-payment-webhook]', eventId, eventType, 'db_error', error.code ?? 'unknown');
    if (error.code === 'TGP22') await deps.alert('webhook_tgp22', { event_id: eventId, event_type: eventType, field: error.details });
    return reply(500, { error: 'db_error' });
  }
  // Same as the card checkout: no renewal before the approval; the sweep aligns it after.
  const months = FREQUENCY_MONTHS[(a.frequency ?? '').toUpperCase()];
  const payments = months ? await deps.asaas.listSubscriptionPayments(a.subscriptionId).catch(() => null) : null;
  if (months && payments) await holdNextChargeUntilApproval(deps, a.subscriptionId, deps.today(), months, payments);
  else await deps.alert('hold_next_charge_failed', { provider_subscription_id: a.subscriptionId, error: months ? 'list_failed' : `frequency ${a.frequency}` });
  log('applied');
  return reply(200, { outcome: 'applied' });
}

// ─── daily sweep ───────────────────────────────────────────────────────────────────────────────

type ExpiredRow = {
  subscription_id: string;
  payment_method: string | null;
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
} & { [COMMITMENT_DB.endsOn]?: string | null };

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
        // Pix: the authorization too, or the payer's bank keeps showing a live consent.
        const auth = r.payment_method === 'pix_automatic' ? (await deps.subscriptionById(r.subscription_id))?.provider_authorization_id : null;
        await endProviderSubscription(deps, { provider_subscription_id: r.provider_subscription_id, provider_authorization_id: auth });
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
 * pending charge for THIS fee on another date is deleted, and the subscription points either at the
 * fee (nothing generated yet) or at the one after it (fee already generated). A pending charge more
 * than half a cycle after the fee belongs to the next cycle and stays. The cycle is the one Asaas
 * holds (`MONTHLY` since 2026-10-06).
 *
 * END OF THE COMMITMENT (`COMMITMENT_DB.endsOn`, renewal off): `endDate` = the day before it, so
 * Asaas generates no fee after the commitment, and a pending charge due on or after it is deleted.
 * `endDate` and not `DELETE /subscriptions`: the DELETE also removes the pending or overdue fees of
 * the recurrence (docs.asaas.com/reference/remove-subscription), which would forgive the fees the
 * commitment still owes. The expiry (`expire_place_subscriptions`) deletes it after the end.
 * Returns true when something was changed.
 */
export async function alignRenewal(deps: Deps, r: ScheduleRow): Promise<boolean> {
  const target = r.renewal_date.slice(0, 10);
  const end = r[COMMITMENT_DB.endsOn]?.slice(0, 10) ?? null;
  const renews = !end || target < end;
  const sub = await deps.asaas.getSubscription(r.provider_subscription_id);
  const months = cycleMonths(sub.cycle);
  const halfCycleEnd = shiftDays(target, months * 15);
  const pending = await deps.asaas.listSubscriptionPayments(r.provider_subscription_id, 'PENDING');
  let changed = false;

  const match = renews ? pending.find((p) => p.dueDate === target) ?? null : null;
  for (const p of pending) {
    if (p === match || !p.dueDate) continue;
    const early = renews && p.dueDate < halfCycleEnd;
    const afterEnd = !!end && p.dueDate >= end;
    if (!early && !afterEnd) continue;
    await deps.asaas.deletePayment(p.id);
    changed = true;
  }

  const patch: { nextDueDate?: string; value?: number; endDate?: string; updatePendingPayments?: boolean } = {};
  if (renews) {
    const nextDueDate = match ? addMonths(target, months) : target;
    const valueOk = toCents(sub.value) === r.renewal_amount_cents && (!match || toCents(match.value) === r.renewal_amount_cents);
    if (sub.nextDueDate !== nextDueDate || !valueOk) {
      Object.assign(patch, { nextDueDate, value: toReais(r.renewal_amount_cents), updatePendingPayments: true });
    }
  }
  const endDate = end ? shiftDays(end, -1) : null;
  if (endDate && sub.endDate !== endDate) patch.endDate = endDate;
  if (Object.keys(patch).length) {
    await deps.asaas.updateSubscription(r.provider_subscription_id, patch);
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
      'Cancelamos a renovação automática do plano Com história. As mensalidades seguem até o fim da fidelidade, e nada é cobrado depois disso.',
      until
        ? `A história do seu local continua no ar até ${until}. Depois disso, o local segue no mapa do app no plano No mapa, sem custo.`
        : 'Quando a fidelidade terminar, o local segue no mapa do app no plano No mapa, sem custo.',
      '',
      'Se mudar de ideia, contrate um novo período pelo portal.',
      '',
      'Equipe Tuggi',
    ].join('\n'),
};
