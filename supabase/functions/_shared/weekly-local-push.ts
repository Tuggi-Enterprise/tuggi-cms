/**
 * The weekly push sender: BR-COMUNICACAO-019 item 3.m, BR-COMUNICACAO-012 item 1.7 (#1046, #1047).
 *
 * The database decides who gets which piece and writes the copy: `drive.claim_weekly_push` returns
 * each person, piece and local date once, with title and body already filled in the person's
 * language. This module only sends each row through the one push path, the `send` of
 * `_shared/push-send.ts` that `firebase-push-notification/send` answers with, and closes the row
 * with `drive.finish_weekly_push`. The cap of the weekly bucket (item 4.1) and the quiet hours
 * (item 5) are decided by `drive.push_allowed` behind that path, so there is no second gate here.
 *
 * The send is a function call, not HTTP (#1046): a run calling `/send` once per person spent the
 * Supabase budget of function-to-function calls per trace, and every person after it closed
 * `failed` with `RateLimitError` (https://supabase.com/docs/guides/functions/recursive-functions).
 *
 * Pure: no remote import and no `Deno` global. The client, `send` and the logger come in as
 * arguments, so `_tests/weekly-local-push.test.ts` drives it without network or database.
 *
 * The claim is paged (#1205): one call with every due person ran past the 8 s `statement_timeout`
 * (`57014`) and the whole Thursday batch of Europe and Brazil was lost on 2026-11-19. Each page
 * asks for `CLAIM_PAGE_SIZE` rows; a row the claim returns is already written to
 * `drive.weekly_push_sends`, so the next call with the same `p_now` brings the next people.
 *
 * The trip question (BR-COMUNICACAO-019 3.u.3, #1276) is a piece of its own: the claim returns it on
 * the first Sunday of the person's month, at 19h local, to whoever is in its audience, with kind
 * `weekly_first_sunday_local`, variant `trip_next_ask` and no title, body or link. The words and the
 * link are this sender's (`_shared/trip-question.ts`), because they depend on the reminder switches.
 * Its slot in item 4.1 is its own and the gate counts it (`drive.push_allowed`); Thursday and Saturday
 * are never replaced. After the gate says `sent`, `drive.mark_trip_question_sent` spends the month
 * (3.u.2); a piece the gate drops spends nothing, and a refusal in the quiet hours closes `denied`,
 * never deferred (3.u.3.b). Contract: `docs/contracts/viagem-marcada-e-lembrete.md`, Parte 4.
 *
 * Logs carry counts and the reason of a failure, never a user id, token, e-mail or position.
 */
import { type DriveRpc, parsePushKind, type PushKind, singleGateOutcome } from './push-gate.ts';
import { reminderReachable, TRIP_ASK_DEEPLINK, TRIP_QUESTION_PIECE, tripQuestionPush } from './trip-question.ts';

/** The kinds of the weekly push. The database knows them by `drive.weekly_push_pieces.push_kind`. */
export const WEEKLY_PUSH_KINDS = ['weekly_thursday_local', 'weekly_saturday_local', 'weekly_first_sunday_local'] as const;
export type WeeklyPushKind = (typeof WEEKLY_PUSH_KINDS)[number];

/** The kind that carries only the trip question (3.u.3), and the one variant it comes with. */
const TRIP_QUESTION_KIND: WeeklyPushKind = 'weekly_first_sunday_local';

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
  /** `trip_next_ask` on the trip question row (3.u.3); absent on every other piece. */
  piece?: typeof TRIP_QUESTION_PIECE;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** People sent to at the same time. Same width as the per-person loop of the sender. */
export const SEND_CONCURRENCY = 10;

/** Rows asked of each `claim_weekly_push` call (`p_limit`). A shorter page means nobody is left. */
export const CLAIM_PAGE_SIZE = 50;

/** Pages in one run at most, so a claim that never runs dry cannot hold the function forever. */
export const MAX_CLAIM_PAGES = 40;

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

/** Whether a raw claim row is the trip question, read before parsing to know if the switches are needed. */
export function isTripQuestionRow(raw: unknown): boolean {
  return (raw as { variant?: unknown } | null)?.variant === TRIP_QUESTION_PIECE;
}

