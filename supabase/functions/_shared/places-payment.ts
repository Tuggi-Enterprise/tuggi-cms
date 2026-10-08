// _shared/places-payment.ts — the payment of the Com história plan (#811, épico #802).
//
// Contract: `docs/contracts/places-pagamento.md` (workspace). Rules: BR-B2B-044, BR-B2B-045,
// BR-B2B-046, BR-B2B-049, BR-B2B-055; term `locais-2026-10-v7`, clauses 4.1–4.7.
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
//      (#914: not the `subscription_mismatch` of a SUBSCRIPTION_DELETED/INACTIVATED — a replaced sub_.)
//
// RE-READ THAT FAILS IN TRANSIT IS A 500 TOO. Demand 7 bars a 500 for a business outcome — that
// would make Asaas resend forever and pause the queue after 15 failures. A timeout reading the
// payment is not an outcome: answering 200 would drop a paid charge on the floor, and the place
// would pay and stay in `awaiting_payment`. A 404 on the re-read IS an answer (the object does not
// exist: a forged or foreign event) → 200 + alert.
//
// MONTHLY WITH A COMMITMENT (operator 2026-10-06, #863, BR-B2B-045/046, contract
// places-portal-rascunho §8): every Asaas subscription is `MONTHLY` and charges one fee; every date
// sum is ONE month; `billing_period` (1/3/6) is only the commitment length. Each
// `PAYMENT_CONFIRMED`/`RECEIVED` is one fee, checked by `confirm_place_charge`; after it,
// `syncNextAmount` moves `value` to the next fee (voucher diluted).
//
// FREE FIRST MONTH (operator 2026-10-07, #898, BR-B2B-046): the checkout charges nothing. Card and
// Pix both create a MONTHLY Asaas subscription whose first fee falls due on the `next_due_date` of
// `place_payment_checkout` — the DATABASE owns the 30 days (`partner.place_trial_ends_at`, acceptance
// + 30, São Paulo; one trial per place) and the EF does no date arithmetic. Attaching it sends the
// submission to validation at once (the database does it inside the attach). Card: Asaas validates the card on creation and charges on
// `nextDueDate` unless it is today (https://docs.asaas.com/docs/criando-assinatura-com-cartao-de-credito).
// Pix: `billingType: PIX`, an ordinary charge per fee, paid by hand (not Pix Automático, whose only
// journey on Asaas charges at once); the Pix customer gets the Asaas notifications, the only thing
// that hands them the QR. A fee unpaid on its date is `PAYMENT_OVERDUE` → `fail_place_charge`, the
// same for both (BR-B2B-019). Cancelling inside the free month deletes the Asaas subscription and
// leaves the row alone: the story stays up to the end of the free month (BR-B2B-046 item 9,
// `place_story_entitled`) and the sweep ends the row when `expire_place_subscriptions` returns it.
// An acceptance with no trial (the same place again, BR-B2B-046 item 1, or made before pricing
// 2026-10-07) gets `next_due_date` = today: Asaas charges the card at once, and the Pix charge is due
// today (`paid`/`processing`; #914: the Pix answer carries that charge's QR, `pix`).
//
// CANCEL (operator 2026-10-06, places-portal-rascunho §8.4): it takes effect at once — no new fee,
// the story stays up to `paid_through`. Inside the commitment the database prices ONE charge, the
// discount given on the months used (`early_termination_fee_cents`), due on `paid_through` by the
// same method (`cancelRenewal`). The cancellation never waits for that charge (CDC art. 39); an
// unpaid one is not chased (BR-B2B-046 item 7).

import { constantTimeEqual } from './constant-time.ts';
import {
  cancelPaymentInvoices,
  invoiceAfterPayment,
  handleInvoiceEvent,
  reconcileInvoices,
  type InvoiceDeps,
  type InvoiceTarget,
} from './places-invoice.ts';
import { handleTransferEvent, reconcileSentPayouts, type SentPayout } from './places-payout.ts';
import { ACCESS_FROM_NAME, portalMail } from './places-portal-draft.ts';
import {
  LEGACY_ASAAS_SPACING_MS,
  LEGACY_SUBSCRIPTION_PREFIX,
  findLiveLegacySubscriptions,
  isLegacySubscriptionReference,
  nextLegacyDueDate,
} from './places-legacy-customers.ts';
export { nextLegacyDueDate };
import {
  AsaasError,
  type AsaasClient,
  type AsaasCardHolder,
  type AsaasCreditCard,
  type AsaasCustomerAddress,
  type AsaasPayment,
  type AsaasSubscription,
} from './asaas.ts';

// ─── dependencies ─────────────────────────────────────────────────────────────────────────────

export type DbError = { code?: string | null; details?: string | null; message?: string | null };
export type RpcResult = { data: unknown; error: DbError | null };
export type Rpc = (schema: 'partner' | 'core', fn: string, args: Record<string, unknown>) => Promise<RpcResult>;

/** What the EF needs of `partner.place_subscriptions`, read with `service_role`. */
/** `pix` = Asaas subscription paid by Pix (#898); `pix_automatic` = journey 3, only on older plans. */
export type PaymentMethod = 'credit_card' | 'pix' | 'pix_automatic';

/** Methods whose fees are charges of the Asaas subscription itself (`value`/`endDate` move them): not Pix Automático. */
export const chargedBySubscription = (method: string | null | undefined): boolean => method === 'credit_card' || method === 'pix';

export type SubscriptionIds = {
  subscription_id: string;
  status: string;
  payment_method: string | null;
  provider_subscription_id: string | null;
  provider_customer_id: string | null;
  provider_authorization_id: string | null;
  canceled_at: string | null;
  /** Set once at the cancel (20261006170000); null = renewal never turned off, or off before 170000. */
  early_termination_fee_cents: number | null;
  early_termination_paid_at: string | null;
};

/** A row of `Deps.expiredLiveCards` (columns of 20261006170000). */
export type ExpiredCardRow = {
  subscription_id: string;
  provider_subscription_id: string;
  paid_through: string | null;
  early_termination_fee_cents: number | null;
  early_termination_paid_at: string | null;
};

/** A row of `Deps.cancelsToRedo`: the subscription, plus the day the fee falls due. */
export type CancelRedoRow = SubscriptionIds & { paid_through: string };

export type Deps = InvoiceDeps & {
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
  /**
   * `partner.place_subscriptions` already expired on CARD or PIX subscription (#898) whose Asaas subscription was not ended yet
   * (`status` = 'expired', `canceled_at` null, `provider_subscription_id` set): the sweep ends them
   * here, except while the early-termination fee is still due (`earlyTerminationFeeHeld`). Throws on
   * a read error.
   */
  expiredLiveCards: () => Promise<ExpiredCardRow[]>;
  /**
   * `partner.place_subscriptions` cancelled whose Asaas half may not have landed: `renews` false,
   * `early_termination_fee_cents` set, `early_termination_paid_at` null, `canceled_at` null,
   * `provider_subscription_id` and `paid_through` set. The sweep redoes `redoCancelAtAsaas` on them
   * (it drops the rows past `paid_through`). Throws on a read error.
   */
  cancelsToRedo: () => Promise<CancelRedoRow[]>;
  /** `place_subscriptions.acceptance_id → place_acceptances.submission_id`, by our id or Asaas' `sub_…`. */
  submissionOfSubscription: (subscriptionId: string | null, providerSubscriptionId: string | null) => Promise<string | null>;
  /** `issueAccessLink` of `places-portal-draft.ts` (#863, §7.3): the access e-mail of a settled submission. */
  accessLink: (submissionId: string) => Promise<'sent' | 'owned' | 'failed'>;
  /** Plans whose invoices the sweep reconciles (#901): live, or ended in the last 40 days. Throws on a read error. */
  invoiceTargets: () => Promise<InvoiceTarget[]>;
  /** Payouts in `sent` (#903), whose transfer the sweep re-reads. Throws on a read error. */
  sentPayouts: () => Promise<SentPayout[]>;
  /**
   * #916: the legacy mark of a submission (`legacy_client_id`, `legacy_fee_ended_at`), read with
   * service_role; null = not a legacy submission. Throws on a read error.
   */
  legacyOf: (submissionId: string) => Promise<LegacyMark | null>;
  /** #916: `core.clients.id` of every legacy submission whose fee ended. Throws on a read error. */
  legacyFeesEnded: () => Promise<string[]>;
};

export type LegacyMark = { client_id: string; fee_ended_at: string | null };

