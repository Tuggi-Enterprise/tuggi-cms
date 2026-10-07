// _shared/places-payout.ts — the 10 % payout of the Com história place (#903, BR-B2B-044 item 6,
// term 5.4). Contract: `docs/contracts/places-pagamento.md` §3.5 (workspace).
//
// Who calls what:
//   - `places-payout` (EF) ← the CMS route `POST /api/finance/payouts/{id}/release`, after the
//     admin gate (B1: the functions do not gate) and the "amount shown = amount on the server"
//     check → `releasePayout`; and ← `POST /api/finance/payouts/close` on the first calculation of
//     a month → `notifyClosedPeriod`.
//   - `places-payment-webhook` → `handleTransferEvent` (TRANSFER_DONE / FAILED / CANCELLED).
//   - `places-payment-sweep`   → `reconcileSentPayouts` (a `sent` whose webhook was lost) and
//     `triggerPayoutClose` (asks the CMS to close the month before; the calculation lives in the
//     CMS, `lib/finance/payouts.ts`, and is not duplicated here).
//
// THE ONE RULE THAT MOVES MONEY. Only `outcome = 'applied'` of `partner.release_place_payout`
// authorizes `POST /v3/transfers`. Asaas has no idempotency there and a Pix does not come back:
// the row lock + move to `released` is the only gate, and `unchanged` (double click, retry,
// concurrent call) returns before Asaas is touched. After the POST, `record_place_payout_transfer`;
// its TGP10 (or any failure) is a CRITICAL ALERT with the payout and transfer ids — never a second
// POST. A POST that fails leaves the payout `released` (the money may have left: timeout, 5xx) and
// the pending item `payout_stuck_released` tells the operator to search Asaas by `externalReference`
// = payout id. The one way back is `fail_place_payout_release`, and only for a 400 confirmed by a
// re-read (`rejectedRelease`): a `failed` payout can be released again, so calling it with the Pix
// sent pays the place twice.
//
// THE PARTNER NEVER SEES THE STATEMENT (B2, term clause 13). The e-mails carry the month's total and
// the number of purchases, nothing per purchase: no gross value, price or product.
//
// Pure: every side effect is injected (`PayoutDeps`), wired for Deno in `places-payout-runtime.ts`;
// the CMS tests load this file under Node (`tests/api/edge-places-payout.test.ts`).

import { AsaasError, TRANSFER_PAGE, type AsaasClient, type AsaasTransfer } from './asaas.ts';
import { ACCESS_FROM_NAME, portalMail } from './places-portal-draft.ts';
import { formatBrl, formatCnpjKey, type DbError, type Rpc } from './places-payment.ts';

export type Reply = { status: number; body: Record<string, unknown> };
const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body });

/** One payout, as the e-mails and the release need it. */
export type PayoutContext = {
  payoutId: string;
  status: string;
  amountCents: number;
  /** `YYYY-MM-01`: the month whose purchases the payout pays. */
  periodMonth: string;
  /** `partner.last_business_day` of the month after the period: the term 5.4 payment deadline. */
  payDeadline: string;
  placeName: string;
  /** `place_acceptances.email` of the contract (the responsible of the submission). */
  email: string | null;
  /** `place_acceptances.signer_name`: the e-mail greets the first name. */
  signerName: string | null;
  pixKey: string | null;
  /** Live `purchase` items of the payout. */
  purchases: number;
};

export type PayoutDeps = {
  /** `service_role`. */
  admin: Rpc;
  asaas: Pick<AsaasClient, 'createPixTransfer' | 'getTransfer' | 'listPixTransfersSince'>;
  /** `null` = no such payout. Throws on a read error. */
  payoutContext(payoutId: string): Promise<PayoutContext | null>;
  /** Every live (not cancelled) payout of the month. Throws on a read error. */
  periodPayouts(periodMonth: string): Promise<PayoutContext[]>;
  sendEmail(to: string, subject: string, html: string, text: string, fromName?: string): Promise<boolean>;
  /** Ids, amounts and codes only — never a name, a document or an e-mail. */
  alert(what: string, fields: Record<string, string | number | null | undefined>): Promise<void>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])-01$/;

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** `2026-09-01` → `setembro`. */
export const monthName = (period: string): string => MONTHS[Number(period.slice(5, 7)) - 1] ?? period;

