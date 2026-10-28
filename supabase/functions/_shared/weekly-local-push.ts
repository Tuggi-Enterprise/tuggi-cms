/**
 * The weekly push sender: BR-COMUNICACAO-019 item 3.m, BR-COMUNICACAO-012 item 1.7 (#1046, #1047).
 *
 * The database decides who gets which piece and writes the copy: `drive.claim_weekly_push` returns
 * each person, piece and local date once, with title and body already filled in the person's
 * language. This module only sends each row through the one push path,
 * `firebase-push-notification/send`, and closes the row with `drive.finish_weekly_push`. The cap of
 * the weekly bucket (item 4.1) and the quiet hours (item 5) are decided by `drive.push_allowed`
 * behind that path, so there is no second gate here.
 *
 * Pure: no remote import and no `Deno` global. The client, `fetch` and the logger come in as
 * arguments, so `_tests/weekly-local-push.test.ts` drives it without network or database.
 *
 * Logs carry counts and the reason of a failure, never a user id, token, e-mail or position.
 */
import { type DriveRpc, parsePushKind, type PushKind, singleGateOutcome } from './push-gate.ts';

/** The two kinds of the weekly bucket. The database knows them by `drive.weekly_push_pieces.push_kind`. */
export const WEEKLY_PUSH_KINDS = ['weekly_thursday_local', 'weekly_saturday_local'] as const;
export type WeeklyPushKind = (typeof WEEKLY_PUSH_KINDS)[number];

/** `drive.finish_weekly_push` accepts these and nothing else. */
export type WeeklyPushOutcome = 'sent' | 'denied' | 'not_delivered' | 'failed';

