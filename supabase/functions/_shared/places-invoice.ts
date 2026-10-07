// _shared/places-invoice.ts — the NFS-e of the Com história plan (#901, mirror #900).
//
// Term 3.5: "os valores incluem os tributos devidos pela TUGGI, que emite o documento fiscal".
// Contract: `docs/contracts/places-pagamento.md` §0 and §3.5 (workspace). BR-B2B-046.
//
// When the invoice is issued (operator, 2026-10-07): in the month of the PAYMENT.
//   - Monthly fee: the Asaas subscription carries `invoiceSettings` with
//     `effectiveDatePeriod: ON_PAYMENT_CONFIRMATION` — set on creation (`configureSubscriptionInvoices`)
//     and by the daily sweep for any live subscription still without it (backfill, `reconcileInvoices`).
//   - One-off charge (no `subscription`: the early-termination fee of a Pix Automático plan, and the
//     first QR charge of journey 3): scheduled with `effectiveDate` = the day the confirmation arrives
//     (`ensureOneOffInvoice`), never before the money.
//   - Free month: no payment, so no invoice.
//
// The mirror (`partner.record_place_invoice`) is an upsert by `inv_` of the RE-READ invoice, so a
// resent or out-of-order `INVOICE_*` event converges: the Asaas event `id` is not needed as a key.
// The sweep re-reads the invoices of every live customer and records them the same way: the CMS
// does not depend on a webhook that got lost.
//
// Tax configuration comes from the Edge secrets (no default, nothing in code):
//   ASAAS_INVOICE_SERVICE_CODE  municipal service code (`municipalServiceCode`), from the accountant;
//   ASAAS_INVOICE_SERVICE_NAME  its name (`municipalServiceName`, required to schedule an invoice);
//   ASAAS_INVOICE_ISS_RATE      ISS rate in percent (`taxes.iss`, e.g. `2` or `2.5`).
// Without all three, nothing is configured nor scheduled: one alert per subscription, never a failed
// checkout. PIS, COFINS, CSLL, INSS and IR go as 0 and ISS is not withheld by the taker.
//
// Never log an invoice body: it carries the taker's CPF/CNPJ, name and e-mail.

import type { AsaasClient, AsaasInvoice, AsaasInvoiceTaxes, AsaasPayment } from './asaas.ts';
import { AsaasError } from './asaas.ts';
import type { Rpc } from './places-payment.ts';
import { formatBrl, isUuid, subscriptionIdFromReference, toCents } from './places-payment.ts';

export type InvoiceConfig = { serviceCode: string; serviceName: string; issRate: number };

export type InvoiceDeps = {
  asaas: AsaasClient;
  admin: Rpc;
  alert: (what: string, fields: Record<string, string | number | null | undefined>) => Promise<void>;
  today: () => string;
  /** null = the three secrets are not all set (or the rate is invalid). */
  invoiceConfig: InvoiceConfig | null;
  /** The mirror's current status of an `inv_`, null when not mirrored yet. */
  invoiceStatusOf: (providerInvoiceId: string) => Promise<string | null>;
  sendEmail: (to: string, subject: string, text: string) => Promise<boolean>;
};

/** A live (or just ended) plan the sweep reconciles. */
export type InvoiceTarget = {
  subscription_id: string;
  provider_subscription_id: string | null;
  provider_customer_id: string | null;
};

export const INVOICE_ENV = {
  serviceCode: 'ASAAS_INVOICE_SERVICE_CODE',
  serviceName: 'ASAAS_INVOICE_SERVICE_NAME',
  issRate: 'ASAAS_INVOICE_ISS_RATE',
} as const;

/** Reads the three secrets; any missing, or a rate outside 0–5 %, → null. */
export function parseInvoiceConfig(get: (name: string) => string | undefined): InvoiceConfig | null {
  const serviceCode = (get(INVOICE_ENV.serviceCode) ?? '').trim();
  const serviceName = (get(INVOICE_ENV.serviceName) ?? '').trim();
  const rawRate = (get(INVOICE_ENV.issRate) ?? '').trim().replace(',', '.');
  const issRate = rawRate === '' ? NaN : Number(rawRate);
  if (!serviceCode || !serviceName || !Number.isFinite(issRate) || issRate < 0 || issRate > 5) return null;
  return { serviceCode, serviceName, issRate };
}