/** The month after `YYYY-MM-01`, as `YYYY-MM-01`. */
export function nextMonth(period: string): string {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/** `2026-10-30` → `30 de outubro`. */
export const dayMonthLong = (date: string): string => `${Number(date.slice(8, 10))} de ${monthName(date)}`;

const firstName = (name: string | null): string => (name ?? '').trim().split(/\s+/)[0] ?? '';

const STRANGER = 'Se algo não bater, é só responder este e-mail.';

/**
 * The e-mail of a month with value (spec of the `design` §7, with the statement replaced by the
 * count, decision 5 of the Tech Lead): sent when the admin confirms the Pix. `{mês}` is the month of
 * the calculation; the purchases are of the month before it.
 */
export function payoutPaidEmail(p: PayoutContext): { subject: string; html: string; text: string } {
  const month = monthName(nextMonth(p.periodMonth));
  const previous = monthName(p.periodMonth);
  const value = formatBrl(p.amountCents);
  const hello = firstName(p.signerName);
  const count = p.purchases === 1 ? `1 compra no app em ${previous}.` : `${p.purchases} compras no app em ${previous}.`;
  return portalMail({
    subject: `Sua comissão de ${month}: ${value}`,
    preheader: `Pagamento por Pix até ${dayMonthLong(p.payDeadline)}.`,
    paragraphs: [
      hello ? `Olá, ${hello}.` : 'Olá.',
      `A comissão do ${p.placeName} sobre as compras que a Tuggi recebeu em ${previous} ficou em ${value}.`,
      `Vamos pagar por Pix na chave CNPJ ${formatCnpjKey(p.pixKey ?? '')} até ${dayMonthLong(p.payDeadline)}.`,
      count,
    ],
    small: [STRANGER],
  });
}

/** The e-mail of a month at zero or below, sent at the close (term 5.4: the value is informed every month). */
export function payoutZeroEmail(p: PayoutContext): { subject: string; html: string; text: string } {
  const month = monthName(nextMonth(p.periodMonth));
  const previous = monthName(p.periodMonth);
  const hello = firstName(p.signerName);
  const lead = `A comissão do ${p.placeName} sobre as compras que a Tuggi recebeu em ${previous} ficou em R$ 0,00.`;
  const why =
    p.amountCents < 0
      ? `Um estorno de compra já paga deixou saldo de −${formatBrl(-p.amountCents)}, que será descontado da próxima comissão.`
      : 'Não houve compra atribuída ao local nesse mês.';
  return portalMail({
    subject: `Sua comissão de ${month}: R$ 0,00`,
    preheader: lead,
    paragraphs: [hello ? `Olá, ${hello}.` : 'Olá.', `${lead} ${why}`],
    small: [STRANGER],
  });
}

/**
 * The EF serves the CMS's Next server only (its machine key → `requireAdmin` sets `service_role`).
 * A CMS admin's JWT also passes `requireAdmin`, and from the browser it would skip the CMS route's
 * "amount shown" check and FINANCE module and pick `released_by` itself: 403.
 */
export function machineOnly(auth: { role?: string }): Reply | null {
  return auth.role === 'service_role' ? null : reply(403, { error: 'forbidden' });
}

const errOf = (e: DbError) => ({ code: e.code ?? null, detail: typeof e.details === 'string' ? e.details.slice(0, 64) : null });

export type ReleaseInput = { payoutId: string; releasedBy: string };

export function parseRelease(body: unknown): ReleaseInput | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const payoutId = typeof b.payout_id === 'string' ? b.payout_id.toLowerCase() : '';
  const releasedBy = typeof b.released_by === 'string' ? b.released_by.toLowerCase() : '';
  return UUID.test(payoutId) && UUID.test(releasedBy) ? { payoutId, releasedBy } : null;
}

export function parsePeriod(body: unknown): string | null {
  const p = ((body ?? {}) as Record<string, unknown>).period_month;
  return typeof p === 'string' && PERIOD.test(p) ? p : null;
}