/**
 * A raw claim row, or the reason it cannot be sent. Title and body of the Thursday and Saturday
 * pieces are taken as they are: that copy belongs to the database (`drive.weekly_push_texts`), and
 * this sender never rewrites it. The trip question row comes with no words and no link (3.u.3): they
 * are written here, in the row's language, promising the reminder only when `reminder` says it can
 * reach the person by push (BR-COMUNICACAO-023 item 5). Its kind and its variant go together: one
 * without the other is refused, because the question has no version without its words.
 */
export function parseClaimRow(raw: unknown, reminder = false): WeeklyPushRow | { invalid: string } {
  const row = (raw ?? {}) as Record<string, unknown>;
  const sendId = readSendId(row);
  if (sendId === null) return { invalid: 'send_id' };
  if (typeof row.user_id !== 'string' || !UUID_RE.test(row.user_id)) return { invalid: 'user_id' };
  const pushKind = parsePushKind(row.push_kind);
  if (!isWeeklyKind(pushKind)) return { invalid: 'push_kind' };
  const question = isTripQuestionRow(row);
  if (question !== (pushKind === TRIP_QUESTION_KIND)) return { invalid: 'variant' };
  if (question) {
    const { title, body } = tripQuestionPush(row.language, reminder);
    return {
      sendId,
      userId: row.user_id,
      pushKind,
      variant: TRIP_QUESTION_PIECE,
      title,
      body,
      deeplink: TRIP_ASK_DEEPLINK,
      piece: TRIP_QUESTION_PIECE,
    };
  }
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
 * The body of the one-person send, the same body `/send` takes. `data.type` is the push kind, so the inbox row, the cap and
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
      data: {
        type: row.pushKind,
        deeplink: row.deeplink,
        variant: row.variant,
        ...(row.piece ? { piece: row.piece } : {}),
      },
    },
    priority: 'high',
    ttl: 3600,
  };
}

/**
 * What the send answer (status and body of `/send`) means for the row. Success is proved by the gate tally of the answer,
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
  /** `createPushSender(...).send`, or a stand-in in the tests: the `/send` answer, in process. */
  send: (body: Record<string, unknown>) => Promise<{ status: number; body: unknown }>;
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
  /** BR-COMUNICACAO-019 3.u (#1276): the question of the first Sunday. */
  trip_question: TripQuestionTally;
}

export interface TripQuestionTally {
  /** Rows that left carrying the question, whatever the gate said. */
  asked: number;
  /** `mark_trip_question_sent` spent the month now. */
  marked: number;
  /** The gate said `sent` and the month was already spent (the e-mail took it first). */
  already_spent: number;
  /** The gate said `sent` and the mark failed: the month stays open. */
  mark_failed: number;
}

export class WeeklyClaimError extends Error {
  constructor(readonly code: string) {
    super(`claim_weekly_push failed: ${code}`);
  }
}

