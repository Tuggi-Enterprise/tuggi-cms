// _shared/places-legacy-customers.ts — the partners that pay R$ 100/month from before the portal:
// registered as Asaas customers (`registerLegacyCustomers`), then given their monthly fee
// subscription (`createLegacySubscriptions`, #917). Two actions of the same function, run apart.
//
// Caller: `places-legacy-customers/index.ts`, run by hand by the operator. Pure and import-free but
// the types, so the CMS tests run it under Node against a mocked Asaas.
//
// Idempotent: the customer is found by `externalReference` = `core.clients.id` first, then by
// CPF/CNPJ (Asaas allows duplicates, docs.asaas.com/reference/criar-novo-cliente: a customer the
// operator created by hand in the panel is adopted, not doubled). An existing customer gets only the
// fields it lacks; a value already there is reported in `differs` and never overwritten.
//
// WhatsApp: Asaas creates the customer's notifications with the customer; we switch
// `whatsappEnabledForCustomer` on in the ones that are enabled, one `PUT /v3/notifications/{id}` each
// (doc conferred 2026-10-08). Not the batch route: an event that refuses WhatsApp ("Evento inválido
// para ativação da notificação por WhatsApp", production 2026-10-08) fails the whole batch, and the doc
// does not list which events accept it. That refusal is `skipped`, not `failed`. An existing customer
// goes through this step too, so a rerun fixes the ones already created. Asaas charges a fee per
// notification sent.
//
// Never log what this returns: it carries name and address number. CPF/CNPJ, phone and e-mail leave
// masked.

import { AsaasError, type AsaasClient, type AsaasCustomer, type AsaasCustomerPatch, type AsaasSubscription } from './asaas.ts';

/** Who is a legacy partner (measured 2026-10-08: 7 rows). `pending` stays out. */
export const LEGACY_FILTER = { client_type: 'venue', status: 'approved', monthly_fee_cents: 10000, is_courtesy: false } as const;

export const LEGACY_COLUMNS = 'id, name, company_name, email, billing_email, phone, tax_id, postal_code, address';

export type LegacyClientRow = {
  id: string;
  name?: string | null;
  company_name?: string | null;
  email?: string | null;
  billing_email?: string | null;
  phone?: string | null;
  tax_id?: string | null;
  postal_code?: string | null;
  address?: string | null;
};

export type LegacyCustomer = {
  name: string;
  cpfCnpj: string;
  email: string;
  mobilePhone: string;
  postalCode: string;
  addressNumber: string;
  externalReference: string;
  notificationDisabled: false;
};

type Field = Exclude<keyof LegacyCustomer, 'externalReference' | 'notificationDisabled'>;
const FIELDS: Field[] = ['name', 'cpfCnpj', 'email', 'mobilePhone', 'postalCode', 'addressNumber'];

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const digits = (v: unknown) => str(v).replace(/\D/g, '');

/** CPF (11 digits) or CNPJ (14, alphanumeric since 2026-07), the same check as the portal checkout. */
export function normalizeCpfCnpj(raw: unknown): string {
  const v = str(raw).replace(/[.\-/\s]/g, '').toUpperCase();
  return /^(\d{11}|[0-9A-Z]{12}\d{2})$/.test(v) ? v : '';
}

/** A Brazilian mobile, DDD + 9 + 8 digits, with the `+55` taken off. Landline or foreign = ''. */
export function normalizeMobile(raw: unknown): string {
  let d = digits(raw);
  if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
  return /^[1-9]{2}9\d{8}$/.test(d) ? d : '';
}

/**
 * The street number inside the one-line `core.clients.address`: the number that ends the first
 * part ("Rua X 359, Centro") or the second part alone ("Rua X, 40, Centro", "Rua X, nº 40").
 * Anything else is '' and the client is reported, never guessed.
 */
export function extractAddressNumber(raw: unknown): string {
  const parts = str(raw).split(',').map((p) => p.trim());
  const first = /(?:^|\s)(\d{1,6})$/.exec(parts[0] ?? '');
  if (first && parts[0] !== first[1]) return first[1];
  const second = /^(?:n[º°o.]?\s*|n[uú]mero\s*)?(\d{1,6})$/i.exec(parts[1] ?? '');
  return second ? second[1] : '';
}