/**
 * Release one payout: `release_place_payout` → (only on `applied`) `POST /v3/transfers` →
 * `record_place_payout_transfer` → the e-mail (only on the first release, from `calculated`: a
 * `failed` payout released again already had its e-mail).
 *
 * 200 `{result: 'sent', transfer_id}` · 200 `{result: 'unchanged', status}` (no Asaas call) ·
 * 404 `not_found` · 409 `{error: 'not_releasable', reason}` (TGP10: `not_positive`, `no_pix_key`
 * or the status) · 502 `{error: 'transfer_failed', codes}` (the payout stays `released`, or goes
 * `failed` on a 400 confirmed absent at Asaas: `rejectedRelease`) ·
 * 500 `failed` (database).
 */
export async function releasePayout(deps: PayoutDeps, input: ReleaseInput): Promise<Reply> {
  const before = await deps.payoutContext(input.payoutId);
  if (!before) return reply(404, { error: 'not_found' });

  const released = await deps.admin('partner', 'release_place_payout', { p_payout_id: input.payoutId, p_released_by: input.releasedBy });
  if (released.error) {
    const e = errOf(released.error);
    if (e.code === 'TGP01') return reply(404, { error: 'not_found' });
    if (e.code === 'TGP10') return reply(409, { error: 'not_releasable', reason: e.detail });
    await deps.alert('payout_release_failed', { payout_id: input.payoutId, code: e.code });
    return reply(500, { error: 'failed' });
  }
  const row = (Array.isArray(released.data) ? released.data[0] : released.data) as
    | { outcome?: string; status?: string; amount_cents?: number; pix_key?: string | null }
    | undefined;
  if (row?.outcome !== 'applied') {
    // `unchanged`: someone else won the release. Asaas is not touched.
    return reply(200, { result: 'unchanged', status: row?.status ?? null });
  }
  if (!row.pix_key || !(Number(row.amount_cents) > 0)) {
    // The database promises both on `applied`; without them nothing is sent, and the payout is stuck.
    await deps.alert('CRITICAL payout_release_incomplete', { payout_id: input.payoutId });
    return reply(500, { error: 'failed' });
  }

  const amountCents = Number(row.amount_cents);
  let transfer: AsaasTransfer;
  try {
    transfer = await deps.asaas.createPixTransfer({
      valueCents: amountCents,
      pixKey: row.pix_key,
      description: `Comissão Tuggi ${before.periodMonth.slice(5, 7)}/${before.periodMonth.slice(0, 4)}`,
      externalReference: input.payoutId,
    });
  } catch (e) {
    const status = e instanceof AsaasError ? e.status : 0;
    const codes = e instanceof AsaasError ? e.codes.join(',') : '';
    // Never a second POST. Only a 400 may move the payout to `failed` (`rejectedRelease`); 0 (network,
    // timeout), 401, 403, 408, 429 and 5xx leave it `released` for the pending `payout_stuck_released`.
    const failed = status === 400 && (await rejectedRelease(deps, input.payoutId, codes));
    await deps.alert('payout_transfer_failed', {
      payout_id: input.payoutId,
      amount_cents: amountCents,
      http_status: status,
      codes,
      payout_status: failed ? 'failed' : 'released',
      search: failed ? null : 'externalReference = payout_id',
    });
    return reply(502, { error: 'transfer_failed', codes: codes || null });
  }

  const recorded = await deps.admin('partner', 'record_place_payout_transfer', { p_payout_id: input.payoutId, p_provider_transfer_id: transfer.id });
  if (recorded.error) {
    // The money left and the payout did not follow. Critical; never another POST.
    await deps.alert('CRITICAL payout_transfer_not_recorded', {
      payout_id: input.payoutId,
      transfer_id: transfer.id,
      amount_cents: amountCents,
      code: recorded.error.code ?? null,
      detail: errOf(recorded.error).detail,
    });
  }

  if (before.status === 'calculated') {
    const mail = payoutPaidEmail({ ...before, amountCents, pixKey: row.pix_key });
    const sent = before.email ? await deps.sendEmail(before.email, mail.subject, mail.html, mail.text, ACCESS_FROM_NAME) : false;
    if (!sent) await deps.alert('payout_email_failed', { payout_id: input.payoutId, kind: 'paid' });
  }
  return reply(200, { result: 'sent', transfer_id: transfer.id, recorded: !recorded.error });
}

