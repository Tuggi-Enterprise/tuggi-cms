/**
 * The one gate of every push to a tourist: BR-COMUNICACAO-019 items 2, 4, 5 and 9 (#955).
 *
 * The decision itself is SQL and belongs to `data`: `drive.push_allowed` applies the consent
 * (`push_notifications_enabled` and `push_denied`), the cap, the quiet hours and the person's time
 * zone; `drive.user_active_within_days` says whether the person is using the app; the numbers live
 * only in `drive.unrequested_push_policy()` (db-tuggiApp `20261019200200`). This module is the
 * single place on the Edge side that asks those questions, sends only on a yes, and records the
 * send after the provider accepted it.
 *
 * Every push of both repositories reaches FCM through `firebase-push-notification`, which is why
 * the gate is called there and nowhere else: `daily-gamification-orchestrator` (this repo) and
 * `referral-activation-push` / `weekly-result-push` (tuggi-drive-v2, `_shared/user-push.ts`) only
 * declare the `push_kind`. A second gate in a caller would count the same push twice.
 *
 * Pure: no remote import and no `Deno` global, so `tests/api/push-gate.test.ts` executes it.
 */

/**
 * Every kind of push the gate knows. `p_kind` of the SQL must match `^[a-z0-9_]{1,64}$`.
 * The drive repo declares the two it sends in `_shared/user-push.ts`; a new kind is born here.
 */
export type PushKind =
  | 'ranking_streak_at_risk'
  | 'referral_hours_credited'
  | 'ranking_rank_at_risk'
  | 'ranking_rank_drop'
  | 'weekly_podium'
  | 'cms_broadcast'
  | 'cms_direct'
  | 'weekly_thursday_local'
  | 'weekly_saturday_local';

export interface PushKindPolicy {
  /**
   * BR-COMUNICACAO-019 item 3.a to 3.c: the person asked for it, so it is outside the cap and the
   * quiet hours (never outside consent). No sender of a requested push exists yet.
   */
  requested: boolean;
  /** Item 2, 3.e and 3.j: push only for someone who opened the app or had the guide on lately. */
  requiresActive: boolean;
  /**
   * Item 7: who wins when two pieces want the same slot, by perishability. 1 beats 2. Inside the
   * daily window the ranking part of this order is `RANKING_PIECES_BY_PERISHABILITY`; across
   * senders it applies to the deferred queue that `data` still has to create (#955).
   */
  vacancyPriority: number;
}

export const PUSH_KINDS: Readonly<Record<PushKind, PushKindPolicy>> = {
  ranking_streak_at_risk: { requested: false, requiresActive: true, vacancyPriority: 1 },
  referral_hours_credited: { requested: false, requiresActive: true, vacancyPriority: 2 },
  ranking_rank_at_risk: { requested: false, requiresActive: true, vacancyPriority: 3 },
  ranking_rank_drop: { requested: false, requiresActive: true, vacancyPriority: 3 },
  weekly_podium: { requested: false, requiresActive: true, vacancyPriority: 3 },
  // Item 3.l: the CMS push counts against the cap and comes last.
  cms_broadcast: { requested: false, requiresActive: false, vacancyPriority: 4 },
  cms_direct: { requested: false, requiresActive: false, vacancyPriority: 4 },
  // Item 3.m (#1046, #1047): the weekly pieces reach whoever has push on, using the app or not. They
  // have their own cap (item 4.1) and stay out of the item 7 dispute: `drive.push_allowed` counts
  // them apart, so their priority is never compared with the kinds above. Sender:
  // `weekly-local-push` (`_shared/weekly-local-push.ts`).
  weekly_thursday_local: { requested: false, requiresActive: false, vacancyPriority: 4 },
  weekly_saturday_local: { requested: false, requiresActive: false, vacancyPriority: 4 },
};

/** `null` for anything that is not a known kind: an unknown kind is refused, never defaulted. */
export function parsePushKind(value: unknown): PushKind | null {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PUSH_KINDS, value)
    ? (value as PushKind)
    : null;
}