export function buildLegacyCustomer(row: LegacyClientRow): { customer: LegacyCustomer; missing: Field[] } {
  const email = str(row.billing_email) || str(row.email);
  const postalCode = digits(row.postal_code);
  const customer: LegacyCustomer = {
    name: (str(row.company_name) || str(row.name)).slice(0, 100),
    cpfCnpj: normalizeCpfCnpj(row.tax_id),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
    mobilePhone: normalizeMobile(row.phone),
    postalCode: postalCode.length === 8 ? postalCode : '',
    addressNumber: extractAddressNumber(row.address),
    externalReference: row.id,
    notificationDisabled: false,
  };
  return { customer, missing: FIELDS.filter((f) => !customer[f]) };
}

const mask = (v: string, keepStart: number, keepEnd: number) =>
  v.length <= keepStart + keepEnd ? '*'.repeat(v.length) : v.slice(0, keepStart) + '*'.repeat(v.length - keepStart - keepEnd) + v.slice(v.length - keepEnd);

export function maskCustomer(c: LegacyCustomer): LegacyCustomer {
  const [user, domain] = c.email.split('@');
  return {
    ...c,
    cpfCnpj: c.cpfCnpj && mask(c.cpfCnpj, 2, 2),
    mobilePhone: c.mobilePhone && mask(c.mobilePhone, 2, 2),
    email: c.email && `${mask(user, 1, 0)}@${domain}`,
  };
}

/** Which Asaas the secret points at, from `ASAAS_BASE_URL`. */
export function asaasEnvironment(baseUrl: string): 'production' | 'sandbox' | 'unknown' {
  const host = (() => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return '';
    }
  })();
  return host === 'api.asaas.com' ? 'production' : host === 'api-sandbox.asaas.com' ? 'sandbox' : 'unknown';
}

export type LegacyStatus = 'would_create' | 'would_update' | 'unchanged' | 'created' | 'updated' | 'failed';

export type LegacyOutcome = {
  client_id: string;
  status: LegacyStatus;
  asaas_id?: string;
  /** Dry run: what would be sent, masked. */
  payload?: LegacyCustomer | AsaasCustomerPatch;
  missing?: Field[];
  /** Fields Asaas already has with another value: kept, not overwritten. */
  differs?: string[];
  whatsapp?: WhatsappResult | { would_switch_on: number | 'after_create' } | { failed: string };
  description?: string;
};

/** Events, by name. `errors`: any refusal other than the event not accepting WhatsApp. */
export type WhatsappResult = { switched_on: string[]; skipped: string[]; errors?: { event: string; description: string }[] };

function describe(e: unknown): string {
  if (e instanceof AsaasError) {
    return e.descriptions.join('; ') || e.codes.join(',') || (e.status ? `http ${e.status}` : 'network or timeout');
  }
  return 'unexpected error';
}

type Found = { customer: AsaasCustomer | null } | { duplicate: number };

async function findExisting(asaas: AsaasClient, clientId: string, cpfCnpj: string): Promise<Found> {
  const byRef = await asaas.findCustomerByReference(clientId);
  if (byRef && !byRef.deleted) return { customer: byRef };
  if (!cpfCnpj) return { customer: null };
  const free = (await asaas.findCustomersByCpfCnpj(cpfCnpj)).filter((c) => !c.deleted && !str(c.externalReference));
  if (free.length > 1) return { duplicate: free.length };
  return { customer: free[0] ?? null };
}