/** Pages of `GET /v3/transfers` read before giving up (10 per page): far above a day of payouts. */
const TRANSFER_SEARCH_PAGES = 20;

/**
 * Did Asaas create a PIX transfer with `externalReference` = the payout, since yesterday (UTC; the
 * day of the POST in Brasília is covered)? `null` = could not tell (read error, or the pages ran out).
 */
async function transferExists(asaas: Pick<AsaasClient, 'listPixTransfersSince'>, payoutId: string): Promise<boolean | null> {
  const since = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  try {
    for (let page = 0; page < TRANSFER_SEARCH_PAGES; page++) {
      const list = await asaas.listPixTransfersSince(since, page * TRANSFER_PAGE);
      if ((list.data ?? []).some((t) => t.externalReference === payoutId)) return true;
      if (!list.hasMore) return false;
    }
  } catch {
    // Unknown is not "absent".
  }
  return null;
}

/**
 * A 400 to `POST /v3/transfers` → `fail_place_payout_release` (contract §3.5), so the screen shows
 * "Falhou: …" and the button "Reenviar repasse". The Asaas doc (conferred 2026-10-07:
 * docs/transferencia-para-contas-de-outra-instituicao-pix-ted, reference/codigos-http-das-respostas)
 * says 400 is "dado obrigatório ausente, inválido ou não atende às regras da operação" and does NOT
 * say the transfer was not created. So the second path: before failing, re-read the PIX transfers
 * of the day and fail only when none carries this `externalReference` (the list has no such filter;
 * it is matched in the page). Anything but a clean "absent" leaves the payout `released`.
 */
async function rejectedRelease(deps: PayoutDeps, payoutId: string, codes: string): Promise<boolean> {
  const exists = await transferExists(deps.asaas, payoutId);
  if (exists !== false) {
    if (exists) await deps.alert('CRITICAL payout_rejected_but_transfer_found', { payout_id: payoutId, codes });
    return false;
  }
  const r = await deps.admin('partner', 'fail_place_payout_release', {
    p_payout_id: payoutId,
    p_reason: `asaas_rejected: ${codes || 'http_400'}`,
  });
  if (r.error) {
    await deps.alert('payout_fail_release_failed', { payout_id: payoutId, code: r.error.code ?? null });
    return false;
  }
  return true;
}

/**
 * The close's e-mails for the months at zero or below (decision 6): one per live payout of the
 * month with `amount_cents <= 0`. Once-guard: the CMS calls this only on the FIRST calculation of
 * the month (`place_payout_periods.calculated_at` was empty), so a recalculation sends nothing.
 */
export async function notifyClosedPeriod(deps: PayoutDeps, periodMonth: string): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const p of await deps.periodPayouts(periodMonth)) {
    if (p.status !== 'calculated' || p.amountCents > 0) continue;
    const mail = payoutZeroEmail(p);
    if (p.email && (await deps.sendEmail(p.email, mail.subject, mail.html, mail.text, ACCESS_FROM_NAME))) {
      sent++;
    } else {
      failed++;
      await deps.alert('payout_email_failed', { payout_id: p.payoutId, kind: 'zero' });
    }
  }
  return { sent, failed };
}

const SETTLED = new Set(['DONE', 'FAILED', 'CANCELLED']);

/** `partner.settle_place_payout_transfer` with a RE-READ transfer. Throws on a database error (the webhook answers 500). */
async function settle(deps: Pick<PayoutDeps, 'admin' | 'alert'>, t: AsaasTransfer): Promise<string> {
  const r = await deps.admin('partner', 'settle_place_payout_transfer', {
    p_provider_transfer_id: t.id,
    p_transfer_status: t.status,
    p_fail_reason: t.failReason ?? null,
  });
  if (r.error) throw new Error(`settle_place_payout_transfer ${r.error.code ?? 'unknown'}`);
  const row = (Array.isArray(r.data) ? r.data[0] : r.data) as { outcome?: string; payout_id?: string | null } | undefined;
  const outcome = row?.outcome ?? 'unknown';
  if (outcome === 'applied' && t.status !== 'DONE') {
    await deps.alert('payout_failed', { payout_id: row?.payout_id ?? null, transfer_id: t.id, status: t.status });
  }
  return outcome;
}