const taxesOf = (c: InvoiceConfig): AsaasInvoiceTaxes => ({ retainIss: false, iss: c.issRate, pis: 0, cofins: 0, csll: 0, inss: 0, ir: 0 });

const OBSERVATIONS = 'Tuggi · Com história';

/** The statuses `partner.record_place_invoice` accepts — exactly the Asaas ones (doc + webhook, 2026-10-07). */
export const INVOICE_STATUSES = [
  'SCHEDULED',
  'SYNCHRONIZED',
  'AUTHORIZED',
  'PROCESSING_CANCELLATION',
  'CANCELED',
  'CANCELLATION_DENIED',
  'ERROR',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Asaas status → mirror status; anything else (a status Asaas adds later) → null, never a guess. */
export function invoiceStatus(raw: unknown): InvoiceStatus | null {
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return (INVOICE_STATUSES as readonly string[]).includes(s) ? (s as InvoiceStatus) : null;
}

/** Still able to become (or already is) a valid document: what a refund must cancel. */
const CANCELLABLE = new Set<InvoiceStatus>(['SCHEDULED', 'SYNCHRONIZED', 'AUTHORIZED']);
/** An invoice that exists or will: a one-off payment that has one is not scheduled again. */
const LIVE = new Set<InvoiceStatus>(['SCHEDULED', 'SYNCHRONIZED', 'AUTHORIZED', 'PROCESSING_CANCELLATION', 'CANCELLATION_DENIED']);

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Arguments of `partner.record_place_invoice` from the re-read invoice. Null when it has no payment. */
export function invoiceRecordArgs(inv: AsaasInvoice, status: InvoiceStatus, subscriptionHint: string | null = null): Record<string, unknown> | null {
  const payment = str(inv.payment);
  if (!payment) return null;
  const ref = str(inv.externalReference);
  const fromRef = ref && isUuid(ref) ? ref.toLowerCase() : subscriptionIdFromReference(ref);
  return {
    p_provider_invoice_id: inv.id,
    p_provider_payment_id: payment,
    p_subscription_id: fromRef ?? subscriptionHint,
    p_status: status,
    p_number: str(inv.number),
    p_pdf_url: str(inv.pdfUrl),
    p_xml_url: str(inv.xmlUrl),
    p_effective_date: str(inv.effectiveDate)?.slice(0, 10) ?? null,
    p_status_description: str(inv.statusDescription),
    p_amount_cents: typeof inv.value === 'number' ? toCents(inv.value) : null,
  };
}

const MIRROR_ALERTS = new Set(['unknown_subscription', 'subscription_mismatch', 'payment_mismatch']);

/** Text by the design (#901, comment 6040645900). A null number or value drops its line. */
export const INVOICE_EMAIL = {
  subject: 'Nota fiscal da sua mensalidade Com história',
  text: (pdfUrl: string, number: string | null, valueCents: number | null) => {
    const facts = [number ? `Número: ${number}` : null, valueCents !== null ? `Valor: ${formatBrl(valueCents)}` : null].filter((l): l is string => !!l);
    return [
      'Olá,',
      '',
      'A nota fiscal da sua mensalidade do plano Com história foi emitida.',
      '',
      ...(facts.length ? [...facts, ''] : []),
      `Para baixar o PDF, abra: ${pdfUrl}`,
      '',
      'Equipe Tuggi',
    ].join('\n');
  },
};

/**
 * A database error retrying cannot fix: the function or the table is not there (migration not
 * applied — `PGRST202`/`42883`, `PGRST205`/`42P01`) or the data is refused (`TGP22`). The webhook
 * answers 200 to these: Asaas pauses the whole queue after 15 non-200 answers in a row
 * (https://docs.asaas.com/docs/fila-pausada), and the `INVOICE_*` queue is the `PAYMENT_*` one.
 * The daily sweep re-reads and records once the cause is fixed.
 */
const PERMANENT_DB_CODES = new Set(['PGRST202', '42883', 'PGRST205', '42P01', 'TGP22']);
export const isPermanentDbError = (code: string | null | undefined) => !!code && PERMANENT_DB_CODES.has(code);

/** Thrown by `InvoiceDeps.invoiceStatusOf` when the mirror cannot be read; carries the database code. */
export class MirrorReadError extends Error {
  constructor(readonly code: string | null) {
    super(`invoice read ${code ?? 'unknown'}`);
  }
}

/**
 * Records one re-read invoice in the mirror. Returns the database outcome, or `ignored` (no payment),
 * `unknown_status`, `db_error` (transient: the caller decides between 500 and "tomorrow") or
 * `db_rejected` (permanent, already alerted: see `isPermanentDbError`).
 *
 * Delivery (#901 item 6): the Asaas doc says `notificationDisabled` turns off the BILLING
 * notifications and says nothing about the invoice e-mail, so the Tuggi sends the PDF link itself,
 * once — when the mirror goes from not-AUTHORIZED to AUTHORIZED. A resend finds it AUTHORIZED
 * (`unchanged`/`updated` from AUTHORIZED) and sends nothing.
 */
export async function recordInvoice(deps: InvoiceDeps, inv: AsaasInvoice, subscriptionHint: string | null = null): Promise<string> {
  const status = invoiceStatus(inv.status);
  if (!status) {
    await deps.alert('invoice_unknown_status', { provider_invoice_id: inv.id, status: String(inv.status ?? '') });
    return 'unknown_status';
  }
  const args = invoiceRecordArgs(inv, status, subscriptionHint);
  if (!args) return 'ignored';
  let before: string | null = null;
  try {
    if (status === 'AUTHORIZED') before = await deps.invoiceStatusOf(inv.id);
  } catch (e) {
    const code = e instanceof MirrorReadError ? e.code : null;
    console.error('[places-invoice] invoice status read', inv.id, code ?? 'unknown');
    if (!isPermanentDbError(code)) return 'db_error';
    await deps.alert('invoice_db_rejected', { provider_invoice_id: inv.id, step: 'invoice_status_read', code });
    return 'db_rejected';
  }
  const { data, error } = await deps.admin('partner', 'record_place_invoice', args);
  if (error) {
    console.error('[places-invoice] record_place_invoice', inv.id, error.code ?? 'unknown');
    if (!isPermanentDbError(error.code)) return 'db_error';
    if (error.code === 'TGP22') await deps.alert('invoice_tgp22', { provider_invoice_id: inv.id, field: error.details ?? null });
    else await deps.alert('invoice_db_rejected', { provider_invoice_id: inv.id, step: 'record_place_invoice', code: error.code });
    return 'db_rejected';
  }
  const row = (Array.isArray(data) ? data[0] : data) as { outcome?: string } | null;
  const outcome = row?.outcome ?? 'unknown';
  if (MIRROR_ALERTS.has(outcome)) {
    await deps.alert(`invoice_${outcome}`, {
      provider_invoice_id: inv.id,
      provider_payment_id: args.p_provider_payment_id as string,
      subscription_id: (args.p_subscription_id as string | null) ?? null,
    });
    return outcome;
  }
  if (status === 'AUTHORIZED' && before !== 'AUTHORIZED' && (outcome === 'inserted' || outcome === 'updated')) {
    await sendInvoiceEmail(deps, inv);
  }
  return outcome;
}

async function sendInvoiceEmail(deps: InvoiceDeps, inv: AsaasInvoice): Promise<void> {
  const pdf = str(inv.pdfUrl);
  try {
    const email = inv.customer ? str((await deps.asaas.getCustomer(inv.customer)).email) : null;
    if (!pdf || !email) throw new Error(!pdf ? 'no_pdf' : 'no_email');
    if (!(await deps.sendEmail(email, INVOICE_EMAIL.subject, INVOICE_EMAIL.text(pdf, str(inv.number), typeof inv.value === 'number' ? toCents(inv.value) : null)))) throw new Error('send_failed');
  } catch (e) {
    await deps.alert('invoice_email_failed', { provider_invoice_id: inv.id, error: e instanceof Error ? e.message : 'unknown' });
  }
}

/** `INVOICE_*` webhook (https://docs.asaas.com/docs/webhook-para-notas-fiscais): re-read, then record. */
export async function handleInvoiceEvent(
  deps: InvoiceDeps,
  b: Record<string, unknown>,
  eventId: string,
  eventType: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const log = (outcome: string) => console.log('[places-payment-webhook]', eventId, eventType, outcome);
  const invoiceId = str((b.invoice as Record<string, unknown> | undefined)?.id);
  if (!invoiceId) return { status: 400, body: { error: 'invalid_body' } };
  let inv: AsaasInvoice;
  try {
    inv = await deps.asaas.getInvoice(invoiceId);
  } catch (e) {
    if (e instanceof AsaasError && e.status === 404) {
      await deps.alert('reread_not_found', { event_id: eventId, event_type: eventType, provider_invoice_id: invoiceId });
      log('reread_not_found');
      return { status: 200, body: { outcome: 'reread_not_found' } };
    }
    console.error('[places-payment-webhook]', eventId, eventType, 'reread_failed', e instanceof Error ? e.message : 'unknown');
    return { status: 500, body: { error: 'reread_failed' } };
  }
  const outcome = await recordInvoice(deps, inv);
  log(outcome);
  // A transient database failure → 500, so Asaas resends (the upsert makes the resend harmless). A
  // permanent one (`db_rejected`) → 200: it was alerted, and 500 would pause the queue (`isPermanentDbError`).
  return outcome === 'db_error' ? { status: 500, body: { error: 'db_error' } } : { status: 200, body: { outcome } };
}

/**
 * Sets `invoiceSettings` on a subscription that has none. Never throws: a failure alerts and the
 * daily sweep tries again. Returns what happened.
 */
export async function configureSubscriptionInvoices(
  deps: InvoiceDeps,
  providerSubscriptionId: string,
  subscriptionId: string,
  opts: { alertWhenUnconfigured: boolean } = { alertWhenUnconfigured: true },
): Promise<'configured' | 'already' | 'unconfigured' | 'failed'> {
  const c = deps.invoiceConfig;
  if (!c) {
    if (opts.alertWhenUnconfigured) await deps.alert('invoice_config_missing', { subscription_id: subscriptionId, provider_subscription_id: providerSubscriptionId });
    return 'unconfigured';
  }
  try {
    if (await deps.asaas.getSubscriptionInvoiceSettings(providerSubscriptionId)) return 'already';
    await deps.asaas.createSubscriptionInvoiceSettings(providerSubscriptionId, {
      municipalServiceCode: c.serviceCode,
      municipalServiceName: c.serviceName,
      effectiveDatePeriod: 'ON_PAYMENT_CONFIRMATION',
      observations: OBSERVATIONS,
      taxes: taxesOf(c),
    });
    return 'configured';
  } catch (e) {
    await deps.alert('invoice_settings_failed', {
      subscription_id: subscriptionId,
      provider_subscription_id: providerSubscriptionId,
      error: e instanceof Error ? e.message : 'unknown',
    });
    return 'failed';
  }
}

/**
 * The invoice of a confirmed one-off payment (no `subscription`), scheduled for today — the month of
 * the payment. Idempotent by the re-read: a payment with a live invoice is left alone. Throws a
 * transient `AsaasError` so the webhook answers 500 and Asaas resends (the charge is then a
 * `duplicate_event`, and this runs again).
 */
export async function ensureOneOffInvoice(deps: InvoiceDeps, p: AsaasPayment, subscriptionId: string | null): Promise<string> {
  const c = deps.invoiceConfig;
  if (!c) {
    await deps.alert('invoice_config_missing', { subscription_id: subscriptionId, provider_payment_id: p.id });
    return 'unconfigured';
  }
  if (!subscriptionId) return 'unknown_subscription';
  const existing = await deps.asaas.listInvoices({ payment: p.id });
  if (existing.some((i) => LIVE.has(invoiceStatus(i.status) as InvoiceStatus))) return 'already';
  try {
    const inv = await deps.asaas.scheduleInvoice({
      payment: p.id,
      serviceDescription: 'Tuggi Com história',
      observations: OBSERVATIONS,
      externalReference: subscriptionId,
      value: p.value,
      deductions: 0,
      effectiveDate: deps.today(),
      municipalServiceCode: c.serviceCode,
      municipalServiceName: c.serviceName,
      taxes: taxesOf(c),
    });
    await recordInvoice(deps, inv, subscriptionId);
    return 'scheduled';
  } catch (e) {
    if (e instanceof AsaasError && e.transient) throw e;
    await deps.alert('invoice_not_scheduled', { subscription_id: subscriptionId, provider_payment_id: p.id, error: e instanceof Error ? e.message : 'unknown' });
    return 'failed';
  }
}

/**
 * Refund (regret, withdrawal, refusal): cancel every invoice of the payment that is or may become a
 * valid document, and mirror the answer. `CANCELLATION_DENIED` (the city hall's deadline) is only
 * recorded: `partner.finance_pending_items` lists it for the accountant. Never throws.
 */
export async function cancelPaymentInvoices(deps: InvoiceDeps, providerPaymentId: string, subscriptionId: string | null): Promise<number> {
  let asked = 0;
  try {
    for (const inv of await deps.asaas.listInvoices({ payment: providerPaymentId })) {
      const status = invoiceStatus(inv.status);
      if (!status || !CANCELLABLE.has(status)) {
        if (status) await recordInvoice(deps, inv, subscriptionId);
        continue;
      }
      try {
        await recordInvoice(deps, await deps.asaas.cancelInvoice(inv.id), subscriptionId);
        asked++;
      } catch (e) {
        await deps.alert('invoice_cancel_failed', { provider_invoice_id: inv.id, provider_payment_id: providerPaymentId, error: e instanceof Error ? e.message : 'unknown' });
      }
    }
  } catch (e) {
    await deps.alert('invoice_cancel_failed', { provider_payment_id: providerPaymentId, error: e instanceof Error ? e.message : 'unknown' });
  }
  return asked;
}

/** First day of the previous month (São Paulo): the reconciliation window covers the month that just closed. */
export function reconcileFrom(today: string): string {
  const [y, m] = today.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Daily, inside `places-payment-sweep`: (1) backfill `invoiceSettings` on every live subscription
 * still without it — nothing, silently, while the secrets are missing (the alert was the
 * checkout's); (2) re-read the invoices of each customer since the start of last month and record them.
 */
export async function reconcileInvoices(deps: InvoiceDeps, targets: InvoiceTarget[]): Promise<Record<string, number | string>> {
  const out = { configured: 0, settings_failed: 0, recorded: 0, mirror_failed: 0 };
  const from = reconcileFrom(deps.today());
  for (const t of targets) {
    if (t.provider_subscription_id && deps.invoiceConfig) {
      const r = await configureSubscriptionInvoices(deps, t.provider_subscription_id, t.subscription_id, { alertWhenUnconfigured: false });
      if (r === 'configured') out.configured++;
      if (r === 'failed') out.settings_failed++;
    }
  }
  for (const customer of new Set(targets.map((t) => t.provider_customer_id).filter((c): c is string => !!c))) {
    const hint = targets.find((t) => t.provider_customer_id === customer)?.subscription_id ?? null;
    try {
      for (const inv of await deps.asaas.listInvoices({ customer, effectiveDateFrom: from })) {
        const o = await recordInvoice(deps, inv, hint);
        if (o === 'inserted' || o === 'updated') out.recorded++;
        if (o === 'db_error' || o === 'db_rejected') out.mirror_failed++;
      }
    } catch (e) {
      out.mirror_failed++;
      console.error('[places-invoice] reconcile list', e instanceof Error ? e.message : 'unknown');
    }
  }
  return out;
}