/** What an existing customer lacks, and what it has with another value. */
function diff(existing: AsaasCustomer, wanted: LegacyCustomer): { patch: AsaasCustomerPatch; differs: string[] } {
  const patch: AsaasCustomerPatch = {};
  const differs: string[] = [];
  const norm = (f: Field, v: unknown) => (f === 'email' || f === 'name' ? str(v).toLowerCase() : str(v).replace(/[^0-9A-Za-z]/g, '').toUpperCase());
  for (const f of FIELDS) {
    if (!wanted[f]) continue;
    const have = str(existing[f]);
    if (!have) patch[f] = wanted[f];
    else if (norm(f, have) !== norm(f, wanted[f])) differs.push(f);
  }
  if (!str(existing.externalReference)) patch.externalReference = wanted.externalReference;
  if (existing.notificationDisabled !== false) patch.notificationDisabled = false;
  return { patch, differs };
}

/** The enabled notifications still without WhatsApp. */
async function whatsappTargets(asaas: AsaasClient, customerId: string) {
  return (await asaas.listCustomerNotifications(customerId)).filter((n) => !n.deleted && n.enabled !== false && n.whatsappEnabledForCustomer !== true);
}

async function processOne(asaas: AsaasClient, row: LegacyClientRow, dryRun: boolean): Promise<LegacyOutcome> {
  const { customer, missing } = buildLegacyCustomer(row);
  const out: LegacyOutcome = { client_id: row.id, status: 'failed' };
  if (missing.length) out.missing = missing;

  let found: Found;
  try {
    found = await findExisting(asaas, row.id, customer.cpfCnpj);
  } catch (e) {
    return { ...out, status: 'failed', description: `lookup: ${describe(e)}` };
  }
  if ('duplicate' in found) {
    return { ...out, status: 'failed', description: `${found.duplicate} Asaas customers with this CPF/CNPJ and no externalReference: pick one by hand` };
  }
  const existing = found.customer;

  if (!existing) {
    if (dryRun) return { ...out, status: 'would_create', payload: maskCustomer(customer), whatsapp: { would_switch_on: 'after_create' } };
    if (missing.length) return { ...out, status: 'failed', description: `missing in core.clients: ${missing.join(', ')}` };
    let created: AsaasCustomer;
    try {
      created = await asaas.createCustomer(customer);
    } catch (e) {
      return { ...out, status: 'failed', description: describe(e) };
    }
    return { ...out, status: 'created', asaas_id: created.id, whatsapp: await switchWhatsapp(asaas, created.id) };
  }

  const { patch, differs } = diff(existing, customer);
  const result: LegacyOutcome = { ...out, asaas_id: existing.id, ...(differs.length ? { differs } : {}) };
  const changes = Object.keys(patch).length > 0;

  if (dryRun) {
    let whatsapp: LegacyOutcome['whatsapp'];
    try {
      whatsapp = { would_switch_on: (await whatsappTargets(asaas, existing.id)).length };
    } catch (e) {
      whatsapp = { failed: describe(e) };
    }
    const masked = { ...patch, ...(patch.cpfCnpj ? { cpfCnpj: mask(patch.cpfCnpj, 2, 2) } : {}), ...(patch.mobilePhone ? { mobilePhone: mask(patch.mobilePhone, 2, 2) } : {}), ...(patch.email ? { email: maskCustomer({ ...customer, email: patch.email }).email } : {}) };
    const pending = changes || ('would_switch_on' in whatsapp && whatsapp.would_switch_on !== 0);
    return { ...result, status: pending ? 'would_update' : 'unchanged', ...(changes ? { payload: masked } : {}), whatsapp };
  }

  if (changes) {
    try {
      await asaas.updateCustomer(existing.id, patch);
    } catch (e) {
      return { ...result, status: 'failed', description: describe(e) };
    }
  }
  const whatsapp = await switchWhatsapp(asaas, existing.id);
  const switched = 'switched_on' in whatsapp && whatsapp.switched_on.length > 0;
  return { ...result, status: changes || switched ? 'updated' : 'unchanged', whatsapp };
}

/** Asaas's refusal for an event that does not take WhatsApp. No documented code: matched on the text. */
const WHATSAPP_REFUSED = /evento inv[aá]lido/i;