/** One row of `drive.claim_weekly_push`, after validation. */
export interface WeeklyPushRow {
  sendId: number;
  userId: string;
  pushKind: WeeklyPushKind;
  variant: string;
  title: string;
  body: string;
  deeplink: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** People sent to at the same time. Same width as the per-person loop of `/send`. */
export const SEND_CONCURRENCY = 10;

function isWeeklyKind(kind: PushKind | null): kind is WeeklyPushKind {
  return kind !== null && (WEEKLY_PUSH_KINDS as readonly string[]).includes(kind);
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** The `send_id` of a raw row, or `null`: without it the row cannot even be closed. */
export function readSendId(raw: unknown): number | null {
  const id = Number((raw as { send_id?: unknown } | null)?.send_id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * A raw claim row, or the reason it cannot be sent. Title and body are taken as they are: the copy
 * belongs to the database (`drive.weekly_push_texts`), and this sender never rewrites it.
 */
export function parseClaimRow(raw: unknown): WeeklyPushRow | { invalid: string } {
  const row = (raw ?? {}) as Record<string, unknown>;
  const sendId = readSendId(row);
  if (sendId === null) return { invalid: 'send_id' };
  if (typeof row.user_id !== 'string' || !UUID_RE.test(row.user_id)) return { invalid: 'user_id' };
  const pushKind = parsePushKind(row.push_kind);
  if (!isWeeklyKind(pushKind)) return { invalid: 'push_kind' };
  if (!nonBlank(row.title) || !nonBlank(row.body)) return { invalid: 'copy' };
  if (!nonBlank(row.deeplink) || !row.deeplink.startsWith('tuggi://')) return { invalid: 'deeplink' };
  return {
    sendId,
    userId: row.user_id,
    pushKind,
    variant: nonBlank(row.variant) ? row.variant : 'unknown',
    title: row.title,
    body: row.body,
    deeplink: row.deeplink,
  };
}

/**
 * The body of the one-person `/send`. `data.type` is the push kind, so the inbox row, the cap and
 * the GA4 open all name the piece (BR-COMUNICACAO-016); `data.variant` separates event, route and
 * reminder for the measurement of 3.m.9.
 */
export function weeklySendBody(row: WeeklyPushRow): Record<string, unknown> {
  return {
    type: 'user',
    userIds: [row.userId],
    push_kind: row.pushKind,
    notification: {
      title: row.title,
      body: row.body,
      data: { type: row.pushKind, deeplink: row.deeplink, variant: row.variant },
    },
    priority: 'high',
    ttl: 3600,
  };
}

/**
 * What the `/send` answer means for the row. Success is proved by the gate tally of the answer,
 * never by the status alone: a 2xx without a tally proves nothing and closes as `failed`.
 *
 * `inactive` cannot happen (the weekly kinds do not require "using the app") and would be the gate
 * saying no, so it reads `denied`. `gate_missing` and `gate_error` are the gate failing to answer:
 * nothing left, and the row is a failure of ours, not a refusal.
 */
export function finishOutcomeFrom(status: number, answer: unknown): WeeklyPushOutcome {
  if (status < 200 || status >= 300) return 'failed';
  switch (singleGateOutcome(answer)) {
    case 'sent':
      return 'sent';
    case 'denied':
    case 'inactive':
      return 'denied';
    case 'not_delivered':
      return 'not_delivered';
    default:
      return 'failed';
  }
}

export interface WeeklyPushDeps {
  /** A client already pinned to the `drive` schema, with the machine key. */
  drive: DriveRpc;
  /** `fetch`, or a stand-in in the tests. */
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** `${SUPABASE_URL}/functions/v1/firebase-push-notification/send`. */
  sendUrl: string;
  /** The machine key `/send` admits (`requireAdmin`, machine bypass). */
  machineKey: string;
  log: (line: string) => void;
  /** `now()` when absent; the tests pin the instant. */
  now?: Date;
}

export interface WeeklyPushReport {
  claimed: number;
  outcomes: Record<WeeklyPushOutcome, number>;
  /** Rows that could not be read; each is closed as `failed` when it carries a `send_id`. */
  invalid: number;
  /** `finish_weekly_push` errored or had no row: the row stays claimed, which blocks the item. */
  unfinished: number;
}

export class WeeklyClaimError extends Error {
  constructor(readonly code: string) {
    super(`claim_weekly_push failed: ${code}`);
  }
}

async function deliver(deps: WeeklyPushDeps, row: WeeklyPushRow): Promise<WeeklyPushOutcome> {
  try {
    const res = await deps.fetch(deps.sendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deps.machineKey}`,
        apikey: deps.machineKey,
      },
      body: JSON.stringify(weeklySendBody(row)),
    });
    const answer = await res.json().catch(() => null);
    const outcome = finishOutcomeFrom(res.status, answer);
    if (outcome === 'failed') {
      const gate = singleGateOutcome(answer);
      deps.log(`[weekly-local-push] send ${row.sendId} failed: status=${res.status} gate=${gate ?? 'none'}`);
    }
    return outcome;
  } catch (error) {
    deps.log(`[weekly-local-push] send ${row.sendId} failed: ${(error as Error)?.name ?? 'Error'}`);
    return 'failed';
  }
}

async function finish(deps: WeeklyPushDeps, sendId: number, outcome: WeeklyPushOutcome): Promise<boolean> {
  const { data, error } = await deps.drive.rpc('finish_weekly_push', { p_send_id: sendId, p_outcome: outcome });
  if (error) {
    deps.log(`[weekly-local-push] finish ${sendId} (${outcome}) failed: ${error.code ?? 'unknown'}`);
    return false;
  }
  if (data !== true) {
    deps.log(`[weekly-local-push] finish ${sendId} (${outcome}): row was already closed`);
    return false;
  }
  return true;
}

/**
 * One run: claim, send each row, close each row. Throws `WeeklyClaimError` when the claim itself
 * fails, so the caller answers 500; everything after the claim is counted, never thrown.
 */
export async function runWeeklyLocalPush(deps: WeeklyPushDeps): Promise<WeeklyPushReport> {
  const args = deps.now ? { p_now: deps.now.toISOString() } : {};
  const { data, error } = await deps.drive.rpc('claim_weekly_push', args);
  if (error) throw new WeeklyClaimError(error.code ?? 'unknown');

  const rows: unknown[] = Array.isArray(data) ? data : [];
  const report: WeeklyPushReport = {
    claimed: rows.length,
    outcomes: { sent: 0, denied: 0, not_delivered: 0, failed: 0 },
    invalid: 0,
    unfinished: 0,
  };

  const handle = async (raw: unknown) => {
    const row = parseClaimRow(raw);
    let sendId: number | null;
    let outcome: WeeklyPushOutcome;
    if ('invalid' in row) {
      report.invalid += 1;
      sendId = readSendId(raw);
      outcome = 'failed';
      deps.log(`[weekly-local-push] row ${sendId ?? '?'} not sent: invalid ${row.invalid}`);
    } else {
      sendId = row.sendId;
      outcome = await deliver(deps, row);
    }
    report.outcomes[outcome] += 1;
    if (sendId === null || !(await finish(deps, sendId, outcome))) report.unfinished += 1;
  };

  for (let i = 0; i < rows.length; i += SEND_CONCURRENCY) {
    await Promise.all(rows.slice(i, i + SEND_CONCURRENCY).map(handle));
  }

  deps.log(`[weekly-local-push] ${JSON.stringify(report)}`);
  return report;
}