/** The slice of a supabase-js client already pinned to `.schema('drive')` that the gate uses. */
export interface DriveRpc {
  rpc(
    fn: string,
    args?: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}

/**
 * `PGRST202`: PostgREST has no such function in its schema cache. `42883`: undefined function.
 * Both mean the migration is not applied yet (PostgREST error reference).
 */
export function isMissingFunction(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

/**
 * `active_window_days` of `drive.unrequested_push_policy()`, read once per run. `null` when it
 * cannot be read: then nobody passes the "using the app" test, because unknown is not active.
 */
export async function readActiveWindowDays(client: DriveRpc): Promise<number | null> {
  const { data, error } = await client.rpc('unrequested_push_policy');
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  const days = Number((row as { active_window_days?: unknown } | null)?.active_window_days);
  return Number.isInteger(days) && days >= 1 ? days : null;
}

/** BR-COMUNICACAO-019 item 2 for one person. `null` = not measured (any error), never "inactive". */
export async function readUserActive(client: DriveRpc, userId: string, days: number): Promise<boolean | null> {
  const { data, error } = await client.rpc('user_active_within_days', { p_user_id: userId, p_days: days });
  return error ? null : data === true;
}

export interface PushGateRequest {
  userId: string;
  kind: PushKind;
  requested: boolean;
  requiresActive: boolean;
}

export function pushGateRequest(userId: string, kind: PushKind): PushGateRequest {
  const { requested, requiresActive } = PUSH_KINDS[kind];
  return { userId, kind, requested, requiresActive };
}

/**
 * What happened to one push. Counted in the logs and in the response, never with the user id.
 *
 * - `sent`: the provider accepted it.
 * - `not_delivered`: the gate said yes and the provider took nothing (no device, every token refused).
 * - `denied`: `push_allowed` said no. Consent, cap or quiet hours: the SQL answers a boolean, so
 *   the reason is not known here (#955 asks `data` for it).
 * - `inactive`: a kind that needs "using the app" (item 2) and the person is not.
 * - `gate_missing`: the SQL functions do not exist yet. An unrequested push is NOT sent.
 * - `gate_error`: the gate could not answer. Nothing is sent: unknown is not a yes.
 * - `failed`: the delivery threw.
 */
export type PushGateOutcome =
  | 'sent'
  | 'not_delivered'
  | 'denied'
  | 'inactive'
  | 'gate_missing'
  | 'gate_error'
  | 'failed';

export const PUSH_GATE_OUTCOMES: readonly PushGateOutcome[] = [
  'sent',
  'not_delivered',
  'denied',
  'inactive',
  'gate_missing',
  'gate_error',
  'failed',
];

export interface PushGateResult {
  outcome: PushGateOutcome;
  /** `record_push_sent` succeeded. `false` on a sent push means the cap did not see it. */
  recorded: boolean;
}

/**
 * Asks, sends on a yes, records after the provider accepted. `deliver` resolves `true` when the
 * provider accepted the push for at least one device of this person.
 *
 * A requested push survives a missing gate (the migration ships before the functions, but the
 * order can slip): the person asked for it. An unrequested one does not.
 */
export async function sendThroughPushGate(
  client: DriveRpc,
  request: PushGateRequest,
  activeWindowDays: number | null,
  deliver: () => Promise<boolean>
): Promise<PushGateResult> {
  const args = { p_user_id: request.userId, p_kind: request.kind, p_requested: request.requested };

  if (request.requiresActive && !request.requested) {
    if (activeWindowDays === null) return { outcome: 'gate_error', recorded: false };
    const { data, error } = await client.rpc('user_active_within_days', {
      p_user_id: request.userId,
      p_days: activeWindowDays,
    });
    if (error) {
      return { outcome: isMissingFunction(error) ? 'gate_missing' : 'gate_error', recorded: false };
    }
    if (data !== true) return { outcome: 'inactive', recorded: false };
  }

  const { data: allowed, error: gateError } = await client.rpc('push_allowed', args);
  const gateMissing = isMissingFunction(gateError);
  if (gateError && !(gateMissing && request.requested)) {
    return { outcome: gateMissing ? 'gate_missing' : 'gate_error', recorded: false };
  }
  if (!gateError && allowed !== true) return { outcome: 'denied', recorded: false };

  let accepted: boolean;
  try {
    accepted = await deliver();
  } catch {
    return { outcome: 'failed', recorded: false };
  }
  if (!accepted) return { outcome: 'not_delivered', recorded: false };
  if (gateMissing) return { outcome: 'sent', recorded: false };

  const { error: recordError } = await client.rpc('record_push_sent', args);
  return { outcome: 'sent', recorded: !recordError };
}

/**
 * The outcome of a one-person `/send`, read from its `gate` tally. `null` when the answer carries
 * no tally (a `firebase-push-notification` deployed before #955) or names nobody.
 */
export function singleGateOutcome(body: unknown): PushGateOutcome | null {
  const gate = (body as { gate?: Record<string, unknown> } | null)?.gate;
  if (!gate || typeof gate !== 'object') return null;
  for (const outcome of PUSH_GATE_OUTCOMES) {
    if (Number(gate[outcome]) > 0) return outcome;
  }
  return null;
}

/** A zeroed tally, one key per outcome, for logs and responses. */
export function emptyGateTally(): Record<PushGateOutcome, number> {
  return Object.fromEntries(PUSH_GATE_OUTCOMES.map((o) => [o, 0])) as Record<PushGateOutcome, number>;
}