async function switchWhatsapp(asaas: AsaasClient, customerId: string): Promise<WhatsappResult | { failed: string }> {
  let targets: Awaited<ReturnType<typeof whatsappTargets>>;
  try {
    targets = await whatsappTargets(asaas, customerId);
  } catch (e) {
    return { failed: describe(e) };
  }
  const out: WhatsappResult = { switched_on: [], skipped: [] };
  for (const n of targets) {
    const event = n.event ?? n.id;
    try {
      await asaas.updateNotification(n.id, { whatsappEnabledForCustomer: true });
      out.switched_on.push(event);
    } catch (e) {
      if (e instanceof AsaasError && e.descriptions.some((d) => WHATSAPP_REFUSED.test(d))) out.skipped.push(event);
      else (out.errors ??= []).push({ event, description: describe(e) });
    }
  }
  return out;
}

/** One client at a time: an Asaas error on one becomes its `failed` and the others go on. */
export async function registerLegacyCustomers(asaas: AsaasClient, rows: LegacyClientRow[], dryRun: boolean): Promise<LegacyOutcome[]> {
  const outcomes: LegacyOutcome[] = [];
  for (const row of rows) outcomes.push(await processOne(asaas, row, dryRun));
  return outcomes;
}

/** `{ "dry_run": false }` executes; anything else, an empty body included, is a dry run. */
export function isDryRun(body: unknown): boolean {
  return !(body && typeof body === 'object' && (body as Record<string, unknown>).dry_run === false);
}

// ─── the legacy subscription at Asaas (#916) ───────────────────────────────────────────────────

/**
 * `externalReference` of the legacy monthly fee's Asaas subscription: `legacy:<core.clients.id>`.
 * Never the bare uuid: the portal webhook reads a uuid on the customer as a `place_subscriptions` id
 * (`chargeIds`), and every legacy charge would become an `unknown_subscription` alert. The portal's
 * own subscriptions use `com_historia_<n>m:<uuid>` on the same customer, so this prefix is what tells
 * the two apart when the legacy one is ended (`places-payment.ts` `endLegacySubscriptions`).
 */
export const LEGACY_SUBSCRIPTION_PREFIX = 'legacy:';

export const legacySubscriptionReference = (clientId: string): string => `${LEGACY_SUBSCRIPTION_PREFIX}${clientId.trim().toLowerCase()}`;

export const isLegacySubscriptionReference = (ref: unknown): boolean =>
  typeof ref === 'string' && ref.trim().toLowerCase().startsWith(LEGACY_SUBSCRIPTION_PREFIX);

/**
 * Due day of the legacy fee: the same value as `DUE_DAY_OF_MONTH` of the CMS contract
 * (`lib/contract/template.ts`), which Deno cannot import. `tests/api/edge-places-legacy-access.test.ts`
 * holds the two equal.
 */
export const LEGACY_DUE_DAY = 20;

/** The first day `LEGACY_DUE_DAY` strictly after `today` (`YYYY-MM-DD`). */
export function nextLegacyDueDate(today: string): string {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  if (Number(today.slice(8, 10)) >= LEGACY_DUE_DAY) {
    m += 1;
    if (m > 12) [y, m] = [y + 1, 1];
  }
  return `${y}-${String(m).padStart(2, '0')}-${String(LEGACY_DUE_DAY).padStart(2, '0')}`;
}

/**
 * The legacy Asaas subscriptions still live, found by `legacy:<client_id>` and only by it: the
 * portal's subscription on the same customer (`com_historia_<n>m:<uuid>`) is never touched. The
 * `GET /v3/subscriptions?externalReference=` filter (docs.asaas.com/reference/listar-assinaturas,
 * conferred 2026-10-08) is re-checked here for an exact match.
 */
export async function findLiveLegacySubscriptions(asaas: Pick<AsaasClient, 'listSubscriptionsByReference'>, clientId: string): Promise<AsaasSubscription[]> {
  const ref = legacySubscriptionReference(clientId);
  return (await asaas.listSubscriptionsByReference(ref)).filter(
    (s) => !s.deleted && s.status === 'ACTIVE' && (s.externalReference ?? '').trim().toLowerCase() === ref,
  );
}