/**
 * `TRANSFER_*` of the Asaas webhook (doc conferred 2026-10-07:
 * https://docs.asaas.com/docs/webhook-para-transferencias). Nothing in the body is trusted: the
 * transfer is RE-READ (`GET /v3/transfers/{id}`) and only a re-read DONE / FAILED / CANCELLED
 * reaches the database. Idempotent by state: a resend is `duplicate_event`. A transfer that is not
 * a payout (a manual withdrawal) is `unknown_transfer`, 200 and logged.
 */
export async function handleTransferEvent(
  deps: Pick<PayoutDeps, 'admin' | 'alert'> & { asaas: Pick<AsaasClient, 'getTransfer'> },
  body: Record<string, unknown>,
  eventId: string,
  eventType: string,
): Promise<Reply> {
  const log = (outcome: string) => console.log('[places-payment-webhook]', eventId, eventType, outcome);
  const id = typeof (body.transfer as Record<string, unknown>)?.id === 'string' ? ((body.transfer as Record<string, unknown>).id as string) : '';
  if (!id) {
    log('ignored');
    return reply(200, { outcome: 'ignored' });
  }
  let t: AsaasTransfer;
  try {
    t = await deps.asaas.getTransfer(id);
  } catch (e) {
    if (e instanceof AsaasError && e.status === 404) {
      await deps.alert('transfer_not_found', { event_id: eventId, transfer_id: id });
      log('not_found');
      return reply(200, { outcome: 'not_found' });
    }
    throw e; // transport: 500, Asaas resends
  }
  if (!SETTLED.has(t.status)) {
    log(`pending:${t.status}`);
    return reply(200, { outcome: 'pending' });
  }
  const outcome = await settle(deps, t);
  log(outcome);
  return reply(200, { outcome });
}

/** A `sent` payout, for the daily reconciliation. */
export type SentPayout = { payout_id: string; provider_transfer_id: string };

/**
 * The sweep re-reads every `sent` payout's transfer and settles the terminal ones, the same way the
 * webhook does: a lost or disabled webhook does not leave a payout `sent` forever.
 */
export async function reconcileSentPayouts(
  deps: Pick<PayoutDeps, 'admin' | 'alert'> & { asaas: Pick<AsaasClient, 'getTransfer'> },
  rows: SentPayout[],
): Promise<{ settled: number; pending: number; failed: number }> {
  let settled = 0;
  let pending = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      const t = await deps.asaas.getTransfer(r.provider_transfer_id);
      if (!SETTLED.has(t.status)) {
        pending++;
        continue;
      }
      if ((await settle(deps, t)) === 'applied') settled++;
    } catch (e) {
      failed++;
      await deps.alert('sweep_payout_reconcile_failed', { payout_id: r.payout_id, error: e instanceof Error ? e.message.slice(0, 120) : 'unknown' });
    }
  }
  return { settled, pending, failed };
}

export const PAYOUT_CLOSE_PATH = '/api/finance/payouts/close';
export const CMS_JOB_SECRET_HEADER = 'x-cms-job-secret';

/**
 * Asks the CMS to close the month before (decision 7). Daily: the route closes only a month never
 * calculated, so the days after the 1st only repair a failed run. `skipped` when the two secrets
 * are not set — the pending item `payout_period_not_calculated` (after day 5) is the safety net.
 */
export async function triggerPayoutClose(
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
  origin: string,
  secret: string,
): Promise<string> {
  if (!origin || !secret) return 'skipped';
  try {
    const res = await fetchImpl(`${origin.replace(/\/+$/, '')}${PAYOUT_CLOSE_PATH}`, {
      method: 'POST',
      headers: { [CMS_JOB_SECRET_HEADER]: secret, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(60_000),
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return res.ok ? String(body?.result ?? 'ok') : `http_${res.status}`;
  } catch {
    return 'unreachable';
  }
}