export type PortalDeps = Deps & {
  /** The user's JWT: the database proves the owner. */
  user: Rpc;
  /** E-mail of the session's user, from the Auth (not from the request body). */
  userEmail: () => Promise<string | null>;
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

/**
 * Contract §5: TGP01 → 404, TGP10 → 409, TGP11 → 409 `quote_changed` (the cancel fee moved since the
 * quote, 20261006190000), TGP22 → 422; 42501 (no e-mail session) → 401.
 */
export function portalErrorReply(e: DbError): Reply {
  switch (e.code) {
    case 'TGP01':
      return reply(404, { error: 'not_found' });
    case 'TGP10':
      return reply(409, { error: 'not_allowed', reason: e.details ?? null });
    case 'TGP11':
      return reply(409, { error: 'quote_changed' });
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
  const address = parseAddressInput(holder);
  if ('invalid' in address) return { invalid: `holder_${address.invalid}` };
  const { postalCode, addressNumber } = address;
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

/**
 * #914: the payer's CEP and number, required by every method — the Asaas customer is born with them
 * (Asaas fills the rest from the CEP), or the NFS-e is refused. Card: from `holder`; Pix: `address`.
 */
export function parseAddressInput(raw: unknown): AsaasCustomerAddress | { invalid: 'postal_code' | 'address_number' } {
  const a = (raw ?? {}) as Record<string, unknown>;
  const postalCode = digits(a.postal_code);
  if (postalCode.length !== 8) return { invalid: 'postal_code' };
  const addressNumber = str(a.address_number);
  if (!addressNumber || addressNumber.length > 10) return { invalid: 'address_number' };
  return { postalCode, addressNumber };
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
 * creation; the next ones follow Asaas's own `nextDueDate` (payment + 1 month), which is where the
 * paid month and the commitment start (BR-B2B-046, `confirm_place_charge`).
 *
 * COUPON (places-portal-rascunho §8.1–8.2): the subscription is created with `value` = the first
 * fee (`next_amount_cents`, voucher diluted over the commitment's fees). After each applied charge
 * `syncNextAmount` (and the sweep) moves `value` to the next fee — the full one from the renewal on.
 * No second payment method, no token kept by us.
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
  const address = { postalCode: input.holder.postalCode, addressNumber: input.holder.addressNumber };
  return startSubscription(deps, submissionId, co, 'credit_card', address, async (customerId, base) => {
    try {
      return await deps.asaas.createCardSubscription({
        ...base,
        customer: customerId,
        creditCard: input.card,
        creditCardHolderInfo: { ...input.holder, email: co.customer_email },
        remoteIp: input.remoteIp,
      });
    } catch (e) {
      // 400 on a card subscription = the card or its holder data was refused; nothing was created.
      if (e instanceof AsaasError && e.status === 400) return reply(402, { error: 'card_refused' });
      throw e;
    }
  });
}

type SubscriptionBase = { value: number; nextDueDate: string; cycle: string; description: string; externalReference: string };

/**
 * Both methods (#898): the subscription's first fee is due on the database's `next_due_date`.
 * - Free month (`next_due_date` after today): nothing is charged now, so the answer is `scheduled` +
 *   that date. The database moved the submission to validation in the attach, so the access link
 *   goes here, from the server — for a submission with an owner `accessLink` answers `owned`.
 * - No trial (due today: the same place again, BR-B2B-046 item 1, or an acceptance before pricing
 *   2026-10-07): Asaas charges the card on creation; the Pix charge is due today. `paid`/`processing`,
 *   and the webhook (`confirm_place_charge`) sends the submission to validation, as before #898.
 *   #914: the Pix `processing` carries the QR of today's charge (`pix`), so the portal shows it; and
 *   a Pix checkout again with that charge still open answers the same QR instead of a new subscription.
 */
async function startSubscription(
  deps: Deps,
  submissionId: string,
  co: CheckoutRow,
  method: Exclude<PaymentMethod, 'pix_automatic'>,
  address: AsaasCustomerAddress,
  create: (customerId: string, base: SubscriptionBase) => Promise<{ id: string } | Reply>,
): Promise<Reply> {
  try {
    if (method === 'pix') {
      const open = await openPixCharge(deps, submissionId, co);
      if (open) return open;
    }
    const customer = await prepareCustomer(deps, submissionId, co, address);
    if (isReply(customer)) return customer;
    // Pix fees are paid by hand: the Asaas notification (charge created, due soon, overdue) is what
    // hands the payer the QR. The card needs none (Asaas charges it).
    if (method === 'pix') await deps.asaas.setCustomerNotifications(customer.id, true);

    const firstCharge = co.next_due_date!;   // payableRow refuses a null one
    const freeMonth = firstCharge > deps.today();
    const created = await create(customer.id, {
      value: toReais(co.next_amount_cents),
      nextDueDate: firstCharge,
      cycle: co.billing_cycle,
      description: `Tuggi · Com história · ${co.billing_period} ${co.billing_period === 1 ? 'mês' : 'meses'}`,
      externalReference: co.external_reference,
    });
    if (isReply(created)) return created;

    const attached = await deps.admin('partner', 'attach_place_subscription', {
      p_subscription_id: co.subscription_id,
      p_payment_method: method,
      p_provider_customer_id: customer.id,
      p_provider_subscription_id: created.id,
      p_provider_authorization_id: null,
    });
    if (attached.error) {
      // A subscription we cannot attach is deleted (and whatever it charged today given back), or it charges on its own.
      await discardSubscription(deps, created.id, attached.error.code === 'TGP10' ? 'checkout_race' : 'attach_failed');
      if (attached.error.code === 'TGP10' && attached.error.details === 'renewing') return reply(409, { error: 'not_allowed', reason: 'renewing' });
      await deps.alert('attach_failed', { subscription_id: co.subscription_id, provider_subscription_id: created.id, code: attached.error.code });
      return reply(502, { error: 'unavailable' });
    }
    // #914: no invoice here (not even `invoiceSettings`, whose address check refused the Pix
    // checkout). The NFS-e is a step after the payment: `invoiceAfterPayment`, from the webhook.
    // #916: the new plan is attached, so the legacy fee of a client from before the portal ends now.
    await endLegacyAfterMigration(deps, submissionId);

    if (!freeMonth) {
      const payments = await deps.asaas.listSubscriptionPayments(created.id);
      if (payments.some((p) => PAID_STATUSES.has(p.status))) return reply(200, { result: 'paid' });
      return reply(200, { result: 'processing', ...(method === 'pix' ? await pixOfCharges(deps, payments) : {}) });
    }
    const link = await deps.accessLink(submissionId).catch(() => 'failed' as const);
    if (link === 'failed') await deps.alert('access_link_failed', { subscription_id: co.subscription_id, provider_subscription_id: created.id });
    return reply(200, { result: 'scheduled', first_charge_on: firstCharge });
  } catch (e) {
    if (e instanceof AsaasError) {
      console.error('[places-payment] checkout asaas', method, e.message);
      return reply(502, { error: 'provider_unavailable' });
    }
    throw e;
  }
}

/**
 * #914: the Pix to pay today, `{ pix: { payload, image, expires_at } }`, from the first PENDING
 * charge. A QR that cannot be read is not a failure: the Asaas notification e-mails the same charge,
 * so the answer is `processing` without `pix` and the portal says so.
 */
async function pixOfCharges(deps: Deps, payments: AsaasPayment[]): Promise<{ pix?: PixQr }> {
  const open = payments.find((p) => p.status === 'PENDING');
  if (!open) return {};
  try {
    const q = await deps.asaas.getPixQrCode(open.id);
    if (!q.payload) return {};
    return { pix: { payload: q.payload, image: q.encodedImage ?? null, expires_at: q.expirationDate ?? null } };
  } catch (e) {
    console.error('[places-payment] pix_qr', open.id, e instanceof Error ? e.message : 'unknown');
    return {};
  }
}

export type PixQr = { payload: string; image: string | null; expires_at: string | null };

/**
 * #914: no trial, Pix already attached and today's charge still open — a second "pay" (reload, the
 * wait ran out) answers that charge's QR. Before, it deleted the subscription and created another:
 * a new charge, a new Asaas e-mail, and the old one's `SUBSCRIPTION_DELETED` as a false alert.
 * Paid, gone, or another method → `null`, and the checkout goes on as before (`clearLiveSubscriptions`).
 */
async function openPixCharge(deps: Deps, submissionId: string, co: CheckoutRow): Promise<Reply | null> {
  if (co.next_due_date! > deps.today()) return null;
  const ids = await deps.subscriptionIds(submissionId);
  if (!ids?.provider_subscription_id || ids.canceled_at || ids.payment_method !== 'pix') return null;
  const payments = await deps.asaas.listSubscriptionPayments(ids.provider_subscription_id).catch((e) => {
    if (e instanceof AsaasError && e.status === 404) return [] as AsaasPayment[];
    throw e;
  });
  if (payments.some((p) => PAID_STATUSES.has(p.status)) || !payments.some((p) => p.status === 'PENDING')) return null;
  return reply(200, { result: 'processing', ...(await pixOfCharges(deps, payments)) });
}

/** `place_payment_checkout`, refused unless there is a first period to pay now. */
async function payableCheckout(deps: Deps, submissionId: string): Promise<CheckoutRow | Reply> {
  const { data, error } = await deps.admin('partner', 'place_payment_checkout', { p_submission_id: submissionId });
  if (error) return isBusinessError(error) ? portalErrorReply(error) : reply(502, { error: 'unavailable' });
  return payableRow(firstRow<CheckoutRow>(data));
}

/**
 * Payable = `pending_payment`, attachable, with a due date (today). Not `pending_payment` = nothing
 * to pay. A null `next_due_date` is no longer "paid, waiting for approval" — the paid month starts at
 * the first payment (20261006160000) — it only guards a row with no charge to make.
 */
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
 * already PAID is attached, not charged again; an unpaid one is ended — switching method must not
 * leave a second subscription charging the same month), then the customer, with the payer's CEP and
 * number (#914): created with them, or updated when the one found has another (or none — customers
 * created before #914). Asaas errors propagate (the callers answer `provider_unavailable`), except
 * a 400 on the customer itself: that is the payer's data, `customerDataReply`.
 */
async function prepareCustomer(deps: Deps, submissionId: string, co: CheckoutRow, address: AsaasCustomerAddress): Promise<{ id: string } | Reply> {
  const settled = await clearLiveSubscriptions(deps, submissionId, co);
  if (settled) return settled;
  try {
    const found = await deps.asaas.findCustomerByReference(co.subscription_id);
    if (!found) {
      return await deps.asaas.createCustomer({
        name: co.customer_name,
        cpfCnpj: co.customer_tax_id.replace(/[.\-/\s]/g, '').toUpperCase(),
        email: co.customer_email,
        externalReference: co.subscription_id,
        ...address,
      });
    }
    if (digits(found.postalCode) !== address.postalCode || str(found.addressNumber) !== address.addressNumber) {
      await deps.asaas.setCustomerAddress(found.id, address);
    }
    return found;
  } catch (e) {
    if (e instanceof AsaasError && e.status === 400) return customerDataReply(deps, co, e);
    throw e;
  }
}

/**
 * #914: Asaas refused the customer (CEP not found, number, document). Nothing was created, and paying
 * again with the same data fails the same way: `422 customer_data` + the field the payer must fix
 * (`postal_code`, `address_number`; `null` = a datum of the acceptance, fixed by support). The field
 * comes from the masked `description`: Asaas publishes no code per field (doc 2026-10-08).
 */
async function customerDataReply(deps: Deps, co: CheckoutRow, e: AsaasError): Promise<Reply> {
  const text = e.descriptions.join(' ');
  const field = /\bCEP\b/i.test(text) ? 'postal_code' : /n[úu]mero/i.test(text) ? 'address_number' : null;
  await deps.alert('customer_data_refused', { subscription_id: co.subscription_id, field, error: e.message });
  return reply(422, { error: 'customer_data', field });
}

// ─── portal: checkout (Pix) ────────────────────────────────────────────────────────────────────

/**
 * Pix (#898): an Asaas subscription with `billingType: PIX`, the first fee on `next_due_date` — the
 * same free month and the same attach as the card. Not Pix Automático: on Asaas its only journey
 * (3) charges the first fee at once (https://docs.asaas.com/docs/automatic-pix).
 */
export async function checkoutPix(deps: PortalDeps, body: unknown): Promise<Reply> {
  const b = (body ?? {}) as Record<string, unknown>;
  const submissionId = b.submission_id;
  if (!isUuid(submissionId)) return reply(400, { error: 'invalid', field: 'submission_id' });
  const address = parseAddressInput(b.address);
  if ('invalid' in address) return reply(400, { error: 'invalid', field: address.invalid });
  const owner = await ownerRow(deps, submissionId.toLowerCase());
  if (isReply(owner)) return owner;
  const co = await payableCheckout(deps, owner.submission_id);
  if (isReply(co)) return co;
  return pixSubscription(deps, owner.submission_id, co, address);
}

/** The cookie's Pix checkout (#863, §7.2): the same subscription, the submission from the cookie; the address from the body (#914). */
export async function draftCheckoutPix(deps: Deps, body: unknown, tokenSha256: string): Promise<Reply> {
  const address = parseAddressInput(((body ?? {}) as Record<string, unknown>).address);
  if ('invalid' in address) return reply(400, { error: 'invalid', field: address.invalid });
  const co = await draftPayable(deps, tokenSha256);
  if (isReply(co)) return co;
  return pixSubscription(deps, co.submission_id, co, address);
}

function pixSubscription(deps: Deps, submissionId: string, co: CheckoutRow, address: AsaasCustomerAddress): Promise<Reply> {
  return startSubscription(deps, submissionId, co, 'pix', address, (customerId, base) =>
    deps.asaas.createPixSubscription({ ...base, customer: customerId }),
  );
}

/** Ends the provider side of a subscription: the Asaas subscription and, on Pix, the authorization. */
async function endProviderSubscription(
  deps: Deps,
  ids: { provider_subscription_id: string | null; provider_authorization_id?: string | null },
): Promise<void> {
  if (ids.provider_subscription_id) await deps.asaas.deleteSubscription(ids.provider_subscription_id);
  if (ids.provider_authorization_id) await deps.asaas.cancelPixAutomaticAuthorization(ids.provider_authorization_id);
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
      const method =
        id === ids?.provider_subscription_id && ids?.payment_method
          ? ids.payment_method
          : (sub as { billingType?: string }).billingType === 'PIX' ? 'pix' : 'credit_card';
      const { error } = await deps.admin('partner', 'attach_place_subscription', {
        p_subscription_id: co.subscription_id,
        p_payment_method: method,
        p_provider_customer_id: customer,
        p_provider_subscription_id: id,
        p_provider_authorization_id: method === 'pix_automatic' ? ids?.provider_authorization_id ?? null : null,
      });
      if (error && !(error.code === 'TGP10')) {
        await deps.alert('attach_failed', { subscription_id: co.subscription_id, provider_subscription_id: id, code: error.code });
        return reply(502, { error: 'unavailable' });
      }
      for (const p of payments.filter((p) => PAID_STATUSES.has(p.status))) {
        await confirmFromCheckout(deps, submissionId, co.subscription_id, id, p);
      }
      await endLegacyAfterMigration(deps, submissionId);
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

/**
 * #914: the loop. The portal learns a payment only from `core.portal_get_subscription`, and the
 * database only from the webhook. A charge PAID at Asaas whose webhook did not apply (lost, queue
 * paused, refused) left the plan `pending_payment`: the page waited, the poll ran out, "pay" came back,
 * and this checkout found the money, answered `paid` WITHOUT recording it, and the poll waited again.
 * Now the re-read charge is recorded here, with the webhook's own function: idempotent by the payment
 * id, so the webhook that arrives later is a `duplicate_charge`. No event id (`NULL` claims nothing).
 * Never fails the checkout: the webhook stays the other way in.
 */
async function confirmFromCheckout(deps: Deps, submissionId: string, subscriptionId: string, providerSubscriptionId: string, p: AsaasPayment): Promise<void> {
  const args = {
    ...paymentArgs('confirm_place_charge', 'checkout', 'checkout', p, deps.today(), { subscriptionId, providerSubscriptionId }),
    p_event_id: null,
    p_event_type: null,
  };
  const { data, error } = await deps.admin('partner', 'confirm_place_charge', args);
  if (error) {
    await deps.alert('checkout_confirm_failed', { subscription_id: subscriptionId, provider_payment_id: p.id, code: error.code ?? null });
    return;
  }
  const row = firstRow<{ outcome?: string; submission_status?: string }>(data);
  const outcome = row?.outcome ?? 'unknown';
  if (ALERT_OUTCOMES.has(outcome)) {
    await deps.alert(outcome, { event_id: 'checkout', function: 'confirm_place_charge', subscription_id: subscriptionId, provider_subscription_id: providerSubscriptionId, provider_payment_id: p.id });
    return;
  }
  if (outcome !== 'applied') return;
  if (row?.submission_status === 'in_review') await accessLinkAfterPayment(deps, submissionId, args, 'checkout', 'checkout');
  await syncNextAmount(deps, submissionId, args);
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

// ─── portal: cancel, regret refund, withdrawal ─────────────────────────────────────────────────

/**
 * `core.portal_cancel_quote`: what cancelling now costs, shown to the owner BEFORE the confirm (§8.4).
 * `charge_on` is null when `fee_cents` is 0 (also inside the 7-day regret window); an owned
 * submission without a paid plan answers a row of zeros with `service_ends_at` null.
 */
export type CancelQuote = {
  fee_cents: number;
  months_paid: number;
  months_remaining: number;
  service_ends_at: string | null;
  charge_on: string | null;
};

/** The quote of cancelling now, with the user's JWT (the function proves the owner). Writes nothing. */
export async function cancelQuote(deps: PortalDeps, submissionId: string): Promise<Reply> {
  if (!isUuid(submissionId)) return reply(400, { error: 'invalid', field: 'submission_id' });
  const { data, error } = await deps.user('core', 'portal_cancel_quote', { p_submission_id: submissionId });
  if (error) return isBusinessError(error) ? portalErrorReply(error) : reply(502, { error: 'unavailable' });
  const q = firstRow<CancelQuote>(data);
  const count = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
  if (!q || !count(q.fee_cents) || !count(q.months_paid) || !count(q.months_remaining)) return reply(502, { error: 'unavailable' });
  if (q.fee_cents > 0 && !q.charge_on) return reply(502, { error: 'unavailable' });
  return reply(200, {
    quote: {
      fee_cents: q.fee_cents,
      months_paid: q.months_paid,
      months_remaining: q.months_remaining,
      service_ends_at: q.service_ends_at ?? null,
      charge_on: q.fee_cents > 0 ? q.charge_on : null,
    },
  });
}

// ─── portal: cancellation survey (#913, BR-B2B-060) ───────────────────────────────────────────

/** BR-B2B-060 item 3: the closed list. A new code is an amendment of the rule. */
export const CANCEL_REASONS = ['too_expensive', 'no_results', 'few_tourists', 'closing_business', 'portal_or_payment_issue', 'other'] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];
/** BR-B2B-060 item 4. */
export const CANCEL_COMMENT_MAX = 1000;
/** The consent text is the checkbox label as shown (~110 chars today); longer is not a label. */
const CONSENT_TEXT_MAX = 500;

export type CancelFeedback = { reason: CancelReason | null; comment: string | null; contactConsent: boolean; contactConsentText: string | null };

/**
 * BR-B2B-060 item 6: an invalid answer is dropped, field by field, and never blocks the cancel.
 * Reason off the list → null; comment trimmed, empty or over 1000 → null; consent without its text
 * (or with a text too long to be the label) → false. Anything that is not an object → all empty.
 */
export function sanitizeCancelFeedback(raw: unknown): CancelFeedback {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const reason = (CANCEL_REASONS as readonly unknown[]).includes(o.reason) ? (o.reason as CancelReason) : null;
  const comment = typeof o.comment === 'string' ? o.comment.trim() : '';
  const consentText = typeof o.contact_consent_text === 'string' ? o.contact_consent_text.trim() : '';
  const consent = o.contact_consent === true && consentText.length > 0 && consentText.length <= CONSENT_TEXT_MAX;
  return {
    reason,
    comment: comment && comment.length <= CANCEL_COMMENT_MAX ? comment : null,
    contactConsent: consent,
    contactConsentText: consent ? consentText : null,
  };
}

/**
 * BR-B2B-060 item 7: one record per cancellation made in the portal, answered or not (the CMS
 * measures the answer rate over all of them). `partner.record_place_cancellation_feedback` does not
 * check the owner: the subscription comes from `subscriptionIds` of the submission whose cancel
 * `core.portal_cancel_renewal` just accepted with the user's JWT. Item 6: a failure is logged (code
 * only, no answer text) and never undoes nor fails the cancel.
 */
async function recordCancelFeedback(deps: Deps, ids: SubscriptionIds | null, fb: CancelFeedback): Promise<void> {
  if (!ids) {
    console.error('[places-payment] cancel feedback not recorded', 'no_subscription');
    return;
  }
  try {
    const { error } = await deps.admin('partner', 'record_place_cancellation_feedback', {
      p_subscription_id: ids.subscription_id,
      p_reason: fb.reason,
      p_comment: fb.comment,
      p_contact_consent: fb.contactConsent,
      p_contact_consent_text: fb.contactConsentText,
    });
    if (error) console.error('[places-payment] cancel feedback not recorded', error.code ?? 'unknown');
  } catch (e) {
    console.error('[places-payment] cancel feedback not recorded', e instanceof Error ? e.message.slice(0, 200) : 'unknown');
  }
}

/** What the cancel e-mail says about the one charge left; null = nothing more is charged. */
export type CancelFee = { cents: number; chargeOn: string; method: PaymentMethod; invoiceUrl: string | null };

/**
 * Cancel (contract places-portal-rascunho §8.4, BR-B2B-055). The database first, with the user's JWT
 * (`core.portal_cancel_renewal` proves the owner, ends the commitment at `paid_through` and prices
 * the fee); then Asaas, best effort — if it fails the database is NOT undone and the operator is
 * alerted. Term 4.5: e-mail "no ato".
 *
 * - fee 0 (one-month plan, commitment served, 7-day regret window): `endDate` = eve of `paid_through`, nothing more is
 *   charged (`endAtCommitment`);
 * - fee > 0: `chargeEarlyTermination` — the next charge, on `paid_through`, is the fee and the last.
 *
 * `expectedFeeCents` is the `fee_cents` the owner saw in the quote, a check only: the database
 * recalculates and, if it differs (a monthly fee confirmed between quote and click), raises TGP11
 * and writes nothing → 409 `quote_changed`. Absent = no check (the parameter is not even sent).
 * `p_expected_fee_cents` exists from 20261006190000 on: PostgREST rejects an unknown parameter.
 *
 * Repeated call (`not_applicable`): `resumeCancelAtAsaas` redoes the idempotent Asaas half.
 *
 * `feedback` (#913, BR-B2B-060): the optional survey of the portal's cancel flow. Sanitized
 * (`sanitizeCancelFeedback`) and recorded only after the cancel took effect, on every new cancel,
 * even without it; a repeated call records nothing (it is not a new cancel).
 */
export async function cancelRenewal(deps: PortalDeps, submissionId: string, expectedFeeCents?: unknown, feedback?: unknown): Promise<Reply> {
  if (!isUuid(submissionId)) return reply(400, { error: 'invalid', field: 'submission_id' });
  if (expectedFeeCents != null && !(Number.isInteger(expectedFeeCents) && (expectedFeeCents as number) >= 0)) {
    return reply(400, { error: 'invalid', field: 'expected_fee_cents' });
  }
  const args: Record<string, unknown> = { p_submission_id: submissionId };
  if (expectedFeeCents != null) args.p_expected_fee_cents = expectedFeeCents;
  const { data, error } = await deps.user('core', 'portal_cancel_renewal', args);
  if (error) {
    if (isBusinessError(error)) return portalErrorReply(error);
    await deps.alert('cancel_failed', { code: error.code });
    return reply(502, { error: 'unavailable' });
  }
  const row = firstRow<{
    outcome: string;
    renews: boolean;
    commitment_ends_at: string | null;
    paid_through: string | null;
    /** 0 when nothing is owed, never null (20261006170000). */
    early_termination_fee_cents: number;
  }>(data);
  if (!row) return reply(200, { result: 'not_renewing' });
  if (row.outcome === 'not_applicable') {
    await resumeCancelAtAsaas(deps, submissionId, row);
    return reply(200, { result: 'not_renewing' });
  }

  const ends = row.paid_through ?? row.commitment_ends_at;
  const chargeOn = ends ? saoPauloDate(new Date(ends)) : null;
  const feeCents = Number.isInteger(row.early_termination_fee_cents) && row.early_termination_fee_cents > 0 ? row.early_termination_fee_cents : 0;
  const ids = await deps.subscriptionIds(submissionId);
  // The fee is owed by the term whether or not Asaas took the change: the e-mail states it, and a
  // failure below alerts the operator to schedule it by hand.
  let fee: CancelFee | null = null;
  if (feeCents > 0 && chargeOn) {
    const method: PaymentMethod = ids?.payment_method === 'pix_automatic' || ids?.payment_method === 'pix' ? ids.payment_method : 'credit_card';
    const invoiceUrl = ids ? await chargeEarlyTermination(deps, ids, feeCents, chargeOn) : null;
    if (!ids) await deps.alert('cancel_fee_not_scheduled', { submission_id: submissionId, reason: 'no_subscription', fee_cents: feeCents });
    fee = { cents: feeCents, chargeOn, method, invoiceUrl };
  } else if (feeCents > 0) {
    await deps.alert('cancel_fee_not_scheduled', { submission_id: submissionId, reason: 'no_paid_through', fee_cents: feeCents });
  } else if (ids && ends) {
    await endAtCommitment(deps, ids, ends);
  } else if (ids?.provider_subscription_id && !ids.canceled_at && ids.status === 'pending_payment') {
    // #898: cancelled inside the free month — no fee was ever charged, so no `paid_through`. The
    // Asaas subscription goes, and its first fee (already generated, Asaas does it 40 days ahead) with it.
    await endFreeMonth(deps, ids);
  }

  const answers = sanitizeCancelFeedback(feedback);
  await recordCancelFeedback(deps, ids, answers);

  const to = await deps.userEmail();
  if (to) {
    const until = ends ? formatDateBr(saoPauloDate(new Date(ends))) : null;
    const mail = CANCEL_EMAIL.build(until, fee, answers.reason !== null || answers.comment !== null);
    const sent = await deps.sendEmail(to, mail.subject, mail.text, { html: mail.html, fromName: CANCEL_EMAIL.fromName, replyTo: CANCEL_EMAIL.replyTo });
    if (!sent) await deps.alert('cancel_email_failed', { subscription_id: ids?.subscription_id ?? null });
  }
  return reply(200, { result: 'canceled' });
}

/**
 * The Asaas half of a cancel may never have landed (Asaas failed — `cancel_fee_not_scheduled` /
 * `cancel_end_date_failed` — or the EF died in between): on card the subscription is then live at the
 * full monthly with no `endDate`, and Asaas would charge it on `paid_through`. The panel stops offering
 * the button once the database cancelled, so two callers redo it: a repeated cancel
 * (`resumeCancelAtAsaas`) and the daily sweep (`runSweep`, `cancelsToRedo`). Idempotent, from the row
 * read with service_role:
 *
 * - fee > 0, card, not paid yet: `chargeEarlyTermination` again (PUT `value` = fee with
 *   `updatePendingPayments`, `endDate`, later pendings deleted — the same request gives the same state);
 * - fee 0: `endAtCommitment` again (`endDate` = eve of `paid_through`);
 * - fee > 0 on Pix, not paid yet: only the recurrence is ended again (`endProviderSubscription`; a
 *   404/400 there is "already gone"). Never `createPixPayment` — it is not idempotent, and the one-off
 *   went (or alerted the operator) at the first call.
 *
 * Nothing when the fee column is null (renewal turned off before 20261006170000: the old rule still
 * charges the commitment's months), when the fee is paid, when the subscription is already ended, or
 * after `paid_through` (the expiry's turn). No e-mail: it went at the first call.
 */
async function redoCancelAtAsaas(deps: Deps, ids: SubscriptionIds, paidThrough: string): Promise<void> {
  const chargeOn = saoPauloDate(new Date(paidThrough));
  if (deps.today() > chargeOn) return;
  if (!ids.provider_subscription_id || ids.canceled_at || ids.early_termination_fee_cents == null) return;
  const fee = ids.early_termination_fee_cents;
  if (fee === 0) return endAtCommitment(deps, ids, paidThrough);
  if (ids.early_termination_paid_at) return;
  if (ids.payment_method !== 'pix_automatic') {
    await chargeEarlyTermination(deps, ids, fee, chargeOn);
    return;
  }
  try {
    await endProviderSubscription(deps, ids);
  } catch (e) {
    await deps.alert('cancel_fee_not_scheduled', {
      subscription_id: ids.subscription_id,
      reason: 'pix_end_recurrence',
      fee_cents: fee,
      error: e instanceof Error ? e.message : null,
    });
  }
}

/** Repeated cancel (`not_applicable`): `redoCancelAtAsaas` on the submission's subscription. */
async function resumeCancelAtAsaas(
  deps: Deps,
  submissionId: string,
  row: { renews: boolean; paid_through: string | null },
): Promise<void> {
  if (row.renews) return;
  let ids: SubscriptionIds | null;
  try {
    ids = await deps.subscriptionIds(submissionId);
  } catch (e) {
    await deps.alert('cancel_resume_failed', { submission_id: submissionId, error: e instanceof Error ? e.message : 'unknown' });
    return;
  }
  if (!ids) return;
  if (row.paid_through) await redoCancelAtAsaas(deps, ids, row.paid_through);
  // #898: never paid (free month) — the DELETE is idempotent (404 = gone).
  else if (ids.provider_subscription_id && !ids.canceled_at && ids.status === 'pending_payment') await endFreeMonth(deps, ids);
}

/**
 * `endDate` = the eve of the commitment end (São Paulo): Asaas generates no fee from that day on.
 * A fee it ALREADY generated (40 days ahead, docs.asaas.com "Assinaturas") is not touched by `endDate`
 * (memory of #811: `nextDueDate`/`endDate` only steer charges not generated yet), so a pending one due
 * after `endDate` is deleted too — otherwise the card would still be charged on `paid_through` (#898).
 */
async function endAtCommitment(deps: Deps, ids: SubscriptionIds, commitmentEndsAt: string): Promise<void> {
  if (!ids.provider_subscription_id || ids.canceled_at) return;
  try {
    const endDate = shiftDays(saoPauloDate(new Date(commitmentEndsAt)), -1);
    await deps.asaas.updateSubscription(ids.provider_subscription_id, { endDate });
    const pending = await deps.asaas.listSubscriptionPayments(ids.provider_subscription_id, 'PENDING');
    for (const p of pending) if (p.dueDate && p.dueDate > endDate) await deps.asaas.deletePayment(p.id);
  } catch (e) {
    await deps.alert('cancel_end_date_failed', { subscription_id: ids.subscription_id, error: e instanceof Error ? e.message : 'unknown' });
  }
}

/**
 * Cancel inside the free month (#898, BR-B2B-046): nothing was paid, so nothing is owed. DELETE of
 * the Asaas subscription removes its pending fee. The row is NOT cancelled here: `canceled_at` would
 * take the story down now, and it stays up to the end of the free month (BR-B2B-046 item 9,
 * `place_story_entitled`, `renews` = false). `expire_place_subscriptions` returns it at that date and
 * the sweep (`expiredLiveCards` → `endSubscription`) cancels it; the DELETE there answers 404 = done.
 * Money that still lands is `not_applicable`: the EF only alerts (`ALERT_OUTCOMES`), the refund is
 * manual (operator). A DELETE failure alerts the operator: the fee
 * would otherwise be charged on its date.
 */
async function endFreeMonth(deps: Deps, ids: SubscriptionIds): Promise<void> {
  try {
    await endProviderSubscription(deps, ids);
  } catch (e) {
    await deps.alert('cancel_free_month_failed', { subscription_id: ids.subscription_id, error: e instanceof Error ? e.message : 'unknown' });
  }
}

/**
 * The early-termination fee, ONE charge due on `chargeOn` (= `paid_through`), by the plan's method.
 * Returns the Pix QR page for the e-mail (null on card, or when it could not be had). A failure
 * alerts the operator (`cancel_fee_not_scheduled`) and the cancellation stands either way.
 *
 * - Card: the same mechanism as `syncNextAmount` — PUT `value` = fee with `updatePendingPayments`
 *   (the charge Asaas already generated for `chargeOn` becomes the fee) and `endDate` = `chargeOn`,
 *   so it is the last; a charge already generated after `chargeOn` is deleted.
 * - Pix Automático: in `SUBSCRIPTION` mode the authorized `value` is fixed and every charge of the
 *   authorization must respect it (docs.asaas.com, "FAQ do Pix Automático", question 6; checked
 *   2026-10-06). So the fee is a one-off Pix charge (`createPixPayment`, no `externalReference`: the
 *   webhook maps it through the customer, like the first Pix charge), and the recurrence ends now —
 *   subscription (its pending charge goes with it) and authorization. The QR page goes in the e-mail.
 */
async function chargeEarlyTermination(deps: Deps, ids: SubscriptionIds, feeCents: number, chargeOn: string): Promise<string | null> {
  const fail = async (step: string, e?: unknown) => {
    await deps.alert('cancel_fee_not_scheduled', {
      subscription_id: ids.subscription_id,
      reason: step,
      fee_cents: feeCents,
      error: e instanceof Error ? e.message : null,
    });
    return null;
  };
  if (ids.payment_method === 'pix_automatic') {
    let invoiceUrl: string | null = null;
    try {
      if (!ids.provider_customer_id) throw new Error('no_customer');
      const p = await deps.asaas.createPixPayment({
        customer: ids.provider_customer_id,
        value: toReais(feeCents),
        dueDate: chargeOn,
        description: 'Tuggi Com história: diferença do desconto (cancelamento antes do fim da fidelidade)',
      });
      invoiceUrl = p.invoiceUrl ?? null;
      if (!invoiceUrl) await deps.alert('cancel_fee_invoice_missing', { subscription_id: ids.subscription_id, provider_payment_id: p.id });
    } catch (e) {
      await fail('pix_charge', e);
    }
    // Ended even if the one-off failed: the recurrence would charge a full monthly fee on `chargeOn`.
    try {
      if (!ids.canceled_at) await endProviderSubscription(deps, ids);
    } catch (e) {
      await fail('pix_end_recurrence', e);
    }
    return invoiceUrl;
  }

  // Card and Pix subscription (#898): the fee is the subscription's own pending charge.
  if (!ids.provider_subscription_id || ids.canceled_at) return fail('no_live_subscription');
  try {
    await deps.asaas.updateSubscription(ids.provider_subscription_id, { value: toReais(feeCents), endDate: chargeOn, updatePendingPayments: true });
    const pending = await deps.asaas.listSubscriptionPayments(ids.provider_subscription_id, 'PENDING');
    for (const p of pending) if (p.dueDate && p.dueDate > chargeOn) await deps.asaas.deletePayment(p.id);
    return null;
  } catch (e) {
    return fail('card_update', e);
  }
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
      // #901: only a payment actually refunded loses its invoice — never on a skip (unexpected status,
      // amount above the charge) nor on a failed refund. Never throws.
      await cancelPaymentInvoices(deps, r.provider_payment_id, r.subscription_id);
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
  // #918: a boleto of the CMS contract can be marked paid in cash in the Asaas panel.
  if (PAID_STATUSES.has(status) || status === 'RECEIVED_IN_CASH') return 'confirm_place_charge';
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

  if (eventType.startsWith('INVOICE_')) return await handleInvoiceEvent(deps, b, eventId, eventType);
  // #903: the payout's Pix. Re-read and settled in `places-payout.ts`; a database error throws (500, resend).
  if (eventType.startsWith('TRANSFER_')) return await handleTransferEvent(deps, b, eventId, eventType);

  if (eventType.startsWith('PAYMENT_CHARGEBACK')) {
    // Contract §8: not handled — the operator answers the dispute.
    await deps.alert('chargeback', { event_id: eventId, event_type: eventType, provider_payment_id: str((b.payment as Record<string, unknown>)?.id) });
    log('alerted');
    return reply(200, { outcome: 'alerted' });
  }

  let fn: string;
  let args: Record<string, unknown>;
  let paid: AsaasPayment | null = null;
  // #918: the charge is of a CMS contract (`legacy:<client_id>`): no access link, no fee sync; its NFS-e
  // goes by the same step as any charge, with the contract's text (`INVOICE_TEXT`).
  let contract = false;
  try {
    if (PAYMENT_EVENTS.has(eventType) || eventType === PIX_INSTRUCTION_REFUSED) {
      const paymentId =
        eventType === PIX_INSTRUCTION_REFUSED
          ? str((b.paymentInstruction as Record<string, unknown>)?.paymentId)
          : str((b.payment as Record<string, unknown>)?.id);
      if (!paymentId) return reply(400, { error: 'invalid_body' });
      const p = await deps.asaas.getPayment(paymentId);
      // #918 (contract §3.8): a charge of the CMS contract subscription registers that subscription
      // in place_subscriptions FIRST, then goes to the same function as any charge, with its uuid.
      const legacy = await legacySubscriptionOf(deps, p);
      let ids: { subscriptionId: string | null; providerSubscriptionId: string | null };
      if (legacy) {
        const reg = await registerContractSubscription(deps, legacy);
        if (!reg.ok) return await contractRefused(deps, reg, eventId, eventType, log, { provider_subscription_id: legacy.id, provider_payment_id: p.id });
        ids = { subscriptionId: reg.subscriptionId, providerSubscriptionId: legacy.id };
        contract = true;
      } else {
        ids = await chargeIds(deps, p);
      }
      const action = paymentAction(eventType, (p.status ?? '').toUpperCase());
      if (!action) {
        log(`stale:${p.status}`);
        return reply(200, { outcome: 'stale' });
      }
      fn = action;
      args = paymentArgs(action, eventId, eventType, p, deps.today(), ids);
      paid = p;
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
      let s: AsaasSubscription | null = null;
      try {
        s = await deps.asaas.getSubscription(subId);
        ended = !!s.deleted || s.status !== 'ACTIVE';
        reference = s.externalReference ?? null;
      } catch (e) {
        if (!(e instanceof AsaasError && e.status === 404)) throw e;
      }
      if (!ended) {
        log('stale:ACTIVE');
        return reply(200, { outcome: 'stale' });
      }
      let subscriptionId = subscriptionIdFromReference(reference);
      if (s && isLegacySubscriptionReference(reference)) {
        // #918: the CMS contract subscription ended (`cancel_legacy`, the migration, the operator):
        // registered first, then cancelled like any other. A client whose fee already ended and that
        // was never registered has no row to end (#916: nothing to record, no alert).
        const reg = await registerContractSubscription(deps, s);
        if (!reg.ok && reg.outcome === 'not_paying') {
          log('legacy');
          return reply(200, { outcome: 'legacy' });
        }
        if (!reg.ok) return await contractRefused(deps, reg, eventId, eventType, log, { provider_subscription_id: subId });
        subscriptionId = reg.subscriptionId;
      }
      fn = 'cancel_place_subscription';
      args = {
        p_event_id: eventId,
        p_event_type: eventType,
        p_subscription_id: subscriptionId,
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
  // #918: a CMS contract has no portal owner to link and no voucher to sync.
  const applied = !contract && fn === 'confirm_place_charge' && outcome === 'applied';
  const submissionId = applied ? await submissionOfCharge(deps, args, eventId, eventType) : null;
  const link = applied && row?.submission_status === 'in_review' ? await accessLinkAfterPayment(deps, submissionId, args, eventId, eventType) : null;
  if (submissionId) await syncNextAmount(deps, submissionId, args);
  // #901/#914: the invoice, only now that the charge is recorded (`invoiceAfterPayment`: one-off, or a
  // subscription's first paid fee + its invoiceSettings). On a resend too (`duplicate_event`); a
  // transient Asaas failure answers 500 (the charge stays recorded; the resend is a duplicate).
  // #918 (operator 2026-10-08): the CMS contract too, same flow, its own text.
  if (fn === 'confirm_place_charge' && paid && !ALERT_OUTCOMES.has(outcome)) {
    try {
      await invoiceAfterPayment(deps, [paid], (args.p_subscription_id as string | null) ?? null, paid.subscription ?? null, contract ? 'cms_contract' : 'portal');
    } catch (e) {
      console.error('[places-payment-webhook]', eventId, eventType, 'invoice_schedule_failed', e instanceof Error ? e.message : 'unknown');
      return reply(500, { error: 'invoice_schedule_failed' });
    }
  }
  // #914: the end of a subscription that is no longer the plan's (a checkout again replaced it) is
  // noise: the database answers `subscription_mismatch` and nothing changed. Logged, never alerted.
  // A charge (`PAYMENT_*`) with the mismatch still alerts: that is money on a subscription we dropped.
  if (outcome === 'subscription_mismatch' && SUBSCRIPTION_END_EVENTS.has(eventType)) {
    log('superseded');
    return reply(200, { outcome: 'superseded' });
  }
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
 * Contract §8.2: with a voucher the fee changes (diluted voucher → full fee at renewal). After an
 * applied charge, re-read `next_amount_cents` and, if Asaas holds another `value`, PUT it with
 * `updatePendingPayments` (the fee Asaas already generated changes too). Best effort, never a 500:
 * the daily sweep (`alignRenewal`) sets the same value. No `sub_…` attached (Pix before the
 * activation) → nothing to sync yet.
 */
async function syncNextAmount(deps: Deps, submissionId: string, args: Record<string, unknown>): Promise<void> {
  const subscriptionId = typeof args.p_subscription_id === 'string' ? args.p_subscription_id : null;
  try {
    const ids = await deps.subscriptionIds(submissionId);
    const providerSubscriptionId = ids?.canceled_at ? null : ids?.provider_subscription_id ?? null;
    if (!providerSubscriptionId) return;
    const { data, error } = await deps.admin('partner', 'place_payment_checkout', { p_submission_id: submissionId });
    if (error) throw new Error(`db ${error.code}`);
    const next = firstRow<CheckoutRow>(data)?.next_amount_cents;
    if (typeof next !== 'number' || next <= 0) return;
    const sub = await deps.asaas.getSubscription(providerSubscriptionId);
    if (toCents(sub.value) === next) return;
    await deps.asaas.updateSubscription(providerSubscriptionId, { value: toReais(next), updatePendingPayments: true });
  } catch (e) {
    await deps.alert('next_amount_sync_failed', { subscription_id: subscriptionId, error: e instanceof Error ? e.message : 'unknown' });
  }
}

/**
 * Best effort, and never a 500: the charge is already recorded, so a resend would only be a
 * `duplicate_event` and send nothing. A failure alerts the operator; the owner still has
 * "Reenviar o link" in the paying tab and the sign-in by e-mail, which issues a new access link.
 */
async function accessLinkAfterPayment(
  deps: Deps,
  submissionId: string | null,
  args: Record<string, unknown>,
  eventId: string,
  eventType: string,
): Promise<'sent' | 'owned' | 'failed'> {
  let r: 'sent' | 'owned' | 'failed' = 'failed';
  try {
    if (submissionId) r = await deps.accessLink(submissionId);
  } catch (e) {
    console.error('[places-payment-webhook]', eventId, eventType, 'access_link', e instanceof Error ? e.message.slice(0, 120) : 'unknown');
  }
  if (r === 'failed') {
    await deps.alert('access_link_failed', {
      event_id: eventId,
      event_type: eventType,
      subscription_id: typeof args.p_subscription_id === 'string' ? args.p_subscription_id : null,
      provider_subscription_id: typeof args.p_provider_subscription_id === 'string' ? args.p_provider_subscription_id : null,
    });
  }
  return r;
}

/** The submission of an applied charge, looked up once for the access link and `syncNextAmount`; null on failure (never a 500). */
async function submissionOfCharge(deps: Deps, args: Record<string, unknown>, eventId: string, eventType: string): Promise<string | null> {
  try {
    return await deps.submissionOfSubscription(
      typeof args.p_subscription_id === 'string' ? args.p_subscription_id : null,
      typeof args.p_provider_subscription_id === 'string' ? args.p_provider_subscription_id : null,
    );
  } catch (e) {
    console.error('[places-payment-webhook]', eventId, eventType, 'submission_lookup', e instanceof Error ? e.message.slice(0, 120) : 'unknown');
    return null;
  }
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
  /** The amount of the next fee (contract §8.5), = Asaas `value`. */
  renewal_amount_cents: number;
};

/**
 * Contract places-pagamento §3.3 (20261006170000 D6, BR-B2B-046 item 7): on card, the fee is the
 * pending charge of the Asaas subscription, due on `charge_on` (= `paid_through`, São Paulo). Its
 * DELETE waits until the day after; paid by then it was confirmed, unpaid the DELETE forgives it.
 */
export function earlyTerminationFeeHeld(r: ExpiredCardRow, today: string): boolean {
  if (!r.early_termination_fee_cents || r.early_termination_fee_cents <= 0) return false;
  if (r.early_termination_paid_at || !r.paid_through) return false;
  return today <= saoPauloDate(new Date(r.paid_through));
}

/** `partner.place_commitments_ending()`: renewal off, last fee of the commitment paid. */
type EndingRow = {
  subscription_id: string;
  payment_method: string | null;
  provider_subscription_id: string | null;
};

/**
 * Contract §3.3 and places-portal-rascunho §8.5, in this order: unfinished refunds, expirations (an
 * expired place must not be charged), commitments that end without renewal, then the amount of the
 * next fee. Each part runs even if the one before failed.
 */
export async function runSweep(deps: Deps): Promise<Record<string, unknown>> {
  const summary: Record<string, unknown> = {};

  const refunds = await pendingRefunds(deps);
  summary.refunds = refunds ? await processRefunds(deps, refunds) : 'db_error';

  // places-portal-rascunho §8.4: the Asaas half of a cancel that did not land is redone every day
  // until `paid_through` — the panel no longer offers the button. A read error leaves it for tomorrow.
  try {
    let n = 0;
    for (const r of await deps.cancelsToRedo()) {
      await redoCancelAtAsaas(deps, r, r.paid_through);
      n++;
    }
    summary.cancel_redone = n;
  } catch (e) {
    summary.cancel_redone = 'db_error';
    await deps.alert('sweep_cancel_redo_failed', { error: e instanceof Error ? e.message : 'unknown' });
  }

  // Card and Pix-subscription rows (#898) are ended by `expiredLiveCards` below, not here: the expiry comes at `paid_through`,
  // the same day the early-termination fee is charged, and the DELETE would erase it (§3.3).
  const expired = await deps.admin('partner', 'expire_place_subscriptions', {});
  if (expired.error) {
    summary.expired = 'db_error';
    await deps.alert('sweep_expire_failed', { code: expired.error.code });
  } else {
    let n = 0;
    for (const r of (Array.isArray(expired.data) ? expired.data : []) as ExpiredRow[]) {
      if (!r.provider_subscription_id || r.canceled_at || chargedBySubscription(r.payment_method)) continue;
      if (await endSubscription(deps, r, 'sweep_expire_cancel_failed')) n++;
    }
    summary.expired = n;
  }

  // Every expired card row still live at Asaas, today's and the ones held before: a read error
  // leaves them for tomorrow (they stay expired with `canceled_at` null).
  try {
    let n = 0;
    let held = 0;
    const today = deps.today();
    for (const r of await deps.expiredLiveCards()) {
      if (earlyTerminationFeeHeld(r, today)) {
        held++;
        continue;
      }
      if (await endSubscription(deps, { ...r, payment_method: null }, 'sweep_expire_cancel_failed')) n++;
    }
    summary.expired_card = n;
    summary.fee_held = held;
  } catch (e) {
    summary.expired_card = 'db_error';
    await deps.alert('sweep_expired_cards_failed', { error: e instanceof Error ? e.message : 'unknown' });
  }

  // §8.5: DELETE and not `endDate` — it also removes a fee already generated after the end; a fee
  // still unpaid is forgiven with it (BR-B2B-046 item 7: unpaid fee ends the plan with no debt).
  const ending = await deps.admin('partner', 'place_commitments_ending', {});
  if (ending.error) {
    summary.ended = 'db_error';
    await deps.alert('sweep_ending_failed', { code: ending.error.code });
  } else {
    let n = 0;
    for (const r of (Array.isArray(ending.data) ? ending.data : []) as EndingRow[]) {
      if (await endSubscription(deps, r, 'sweep_end_commitment_failed')) n++;
    }
    summary.ended = n;
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

  // #916: a legacy fee ended in the database whose Asaas subscription is still live (the DELETE failed
  // or the EF died in between) is ended here. The legacy fee falls due on day 20 and this runs daily.
  try {
    let n = 0;
    for (const clientId of await deps.legacyFeesEnded()) {
      try {
        const ended = await endLegacySubscriptions(deps, clientId);
        if (ended > 0) {
          n += ended;
          await deps.alert('legacy_subscription_ended_by_sweep', { client_id: clientId, ended });
        }
      } catch (e) {
        await deps.alert('sweep_legacy_end_failed', { client_id: clientId, error: e instanceof Error ? e.message : 'unknown' });
      }
    }
    summary.legacy_ended = n;
  } catch (e) {
    summary.legacy_ended = 'db_error';
    await deps.alert('sweep_legacy_read_failed', { error: e instanceof Error ? e.message : 'unknown' });
  }

  // #901: invoice settings backfill and the mirror of the invoices, re-read from Asaas.
  try {
    summary.invoices = await reconcileInvoices(deps, await deps.invoiceTargets());
  } catch (e) {
    summary.invoices = 'db_error';
    await deps.alert('sweep_invoices_failed', { error: e instanceof Error ? e.message : 'unknown' });
  }

  // #903: a payout `sent` whose TRANSFER_* webhook was lost is settled from the re-read transfer.
  try {
    summary.payouts = await reconcileSentPayouts(deps, await deps.sentPayouts());
  } catch (e) {
    summary.payouts = 'db_error';
    await deps.alert('sweep_payouts_failed', { error: e instanceof Error ? e.message : 'unknown' });
  }
  return summary;
}

/** Asaas side first (Pix: the authorization too, or the payer's bank keeps a live consent), then `cancel_place_subscription(…'system')`. */
async function endSubscription(
  deps: Deps,
  r: { subscription_id: string; payment_method: string | null; provider_subscription_id: string | null },
  alertKey: string,
): Promise<boolean> {
  try {
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
    return true;
  } catch (e) {
    await deps.alert(alertKey, { subscription_id: r.subscription_id, error: e instanceof Error ? e.message : 'unknown' });
    return false;
  }
}

/**
 * Backstop of `syncNextAmount` (contract §8.2): the Asaas subscription charges `renewal_amount_cents`
 * — voucher diluted in the first commitment, full fee from the renewal on. The date is Asaas's own.
 * Returns true when something was changed.
 */
export async function alignRenewal(deps: Deps, r: ScheduleRow): Promise<boolean> {
  const sub = await deps.asaas.getSubscription(r.provider_subscription_id);
  if (toCents(sub.value) === r.renewal_amount_cents) return false;
  await deps.asaas.updateSubscription(r.provider_subscription_id, { value: toReais(r.renewal_amount_cents), updatePendingPayments: true });
  return true;
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

/** `12345` → `R$ 123,45`, the same format as the portal's `brl`. */
export function formatBrl(cents: number): string {
  const [int, dec] = (Math.round(cents) / 100).toFixed(2).split('.');
  return `R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
}

/** Term 4.5: "a TUGGI confirma o cancelamento por e-mail no ato". Contract places-portal-rascunho §8.4. */
/** The support inbox: where the owner's replies land, and the operator-alert fallback (runtime `alert`). */
export const SUPPORT_EMAIL = 'suporte@tuggi.app';

/** Where the cancel e-mail sends the owner back to (the portal, where the plan is contracted again). */
export const PORTAL_URL = 'https://partner.tuggi.app';

/**
 * Text approved by the operator on 2026-10-08 (written by `design`), in the portal's HTML layout
 * (`portalMail`, sender `ACCESS_FROM_NAME`) like every other portal e-mail. The portal link is the
 * button ("Entrar", the label of `linkEmail`); the text part keeps it as `Entrar: <url>`. Replies go
 * to `SUPPORT_EMAIL` (this e-mail only). `small` is empty: the portal e-mails share no small print.
 */
const CANCEL_ASK_REASON = 'Pode contar para a gente por que cancelou? Basta responder este e-mail. Uma linha já nos ajuda a melhorar.';

export const CANCEL_EMAIL = {
  subject: 'Seu plano Com história foi cancelado',
  replyTo: SUPPORT_EMAIL,
  fromName: ACCESS_FROM_NAME,
  /** `answered` (#913, BR-B2B-060 item 9): the portal survey kept a reason or a comment; the closing thanks instead of asking. */
  build: (until: string | null, fee: CancelFee | null, answered = false): { subject: string; html: string; text: string } => {
    const last = fee
      ? `As mensalidades param aqui. Como o cancelamento veio antes do fim da fidelidade, há uma última cobrança de ${formatBrl(fee.cents)}, a diferença do desconto dos meses usados,`
      : '';
    const feeLines = !fee
      ? ['Você não terá mais nenhuma cobrança.']
      : fee.method === 'credit_card'
        ? [`${last} no seu cartão em ${formatDateBr(fee.chargeOn)}. Depois dela, nada mais é cobrado.`]
        : fee.method === 'pix'
        ? [
            `${last} por Pix, com vencimento em ${formatDateBr(fee.chargeOn)}. O código Pix chega por e-mail antes dessa data. Depois desse pagamento, nada mais é cobrado.`,
          ]
        : [
            `${last} por Pix, com vencimento em ${formatDateBr(fee.chargeOn)}. O Pix Automático já foi encerrado, então esse valor não sai sozinho da sua conta. ${
              fee.invoiceUrl ? `Para pagar, abra ${fee.invoiceUrl}` : 'O código Pix chega por e-mail antes dessa data.'
            }`,
            'Depois desse pagamento, nada mais é cobrado.',
          ];
    return portalMail({
      subject: CANCEL_EMAIL.subject,
      preheader: 'Confirmamos o cancelamento do seu plano Com história.',
      paragraphs: [
        'Olá,',
        'Confirmamos o cancelamento do seu plano Com história. Obrigado por ter mostrado o seu local aos turistas que usam o Tuggi, vamos sentir falta da sua história no app.',
        until
          ? `A história do seu local continua no ar até ${until}. Depois disso, o local segue no mapa do app no plano No mapa, sem custo.`
          : 'O local segue no mapa do app no plano No mapa, sem custo.',
        ...feeLines,
        'Se quiser voltar, o seu local continua cadastrado. É só entrar e contratar o plano Com história de novo.',
      ],
      cta: { label: 'Entrar', url: PORTAL_URL },
      closing: [
        answered
          ? 'Obrigado por contar o motivo no portal. Se quiser dizer mais alguma coisa, é só responder este e-mail.'
          : CANCEL_ASK_REASON,
      ],
      small: [],
    });
  },
};

// ─── legacy clients from before the portal (#916) ─────────────────────────────────────────────

/** A legacy boleto can also be settled by hand in the Asaas panel. */
const LEGACY_PAID_STATUSES = new Set([...PAID_STATUSES, 'RECEIVED_IN_CASH']);

/** The legacy subscriptions still live, by `legacy:<client_id>` only (`findLiveLegacySubscriptions`). */
const liveLegacySubscriptions = (deps: Deps, clientId: string) => findLiveLegacySubscriptions(deps.asaas, clientId);

/**
 * `DELETE` of every live legacy subscription of the client; the number ended. The DELETE also removes
 * the pending and overdue charges and keeps the paid ones (https://docs.asaas.com/reference/remover-assinatura):
 * an overdue legacy fee is forgiven (operator, #916). Throws on an Asaas failure.
 */
export async function endLegacySubscriptions(deps: Deps, clientId: string): Promise<number> {
  const live = await liveLegacySubscriptions(deps, clientId);
  for (const s of live) await deps.asaas.deleteSubscription(s.id);
  return live.length;
}

/**
 * When a cancelled legacy plan ends (operator, #916): with a month already paid — a fee paid whose due
 * date is less than a month ago, or later — on the next due day; otherwise today (`null`).
 */
export function legacyEndsOn(payments: AsaasPayment[], today: string): string | null {
  const monthAgo = addMonths(today, -1);
  const paid = payments.some((p) => LEGACY_PAID_STATUSES.has((p.status ?? '').toUpperCase()) && typeof p.dueDate === 'string' && p.dueDate > monthAgo);
  return paid ? nextLegacyDueDate(today) : null;
}

async function legacyPaidUntil(deps: Deps, clientId: string): Promise<string | null> {
  const payments: AsaasPayment[] = [];
  for (const s of await liveLegacySubscriptions(deps, clientId)) payments.push(...(await deps.asaas.listSubscriptionPayments(s.id)));
  return legacyEndsOn(payments, deps.today());
}

/**
 * The CMS contract subscription of a re-read charge (`legacy:<client_id>`, #917), re-read from Asaas:
 * by the charge's reference, or by its subscription's when it has none of ours. Null = not one.
 * A charge that says `legacy:` and whose subscription cannot be read throws (500, Asaas resends):
 * the registration needs the re-read. One with no reference of ours whose subscription read fails is
 * not legacy (the portal path, as before #916); the `mirror` action recovers it if it was.
 */
async function legacySubscriptionOf(deps: Deps, p: AsaasPayment): Promise<AsaasSubscription | null> {
  const byReference = isLegacySubscriptionReference(p.externalReference);
  if (!p.subscription || (!byReference && subscriptionIdFromReference(p.externalReference))) return null;
  let s: AsaasSubscription;
  try {
    s = await deps.asaas.getSubscription(p.subscription);
  } catch (e) {
    if (byReference) throw e;
    return null;
  }
  return isLegacySubscriptionReference(s.externalReference) ? s : null;
}

export type ContractRegistration =
  | { ok: true; outcome: 'inserted' | 'unchanged'; subscriptionId: string }
  | {
      ok: false;
      /** `db_error` is transient or our defect (`code`); the rest are answers that write nothing. */
      outcome: 'bad_reference' | 'not_paying' | 'no_mirror' | 'subscription_mismatch' | 'amount_mismatch' | 'db_error';
      code?: string | null;
    };

/**
 * `partner.register_contract_place_subscription` (contract §3.8) with the re-read subscription:
 * `customer`, `id`, `value` x 100, and the client of `legacy:<client_id>`. Idempotent by `sub_`.
 * Never throws and never alerts: the webhook and the `mirror` action decide what a refusal means.
 */
export async function registerContractSubscription(deps: Pick<Deps, 'admin'>, s: AsaasSubscription): Promise<ContractRegistration> {
  const clientId = (s.externalReference ?? '').trim().slice(LEGACY_SUBSCRIPTION_PREFIX.length).toLowerCase();
  if (!isUuid(clientId)) return { ok: false, outcome: 'bad_reference' };
  const { data, error } = await deps.admin('partner', 'register_contract_place_subscription', {
    p_client_id: clientId,
    p_provider_customer_id: s.customer ?? null,
    p_provider_subscription_id: s.id,
    p_amount_cents: toCents(s.value),
  });
  if (error) {
    if (error.code === 'TGP10') return { ok: false, outcome: 'not_paying' };
    if (error.code === 'TGP01') return { ok: false, outcome: 'no_mirror' };
    return { ok: false, outcome: 'db_error', code: error.code ?? null };
  }
  const row = firstRow<{ outcome?: string; subscription_id?: string }>(data);
  if ((row?.outcome === 'inserted' || row?.outcome === 'unchanged') && isUuid(row.subscription_id)) {
    return { ok: true, outcome: row.outcome, subscriptionId: row.subscription_id };
  }
  if (row?.outcome === 'subscription_mismatch' || row?.outcome === 'amount_mismatch') return { ok: false, outcome: row.outcome };
  return { ok: false, outcome: 'db_error', code: 'unexpected_outcome' };
}

/** Alert name of a registration that wrote nothing. */
const CONTRACT_ALERTS: Record<string, string> = {
  bad_reference: 'unknown_subscription',
  not_paying: 'legacy_not_paying',
  no_mirror: 'legacy_no_mirror',
  subscription_mismatch: 'subscription_mismatch',
  amount_mismatch: 'amount_mismatch',
};

/**
 * The webhook's answer to a registration that wrote nothing. A database error is a 500 (Demand 7:
 * nothing was claimed, so the resend reprocesses it); a business answer alerts and is a 200.
 */
async function contractRefused(
  deps: Deps,
  reg: Extract<ContractRegistration, { ok: false }>,
  eventId: string,
  eventType: string,
  log: (outcome: string) => void,
  ids: Record<string, string>,
): Promise<Reply> {
  if (reg.outcome === 'db_error') {
    console.error('[places-payment-webhook]', eventId, eventType, 'db_error', reg.code ?? 'unknown');
    if (reg.code === 'TGP22') await deps.alert('webhook_tgp22', { event_id: eventId, event_type: eventType, function: 'register_contract_place_subscription' });
    return reply(500, { error: 'db_error' });
  }
  await deps.alert(CONTRACT_ALERTS[reg.outcome], { event_id: eventId, event_type: eventType, function: 'register_contract_place_subscription', ...ids });
  log(reg.outcome);
  return reply(200, { outcome: reg.outcome });
}

// ─── action `mirror` of places-legacy-customers: the CMS contracts already at Asaas (#918) ──────

export type ContractMirrorStatus = 'would_register' | 'registered' | 'no_subscription' | 'refused' | 'failed';

/** Client id, Asaas ids, outcomes and counts only: never a name, a document or an e-mail. */
export type ContractMirrorOutcome = {
  client_id: string;
  status: ContractMirrorStatus;
  subscription_id?: string;
  /** `register_contract_place_subscription`: inserted | unchanged | the refusal. */
  register?: string;
  /** Dry run: charges by the function that would record them (`none` = still pending). Real run: by outcome. */
  charges?: Record<string, number>;
  code?: string | null;
  /** The contract review date asked for (`YYYY-MM-DD`): what the dry run would write, what the real run wrote. */
  contract_ends_on?: string;
  /** Real run: `set_contract_place_subscription_end` → `updated` | `unchanged` | `db_error:<code>`. */
  contract_ends_on_outcome?: string;
};

/** A `YYYY-MM-DD` that is a real calendar date, else null (`2027-02-30` is null). */
export function calendarDate(raw: unknown): string | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw ? raw : null;
}

/** Event id of a recovered charge: one per charge and status, so a rerun is a `duplicate_event`. */
export const mirrorEventId = (p: AsaasPayment): string => `mirror:${p.id}:${(p.status ?? '').toUpperCase()}`;
export const MIRROR_EVENT_TYPE = 'MIRROR';

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The webhook events of the CMS contracts that passed before #918 (contract §3.8): for each paying
 * client, its live `legacy:<client_id>` subscriptions are registered, then every charge Asaas holds
 * goes to the function the webhook would call, oldest due date first, under `mirrorEventId`.
 * Dry run (the default): Asaas GETs only, no database call. Idempotent: the registration by `sub_`,
 * each charge by its event id (and by `pay_` in the functions). `spacingMs` between two Asaas calls
 * (the rate limit is per account: `LEGACY_ASAAS_SPACING_MS`). An error on one client is its `failed`.
 * `contractEndsOn` (operator 2026-10-08): the internal contract review date, written on each registered
 * row by `set_contract_place_subscription_end`. Not an end: the Asaas subscription has no `endDate`.
 */
export async function mirrorContractSubscriptions(
  deps: Pick<Deps, 'asaas' | 'admin' | 'today'>,
  clientIds: string[],
  dryRun: boolean,
  opts: { spacingMs?: number; sleep?: (ms: number) => Promise<void>; contractEndsOn?: string } = {},
): Promise<ContractMirrorOutcome[]> {
  const endsOn = opts.contractEndsOn ? { contract_ends_on: opts.contractEndsOn } : {};
  const spacing = opts.spacingMs ?? LEGACY_ASAAS_SPACING_MS;
  const sleep = opts.sleep ?? pause;
  let asaasCalls = 0;
  const paced = async <T>(call: () => Promise<T>): Promise<T> => {
    if (asaasCalls++ > 0) await sleep(spacing);
    return await call();
  };
  const outcomes: ContractMirrorOutcome[] = [];
  for (const clientId of clientIds) {
    try {
      const live = await paced(() => findLiveLegacySubscriptions(deps.asaas, clientId));
      if (!live.length) {
        outcomes.push({ client_id: clientId, status: 'no_subscription' });
        continue;
      }
      for (const s of live) {
        const payments = (await paced(() => deps.asaas.listSubscriptionPayments(s.id)))
          .filter((p) => !p.deleted)
          .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
        const charges: Record<string, number> = {};
        const count = (k: string) => (charges[k] = (charges[k] ?? 0) + 1);
        if (dryRun) {
          for (const p of payments) count(paymentAction(MIRROR_EVENT_TYPE, (p.status ?? '').toUpperCase()) ?? 'none');
          outcomes.push({ client_id: clientId, status: 'would_register', subscription_id: s.id, charges, ...endsOn });
          continue;
        }
        const reg = await registerContractSubscription(deps, s);
        if (!reg.ok) {
          outcomes.push({ client_id: clientId, status: reg.outcome === 'db_error' ? 'failed' : 'refused', subscription_id: s.id, register: reg.outcome, code: reg.code });
          continue;
        }
        const ids = { subscriptionId: reg.subscriptionId, providerSubscriptionId: s.id };
        let endsOnOutcome: string | undefined;
        if (opts.contractEndsOn) {
          const { data, error } = await deps.admin('partner', 'set_contract_place_subscription_end', { p_subscription_id: reg.subscriptionId, p_ends_on: opts.contractEndsOn });
          endsOnOutcome = error ? `db_error:${error.code ?? 'unknown'}` : String(firstRow<string>(data) ?? 'unknown');
        }
        for (const p of payments) {
          const action = paymentAction(MIRROR_EVENT_TYPE, (p.status ?? '').toUpperCase());
          if (!action) {
            count('pending');
            continue;
          }
          const { data, error } = await deps.admin('partner', action, paymentArgs(action, mirrorEventId(p), MIRROR_EVENT_TYPE, p, deps.today(), ids));
          count(error ? `db_error:${error.code ?? 'unknown'}` : `${action}:${firstRow<{ outcome?: string }>(data)?.outcome ?? 'unknown'}`);
        }
        outcomes.push({
          client_id: clientId,
          status: 'registered',
          subscription_id: s.id,
          register: reg.outcome,
          charges,
          ...(endsOnOutcome ? { ...endsOn, contract_ends_on_outcome: endsOnOutcome } : {}),
        });
      }
    } catch (e) {
      outcomes.push({ client_id: clientId, status: 'failed', code: e instanceof AsaasError ? (e.status ? `http ${e.status}` : 'network') : 'unexpected' });
    }
  }
  return outcomes;
}

/**
 * The owner of a legacy submission that still pays the fee: the user's JWT proves the owner
 * (`core.portal_get_submission`, whose `legacy_monthly_fee_cents` is set only then) and the client id
 * comes from the database after that (demand 4).
 */
async function legacyPayingOwner(deps: PortalDeps, submissionId: string): Promise<{ clientId: string } | Reply> {
  const { data, error } = await deps.user('core', 'portal_get_submission', { p_submission_id: submissionId });
  if (error) return isBusinessError(error) ? portalErrorReply(error) : reply(502, { error: 'unavailable' });
  const row = firstRow<{ submission_id?: string; legacy_monthly_fee_cents?: number | null }>(data);
  if (!row?.submission_id) return reply(404, { error: 'not_found' });
  const fee = row.legacy_monthly_fee_cents;
  const mark = typeof fee === 'number' && fee > 0 ? await deps.legacyOf(row.submission_id) : null;
  return mark ? { clientId: mark.client_id } : reply(409, { error: 'not_allowed', reason: 'not_legacy_paid' });
}

/** `cancel_legacy_quote` (#916): when the legacy plan would end if cancelled now. Writes nothing. */
export async function legacyCancelQuote(deps: PortalDeps, submissionId: string): Promise<Reply> {
  if (!isUuid(submissionId)) return reply(400, { error: 'invalid', field: 'submission_id' });
  const owner = await legacyPayingOwner(deps, submissionId);
  if (isReply(owner)) return owner;
  try {
    return reply(200, { ends_on: await legacyPaidUntil(deps, owner.clientId) });
  } catch (e) {
    if (e instanceof AsaasError) return reply(502, { error: 'provider_unavailable' });
    throw e;
  }
}

/**
 * `cancel_legacy` (#916): the client from before the portal drops the legacy fee and stays on the map
 * plan, with no fee (operator 2026-10-08, BR-B2B-060). The database first, with the user's JWT
 * (`core.portal_end_legacy_fee` proves the owner, records `legacy_fee_ended_at`, zeroes the fee and
 * answers the client id); then the Asaas subscription, best effort — a failure alerts, and the daily
 * sweep ends it (`legacyFeesEnded`). Then the confirmation e-mail. `ends_on` null = it ended today.
 */
export async function cancelLegacy(deps: PortalDeps, submissionId: string): Promise<Reply> {
  if (!isUuid(submissionId)) return reply(400, { error: 'invalid', field: 'submission_id' });
  const { data, error } = await deps.user('core', 'portal_end_legacy_fee', { p_submission_id: submissionId });
  if (error) {
    if (isBusinessError(error)) return portalErrorReply(error);
    await deps.alert('legacy_cancel_failed', { submission_id: submissionId, code: error.code });
    return reply(502, { error: 'unavailable' });
  }
  const v = Array.isArray(data) ? data[0] : data;
  const clientId = isUuid(v) ? v.toLowerCase() : null;
  let endsOn: string | null = null;
  try {
    if (!clientId) throw new Error('no client id');
    endsOn = await legacyPaidUntil(deps, clientId);
    // The database proved a paying legacy client: no live `legacy:<id>` means the fee may still run
    // under a reference we do not know (security review, #916). The flow does not change.
    if ((await endLegacySubscriptions(deps, clientId)) === 0) {
      await deps.alert('legacy_subscription_not_found', { submission_id: submissionId, client_id: clientId });
    }
  } catch (e) {
    await deps.alert('legacy_subscription_end_failed', { submission_id: submissionId, client_id: clientId, error: e instanceof Error ? e.message : 'unknown' });
  }
  const to = await deps.userEmail();
  if (to) {
    const mail = LEGACY_CANCEL_EMAIL.build(endsOn ? formatDateBr(endsOn) : null);
    const sent = await deps.sendEmail(to, mail.subject, mail.text, { html: mail.html, fromName: ACCESS_FROM_NAME, replyTo: SUPPORT_EMAIL });
    if (!sent) await deps.alert('legacy_cancel_email_failed', { submission_id: submissionId });
  }
  return reply(200, { result: 'canceled', ends_on: endsOn });
}

/**
 * After a new plan is attached (#916): a legacy submission whose fee still runs ends it, `migrated`
 * (`partner.place_end_legacy_fee`), then the legacy Asaas subscription. In this order, so a refused
 * card never leaves the client with no plan. Never fails the checkout: a failure alerts, and the sweep
 * ends the Asaas side of every fee the database ended.
 */
async function endLegacyAfterMigration(deps: Deps, submissionId: string): Promise<void> {
  let mark: LegacyMark | null = null;
  try {
    mark = await deps.legacyOf(submissionId);
    if (!mark) return;
    let endedNow = false;
    if (!mark.fee_ended_at) {
      const { error } = await deps.admin('partner', 'place_end_legacy_fee', { p_submission_id: submissionId, p_reason: 'migrated' });
      // A business refusal: a legacy client that pays no fee (nothing to end).
      if (error && !isBusinessError(error)) throw new Error(`db ${error.code ?? 'unknown'}`);
      endedNow = !error;
    }
    // Only a fee the database ended now proves a paying client: with no live `legacy:<id>`, the fee may
    // still run under a reference we do not know (security review, #916).
    if ((await endLegacySubscriptions(deps, mark.client_id)) === 0 && endedNow) {
      await deps.alert('legacy_subscription_not_found', { submission_id: submissionId, client_id: mark.client_id });
    }
  } catch (e) {
    await deps.alert('legacy_migration_end_failed', { submission_id: submissionId, client_id: mark?.client_id ?? null, error: e instanceof Error ? e.message : 'unknown' });
  }
  // The mirror stays `live`, so the story written in the wizard never enters the CMS review queue:
  // the operator is told there is a story to validate and publish (security review, #916).
  if (mark) await deps.alert('legacy_migrated', { submission_id: submissionId });
}

/**
 * The legacy cancel confirmation. No text for it in the #916 spec: the closing sentence is the spec's
 * own (step 3 of the cancel), in the portal layout and sender of every portal e-mail. `design` validates.
 */
export const LEGACY_CANCEL_EMAIL = {
  subject: 'Seu plano mensal no Tuggi foi cancelado',
  build: (until: string | null): { subject: string; html: string; text: string } =>
    portalMail({
      subject: LEGACY_CANCEL_EMAIL.subject,
      preheader: 'Confirmamos o cancelamento do seu plano.',
      paragraphs: [
        'Olá,',
        'Confirmamos o cancelamento do seu plano mensal, contratado antes do portal.',
        until
          ? `Seu plano termina em ${until}, quando acabaria o mês já pago. Depois disso não há nova cobrança nem taxa de saída.`
          : 'Seu plano termina hoje. Não há cobrança nem taxa de saída.',
        'O seu local continua no mapa do app, sem custo.',
      ],
      cta: { label: 'Entrar', url: PORTAL_URL },
      // The legacy cancel has no reason step (design, #916): the e-mail is where the reason comes from.
      closing: [CANCEL_ASK_REASON],
      small: [],
    }),
};

// ─── portal: payout Pix key (#904) ─────────────────────────────────────────────────────────────

/**
 * The owner confirms the payout Pix key (contract places-pagamento §3.5, term 5.4, BR-B2B-044). No
 * key comes from the request: `core.portal_confirm_payout_pix_key` proves the owner by `auth.uid()`,
 * writes the contract's CNPJ and returns the canonical key. Then the anti-fraud e-mail, at EVERY
 * confirmation (design spec of #904 §4), to the session's e-mail (confirmed by the access link) —
 * a failure there alerts the operator and does not undo the key.
 *
 * Called only through this EF (with the user's JWT), never from the browser: the e-mail is the side
 * effect, like `portal_request_refund` (§3.4). TGP01 → 404, TGP10 (`not_paid_plan` | `refused`) → 409.
 */
export async function confirmPixKey(deps: PortalDeps, submissionId: string): Promise<Reply> {
  if (!isUuid(submissionId)) return reply(400, { error: 'invalid', field: 'submission_id' });
  const { data, error } = await deps.user('core', 'portal_confirm_payout_pix_key', { p_submission_id: submissionId });
  if (error) {
    if (isBusinessError(error)) return portalErrorReply(error);
    await deps.alert('pix_key_confirm_failed', { code: error.code });
    return reply(502, { error: 'unavailable' });
  }
  const key = typeof data === 'string' ? data : null;
  if (!key) {
    await deps.alert('pix_key_confirm_failed', { code: 'empty' });
    return reply(502, { error: 'unavailable' });
  }

  const to = await deps.userEmail();
  const sub = await deps.user('core', 'portal_get_submission', { p_submission_id: submissionId });
  const answers = (firstRow<{ answers?: Record<string, unknown> }>(sub.data)?.answers ?? {}) as Record<string, unknown>;
  const text = PIX_KEY_EMAIL.text({
    firstName: firstNameOf(answers.representative_name),
    placeName: typeof answers.trade_name === 'string' ? answers.trade_name.trim() : '',
    key,
    at: deps.now(),
  });
  const sent = to ? await deps.sendEmail(to, PIX_KEY_EMAIL.subject, text) : false;
  if (!sent) await deps.alert('pix_key_email_failed', { submission_id: submissionId });
  return reply(200, { result: 'confirmed', pix_key: key });
}

const firstNameOf = (v: unknown): string => (typeof v === 'string' ? (v.trim().split(/\s+/)[0] ?? '') : '');

/** Canonical CNPJ (14 chars, alphanumeric allowed) → `12.ABC.345/01DE-35`; same as the portal's `formatCnpj` (`tuggi-places/src/lib/cnpj.ts`). */
export function formatCnpjKey(key: string): string {
  const c = key.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (c.length !== 14) return c;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

/** `dd/mm/aaaa` and `hh:mm` in America/Sao_Paulo. */
export function saoPauloDateTime(d: Date): { date: string; time: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.day}/${p.month}/${p.year}`, time: `${p.hour}:${p.minute}` };
}

/** Anti-fraud notice of #904 (design spec §4). States only the key, the place and the moment. */
export const PIX_KEY_EMAIL = {
  subject: 'Chave Pix confirmada no portal Tuggi',
  text: (v: { firstName: string; placeName: string; key: string; at: Date }) => {
    const { date, time } = saoPauloDateTime(v.at);
    const where = v.placeName ? `no portal do ${v.placeName}` : 'no portal Tuggi';
    return [
      v.firstName ? `Olá, ${v.firstName}.` : 'Olá.',
      '',
      `A chave Pix CNPJ ${formatCnpjKey(v.key)} foi confirmada ${where} em ${date}, às ${time}. É nela que a Tuggi paga a sua comissão.`,
      '',
      'Não foi você? Responda este e-mail agora.',
      '',
      'Equipe Tuggi',
    ].join('\n');
  },
};