// ─── action `subscriptions`: the legacy monthly fee at Asaas (#917) ────────────────────────────

export const LEGACY_FEE_COLUMNS = 'id, monthly_fee_cents';

export type LegacyFeeRow = { id: string; monthly_fee_cents?: number | null };

export const LEGACY_SUBSCRIPTION_DESCRIPTION = 'Tuggi: mensalidade do local no app';

/** Pause between two clients: the Asaas rate limit is per account, and it blocked the account (and the portal checkout with it) on 2026-10-08. */
export const LEGACY_ASAAS_SPACING_MS = 1000;

export type LegacySubscriptionPayload = {
  customer: string;
  value: number;
  nextDueDate: string;
  cycle: 'MONTHLY';
  description: string;
  externalReference: string;
};

export type LegacySubscriptionStatus = 'would_create' | 'created' | 'already' | 'no_customer' | 'failed';

/** No name, e-mail or CPF/CNPJ: client id and Asaas ids only. */
export type LegacySubscriptionOutcome = {
  client_id: string;
  status: LegacySubscriptionStatus;
  customer_id?: string;
  subscription_id?: string;
  payload?: LegacySubscriptionPayload;
  description?: string;
};

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function subscribeOne(asaas: AsaasClient, row: LegacyFeeRow, dryRun: boolean, nextDueDate: string): Promise<LegacySubscriptionOutcome> {
  const out: LegacySubscriptionOutcome = { client_id: row.id, status: 'failed' };
  const cents = row.monthly_fee_cents;
  if (typeof cents !== 'number' || !Number.isInteger(cents) || cents <= 0) return { ...out, description: 'monthly_fee_cents is not a positive integer' };

  let customer: AsaasCustomer | null;
  try {
    customer = await asaas.findCustomerByReference(row.id);
  } catch (e) {
    return { ...out, description: `customer lookup: ${describe(e)}` };
  }
  if (!customer || customer.deleted) return { ...out, status: 'no_customer' };
  out.customer_id = customer.id;

  let live: AsaasSubscription[];
  try {
    live = await findLiveLegacySubscriptions(asaas, row.id);
  } catch (e) {
    return { ...out, description: `subscription lookup: ${describe(e)}` };
  }
  if (live.length) return { ...out, status: 'already', subscription_id: live[0].id };

  const payload: LegacySubscriptionPayload = {
    customer: customer.id,
    value: cents / 100,
    nextDueDate,
    cycle: 'MONTHLY',
    description: LEGACY_SUBSCRIPTION_DESCRIPTION,
    externalReference: legacySubscriptionReference(row.id),
  };
  if (dryRun) return { ...out, status: 'would_create', payload };
  try {
    const created = await asaas.createUndefinedSubscription(payload);
    return { ...out, status: 'created', subscription_id: created.id };
  } catch (e) {
    return { ...out, description: describe(e) };
  }
}

/**
 * One monthly subscription per legacy client, `billingType: UNDEFINED` (boleto or Pix, the payer
 * picks), first due on the next `LEGACY_DUE_DAY` after `today` (São Paulo), no `endDate`.
 * Idempotent by `legacy:<client_id>`: a client with one live is `already`, never doubled. A client
 * without an Asaas customer is `no_customer` (run the `customers` action first). One client at a
 * time, `spacingMs` apart; an error on one becomes its `failed` and the others go on.
 */
export async function createLegacySubscriptions(
  asaas: AsaasClient,
  rows: LegacyFeeRow[],
  dryRun: boolean,
  today: string,
  opts: { spacingMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<LegacySubscriptionOutcome[]> {
  const spacing = opts.spacingMs ?? LEGACY_ASAAS_SPACING_MS;
  const sleep = opts.sleep ?? sleepMs;
  const nextDueDate = nextLegacyDueDate(today);
  const outcomes: LegacySubscriptionOutcome[] = [];
  for (const [i, row] of rows.entries()) {
    if (i > 0) await sleep(spacing);
    outcomes.push(await subscribeOne(asaas, row, dryRun, nextDueDate));
  }
  return outcomes;
}