async function deliver(deps: WeeklyPushDeps, row: WeeklyPushRow): Promise<WeeklyPushOutcome> {
  try {
    const { status, body: answer } = await deps.send(weeklySendBody(row));
    const outcome = finishOutcomeFrom(status, answer);
    if (outcome === 'failed') {
      const gate = singleGateOutcome(answer);
      deps.log(`[weekly-local-push] send ${row.sendId} failed: status=${status} gate=${gate ?? 'none'}`);
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

/** Whether a reminder can reach a push person: read once per run, only when a question is due; `false` when unreadable. */
async function readPushReminder(deps: WeeklyPushDeps): Promise<boolean> {
  try {
    const { data, error } = await deps.drive.rpc('cms_get_trip_settings');
    if (!error) return reminderReachable(data, 'push');
    deps.log(`[weekly-local-push] trip settings unreadable: ${error.code ?? 'unknown'}; the question promises no reminder`);
  } catch (error) {
    deps.log(`[weekly-local-push] trip settings unreadable: ${(error as Error)?.name ?? 'Error'}; the question promises no reminder`);
  }
  return false;
}

/** 3.u.2: spends the month after the gate said `sent`. Never throws. */
async function markTripQuestion(deps: WeeklyPushDeps, row: WeeklyPushRow, tally: TripQuestionTally): Promise<void> {
  try {
    const { data, error } = await deps.drive.rpc('mark_trip_question_sent', { p_user_id: row.userId, p_channel: 'push' });
    if (error) {
      tally.mark_failed += 1;
      deps.log(`[weekly-local-push] trip question mark ${row.sendId} failed: ${error.code ?? 'unknown'}`);
    } else if (data === true) {
      tally.marked += 1;
    } else {
      tally.already_spent += 1;
      deps.log(`[weekly-local-push] trip question ${row.sendId}: the month was already spent`);
    }
  } catch (error) {
    tally.mark_failed += 1;
    deps.log(`[weekly-local-push] trip question mark ${row.sendId} failed: ${(error as Error)?.name ?? 'Error'}`);
  }
}

/**
 * One run: claim a page, send each row, close each row, and claim again until a page comes back
 * shorter than `CLAIM_PAGE_SIZE` or `MAX_CLAIM_PAGES` is reached. Throws `WeeklyClaimError` when the
 * first claim fails, so the caller answers 500. A later claim that fails stops the run and returns
 * what already left: those rows are sent and closed, and a 500 would say nothing went out.
 */
export async function runWeeklyLocalPush(deps: WeeklyPushDeps): Promise<WeeklyPushReport> {
  const args: Record<string, unknown> = { p_limit: CLAIM_PAGE_SIZE };
  if (deps.now) args.p_now = deps.now.toISOString();

  const report: WeeklyPushReport = {
    claimed: 0,
    outcomes: { sent: 0, denied: 0, not_delivered: 0, failed: 0 },
    invalid: 0,
    unfinished: 0,
    trip_question: { asked: 0, marked: 0, already_spent: 0, mark_failed: 0 },
  };
  const tally = report.trip_question;
  let pushReminder: Promise<boolean> | null = null;

  const handle = async (raw: unknown) => {
    const reminder = isTripQuestionRow(raw) && (await (pushReminder ??= readPushReminder(deps)));
    const row = parseClaimRow(raw, reminder);
    let sendId: number | null;
    let outcome: WeeklyPushOutcome;
    if ('invalid' in row) {
      report.invalid += 1;
      sendId = readSendId(raw);
      outcome = 'failed';
      deps.log(`[weekly-local-push] row ${sendId ?? '?'} not sent: invalid ${row.invalid}`);
    } else {
      sendId = row.sendId;
      const ask = row.piece === TRIP_QUESTION_PIECE;
      if (ask) tally.asked += 1;
      outcome = await deliver(deps, row);
      if (ask && outcome === 'sent') await markTripQuestion(deps, row, tally);
    }
    report.outcomes[outcome] += 1;
    if (sendId === null || !(await finish(deps, sendId, outcome))) report.unfinished += 1;
  };

  for (let page = 1; ; page += 1) {
    const { data, error } = await deps.drive.rpc('claim_weekly_push', args);
    if (error) {
      const code = error.code ?? 'unknown';
      if (page === 1) throw new WeeklyClaimError(code);
      deps.log(`[weekly-local-push] claim page ${page} failed: ${code}; returning what already left`);
      break;
    }

    const rows: unknown[] = Array.isArray(data) ? data : [];
    report.claimed += rows.length;
    for (let i = 0; i < rows.length; i += SEND_CONCURRENCY) {
      await Promise.all(rows.slice(i, i + SEND_CONCURRENCY).map(handle));
    }

    if (rows.length < CLAIM_PAGE_SIZE) break;
    if (page >= MAX_CLAIM_PAGES) {
      deps.log(`[weekly-local-push] stopped at the page cap (${MAX_CLAIM_PAGES}); the rest waits for the next run`);
      break;
    }
  }

  deps.log(`[weekly-local-push] ${JSON.stringify(report)}`);
  return report;
}

/** Date, time and zone, as `toISOString()` writes it or with an offset. A bare date has no hour. */
const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * The optional body of the handler (#1205): `{ "now": "<ISO 8601>" }` replays the batch of a past
 * hour. Empty or absent body, or no `now`: the run is for the current instant, as the cron sends it.
 * A `now` that is not a full ISO 8601 date-time is refused, never read as "now".
 */
export function parseRunBody(text: string): { now?: Date } | { error: 'invalid_now' } {
  if (text.trim() === '') return {};
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { error: 'invalid_now' };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_now' };
  const raw = (body as Record<string, unknown>).now;
  if (raw === undefined) return {};
  if (typeof raw !== 'string' || !ISO_DATE_TIME_RE.test(raw)) return { error: 'invalid_now' };
  const now = new Date(raw);
  return Number.isNaN(now.getTime()) ? { error: 'invalid_now' } : { now };
}
