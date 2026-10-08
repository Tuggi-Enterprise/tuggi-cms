// _shared/places-legacy-customers.ts — the partners that pay R$ 100/month from before the portal,
// registered as Asaas customers (customer only: no subscription, no charge).
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
// `whatsappEnabledForCustomer` on in the ones that are enabled (`PUT /v3/notifications/batch`, doc
// conferred 2026-10-08). Asaas charges a fee per notification sent.
//
// Never log what this returns: it carries name and address number. CPF/CNPJ, phone and e-mail leave
// masked.

import { AsaasError, type AsaasClient, type AsaasCustomer, type AsaasCustomerPatch } from './asaas.ts';

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
  whatsapp?: { switched_on: number } | { would_switch_on: number | 'after_create' } | { failed: string };
  description?: string;
};

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
  const switched = 'switched_on' in whatsapp && whatsapp.switched_on > 0;
  return { ...result, status: changes || switched ? 'updated' : 'unchanged', whatsapp };
}

async function switchWhatsapp(asaas: AsaasClient, customerId: string): Promise<{ switched_on: number } | { failed: string }> {
  try {
    const targets = await whatsappTargets(asaas, customerId);
    if (targets.length) await asaas.updateNotifications(customerId, targets.map((n) => ({ id: n.id, whatsappEnabledForCustomer: true })));
    return { switched_on: targets.length };
  } catch (e) {
    return { failed: describe(e) };
  }
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
