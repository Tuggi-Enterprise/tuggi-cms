/**
 * The ranking communication mechanism — who gets which piece, on which channel, today.
 *
 * Card #747 (epic #737). This module decides; it does NOT send, does NOT read the database and
 * does NOT hold a single user-facing sentence. Everything here is pure, and that is deliberate:
 * every Edge Function that talks to the database imports
 * `https://esm.sh/@supabase/supabase-js@2`, which Node cannot resolve, so a rule that lives
 * inside one of them can only ever be checked by a regexp over its text. Here the rules are
 * executed against real inputs by `tests/api/ranking-communication.test.ts`.
 *
 * ---------------------------------------------------------------------------------------------
 * THE RULES THIS FILE IMPLEMENTS, AND THE FOUR THINGS THEY FORBID
 * ---------------------------------------------------------------------------------------------
 *
 * - **BR-COMUNICACAO-012 item 1.4** — ranking and streak is the FOURTH push purpose, closed on
 *   four objects. Item 1.4.a: it reaches only whoever gave BOTH consents — entering the
 *   scoreboard and the push opt-in — and neither implies the other.
 * - **BR-COMUNICACAO-012 item 1.4.e** — there is NO schedule of our own. The pieces leave in the
 *   daily window of the sender that already runs (`daily-gamification-orchestrator`), ONE
 *   evaluation per recipient per day. Two consequences are written into this file's shape:
 *     1. **No piece may promise a countdown in hours.** `RankingDecision` carries no duration,
 *        no deadline and no clock, so a template physically cannot interpolate one. A daily
 *        window cannot sustain "3 hours left", and the streak day boundary is midnight UTC
 *        (BR-RANKING-008 item 3).
 *     2. When the three pieces compete for the same slot the order is **perishability, not
 *        strength**: streak at risk → balance running out with the position in dispute →
 *        rank drop. That order is `RANKING_PIECES_BY_PERISHABILITY` and nothing else.
 * - **BR-COMUNICACAO-014 item 2.2 / item 4** — a ranking piece is a SERVICE push. It counts
 *   against the per-recipient cap and it BEATS `daily_fomo`, which always yields. The cap itself
 *   is not implemented here on purpose: item 7 of that rule says there is ONE gate, in the SQL
 *   audience resolvers, and it belongs to `data`. A second gate in TypeScript is the defect that
 *   item exists to prevent.
 * - **BR-COMUNICACAO-017 items 2 and 3** — e-mail is the channel of whoever push does NOT reach,
 *   never a second copy; and it needs a THIRD, independent consent (BR-RANKING-007 item 4).
 * - **BR-MONETIZACAO-081 item 6.2** — "position in dispute" has ONE owner, and `isPositionInDispute`
 *   below is this repository's single implementation of it (CLAUDE.md §6). The funnel origin
 *   `rank_at_risk` in the app (#748) is the same predicate on the other surface; item 6.6 says
 *   the two may not disagree.
 * - **BR-RANKING-002** — never the number of participants, and never anything it can be deduced
 *   from. This file's defence is structural, not editorial: `RankingDecision` carries the
 *   recipient's OWN rank and points and nothing about anybody else, so no template has a
 *   denominator to render even by accident.
 * - **BR-RANKING-008** — the streak is a run of calendar days in UTC with at least one story
 *   delivered, and the ×1.5 belongs to the cycle week.
 */

/** The three pieces, as identifiers. The user-facing sentences are elsewhere and are not ours. */
export type RankingPiece = 'streak_at_risk' | 'rank_at_risk' | 'rank_drop';

/**
 * The dispute order of BR-COMUNICACAO-012 item 1.4.e, and the reason for each position:
 * the streak dies at midnight UTC and has no tomorrow; the dispute over a position dies at the
 * end of the cycle; the drop is still true tomorrow.
 *
 * Reordering this array changes product behaviour and needs the rule amended first.
 */
export const RANKING_PIECES_BY_PERISHABILITY: readonly RankingPiece[] = [
  'streak_at_risk',
  'rank_at_risk',
  'rank_drop',
];

/** The `data.type` each piece carries on the push — snake_case, like `partner_approved`. */
export const RANKING_PUSH_TYPE: Record<RankingPiece, string> = {
  streak_at_risk: 'ranking_streak_at_risk',
  rank_at_risk: 'ranking_rank_at_risk',
  rank_drop: 'ranking_rank_drop',
};

/** Every `data.type` this mechanism emits, for reading back what we last told somebody. */
export const RANKING_PUSH_TYPES: readonly string[] = Object.values(RANKING_PUSH_TYPE);

/** The days of one weekly cycle — BR-RANKING-005 item 1. Not a tunable. */
export const CYCLE_DAYS = 7;

/**
 * The distance in points that makes a neighbour a rival — BR-MONETIZACAO-081 item 6.2.b.
 *
 * It is NOT a number of this file's own: item 6.3 says it is the podium floor of BR-RANKING-003
 * item 1, cited and not duplicated. Whoever loosens the dispute window moves it THERE.
 */
export const DISPUTE_POINT_DISTANCE = 10;

/** One row of `core.ranking_scoreboard` with `period_kind = 'week'`, narrowed to what we use. */
export interface ScoreboardWeekRow {
  user_id: string;
  /** Column 19. In `week` every row is ranked, including the 0-point ones, tied at the end. */
  rank_official: number | null;
  /** Column 18. */
  points_official: number;
  /** Column 13 — distinct UTC calendar days with at least one story delivered in the cycle. */
  story_days: number;
  /** Column 28 — the anchored pool of the week, BR-RANKING-001. "Is in the dispute". */
  in_roster: boolean;
}

/** The three independent consents plus the reachability of each channel. */
export interface RecipientConsent {
  user_id: string;
  /** `NULL` = never answered, `false` = REFUSED. Neither is a recipient. */
  ranking_opt_in: boolean | null;
  /** Third consent, BR-COMUNICACAO-017 item 3. Independent of the other two. */
  email_opt_in: boolean | null;
  /** The push boolean is still `push_notifications_enabled` (2026-09-10). */
  push_notifications_enabled: boolean | null;
  /** A live token exists for this account — the thing an uninstall kills. */
  has_live_push_token: boolean;
}

export interface RankingDispatchInput {
  /** The evaluation instant. One evaluation per recipient per day, in the daily window. */
  now: Date;
  /** `period_start` of the current weekly cycle, from the scoreboard row itself — never computed here. */
  cycleStart: Date;
  /** Every `week` row of the current cycle. The full cycle, so neighbours can be found. */
  weekRows: readonly ScoreboardWeekRow[];
  /** Only the accounts the daily window is evaluating today. */
  evaluatedUserIds: readonly string[];
  consentByUserId: ReadonlyMap<string, RecipientConsent>;
  /**
   * The rank we last TOLD this account, read back from the last ranking notification we sent it.
   * Absent = we never told them anything, and then there is no drop to announce: a drop is
   * measured against what the recipient was told, never against a snapshot they never saw.
   */
  lastCommunicatedRankByUserId: ReadonlyMap<string, number>;
  /**
   * Accounts whose metered balance has reached zero — BR-MONETIZACAO-081 item 6.2.c.
   * `null` means WE COULD NOT MEASURE IT (the ledger gate refused, the RPC is missing). Unknown
   * is not zero: with `null` the `rank_at_risk` piece is not emitted for anybody. Failing closed
   * here costs one piece; failing open tells somebody their balance ended when it did not.
   */
  zeroBalanceUserIds: ReadonlySet<string> | null;
}

export type RankingChannel = 'push' | 'email';

/**
 * What the sender needs, and deliberately nothing more.
 *
 * There is no nickname, no e-mail address, no country, no total, no neighbour and no deadline.
 * A security review of this payload should find only facts about the recipient themselves —
 * which is also exactly what BR-MONETIZACAO-081 item 6.5 says the piece may state.
 */
export interface RankingDecision {
  user_id: string;
  piece: RankingPiece;
  channel: RankingChannel;
  /** The recipient's own position. `null` for `streak_at_risk`, which does not speak of rank. */
  rank: number | null;
  /** The recipient's own points, rounded to the scoreboard's own resolution. */
  points: number | null;
}

/** Why an evaluated account got nothing. Counted, never named — the log carries no PII. */
export interface RankingSkipCounts {
  no_ranking_opt_in: number;
  no_channel: number;
  no_piece: number;
  not_on_scoreboard: number;
}

export interface RankingDispatchResult {
  decisions: RankingDecision[];
  skipped: RankingSkipCounts;
}

/**
 * Completed UTC days since the cycle started, clamped to the cycle.
 *
 * `0` on the first day, `6` on the last. It is the count of days that are ALREADY BANKED, which
 * is what the streak predicate compares `story_days` against.
 */
export function elapsedCycleDays(now: Date, cycleStart: Date): number {
  const ms = now.getTime() - cycleStart.getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  const days = Math.floor(ms / 86_400_000);
  return Math.min(days, CYCLE_DAYS - 1);
}

/**
 * Is the full-week streak alive and missing only today? — BR-RANKING-008.
 *
 * `story_days` counts distinct UTC days of the cycle with at least one story (contract column
 * 13), and the cycle week has exactly 7 UTC days (BR-RANKING-005 item 1), so item 5 of
 * BR-RANKING-008 makes "a 7-day streak" and "every day of the cycle week" THE SAME predicate.
 * That is what lets this be decided from the scoreboard alone, with no second day counter
 * anywhere — and a second day counter is precisely what CLAUDE.md §6 calls a defect.
 *
 * At risk means all three at once:
 *   - at least one day is already banked (`elapsed >= 1`): on Monday there is no streak to lose;
 *   - every banked day had a story (`story_days === elapsed`): one miss and the ×1.5 is already
 *     gone for this cycle, and telling somebody it is at risk after it died is a lie;
 *   - today has produced nothing yet (which is the same equality: today would make it
 *     `elapsed + 1`).
 *
 * What it deliberately does NOT know is HOW LONG the streak is. The cross-week counter of
 * BR-RANKING-008 item 5.a has no implementation in the database, and inventing one here would be
 * a second streak predicate — so the piece says the streak is at risk today and states no number.
 */
export function isStreakAtRisk(row: ScoreboardWeekRow, elapsedDays: number): boolean {
  if (!row.in_roster) return false;
  if (elapsedDays < 1 || elapsedDays > CYCLE_DAYS - 1) return false;
  return row.story_days === elapsedDays;
}

/**
 * Did this account drop from the position we last told it about?
 *
 * The comparison is against the last COMMUNICATED rank, not against an arbitrary snapshot, for
 * two reasons: it is the only reading that does not require storage this product does not have,
 * and it is the only one the recipient can recognise — "you dropped to 4th" is only true for
 * somebody who was told they were 3rd.
 *
 * A 0-point account is excluded: in `week` every row is ranked, including accounts that entered
 * the roster without scoring (contract column 19), and those are tied at the end. Announcing a
 * drop there is announcing the arrival of somebody else, not a loss of the recipient's own.
 */
export function hasRankDrop(row: ScoreboardWeekRow, lastCommunicatedRank: number | undefined): boolean {
  if (!row.in_roster) return false;
  if (row.points_official <= 0) return false;
  if (row.rank_official === null || lastCommunicatedRank === undefined) return false;
  return row.rank_official > lastCommunicatedRank;
}

/**
 * Is this account's position in dispute? — **BR-MONETIZACAO-081 item 6.2, and this is the only
 * implementation of that predicate on the server** (item 6.6, CLAUDE.md §6).
 *
 * The three conditions, all at the same instant:
 *   a. in the roster of the current weekly cycle with `points_official > 0` — whoever never
 *      scored this week has no position to lose;
 *   b. at least one account in the position IMMEDIATELY above or IMMEDIATELY below, at a point
 *      distance of at most `DISPUTE_POINT_DISTANCE`;
 *   c. the balance has reached zero.
 *
 * On ties: `rank_official` repeats, so "immediately above" is the greatest rank below this one
 * that actually exists in the cycle, and "immediately below" the smallest rank above it. The
 * distance is measured against the closest account at those ranks.
 */
export function isPositionInDispute(
  row: ScoreboardWeekRow,
  weekRows: readonly ScoreboardWeekRow[],
  hasZeroBalance: boolean
): boolean {
  // (a)
  if (!row.in_roster || row.points_official <= 0 || row.rank_official === null) return false;
  // (c) — cheap and it eliminates most of the base, so it runs before the neighbour scan.
  if (!hasZeroBalance) return false;

  // (b)
  const own = row.rank_official;
  let above: number | null = null; // greatest rank strictly better (smaller) than own
  let below: number | null = null; // smallest rank strictly worse (greater) than own
  for (const other of weekRows) {
    const rank = other.rank_official;
    if (rank === null || other.user_id === row.user_id) continue;
    if (rank < own && (above === null || rank > above)) above = rank;
    if (rank > own && (below === null || rank < below)) below = rank;
  }

  for (const other of weekRows) {
    if (other.user_id === row.user_id || other.rank_official === null) continue;
    if (other.rank_official !== above && other.rank_official !== below) continue;
    if (Math.abs(other.points_official - row.points_official) <= DISPUTE_POINT_DISTANCE) return true;
  }
  return false;
}

/**
 * The single piece this account gets today, or `null`.
 *
 * One piece, never two: the daily slot is one (BR-COMUNICACAO-014 item 3) and the order is the
 * perishability of BR-COMUNICACAO-012 item 1.4.e.
 */
export function selectRankingPiece(
  row: ScoreboardWeekRow,
  context: {
    weekRows: readonly ScoreboardWeekRow[];
    elapsedDays: number;
    lastCommunicatedRank: number | undefined;
    hasZeroBalance: boolean | null;
  }
): RankingPiece | null {
  for (const piece of RANKING_PIECES_BY_PERISHABILITY) {
    if (piece === 'streak_at_risk' && isStreakAtRisk(row, context.elapsedDays)) return piece;
    if (piece === 'rank_at_risk') {
      // `null` is "not measured", and not measured is not zero — see `zeroBalanceUserIds`.
      if (context.hasZeroBalance === null) continue;
      if (isPositionInDispute(row, context.weekRows, context.hasZeroBalance)) return piece;
    }
    if (piece === 'rank_drop' && hasRankDrop(row, context.lastCommunicatedRank)) return piece;
  }
  return null;
}

/**
 * Which channel reaches this person — BR-COMUNICACAO-012 item 1.4.a and BR-COMUNICACAO-017 item 2.
 *
 * `null` for "no recipient", and that is the common answer, not the exception:
 *   - without the scoreboard opt-in there is no recipient at all, on any channel;
 *   - push needs its own opt-in AND a live token;
 *   - e-mail is only for whoever push does not reach, and needs the third consent. The same
 *     piece never leaves by both channels for the same person in the same cycle, which this
 *     function guarantees by construction: it returns one value.
 *
 * `NULL` consent ("never answered") is treated exactly like `false` HERE, and only here: the two
 * are different facts for the product (they are what tells us whether to ask again) but identical
 * for sending — neither is permission.
 */
export function resolveRankingChannel(consent: RecipientConsent | undefined): RankingChannel | null {
  if (!consent) return null;
  if (consent.ranking_opt_in !== true) return null;
  if (consent.push_notifications_enabled === true && consent.has_live_push_token) return 'push';
  if (consent.email_opt_in === true) return 'email';
  return null;
}

/**
 * The whole mechanism: who gets what, today, on which channel.
 *
 * The degenerate case the card asks to see proved: a week in which nobody scored produces an
 * empty `decisions`. It falls out of the predicates rather than being special-cased —
 * `points_official > 0` gates the drop and the dispute, and `story_days === elapsed` with
 * `elapsed >= 1` gates the streak.
 */
export function buildRankingDispatch(input: RankingDispatchInput): RankingDispatchResult {
  const elapsedDays = elapsedCycleDays(input.now, input.cycleStart);
  const rowByUserId = new Map(input.weekRows.map((r) => [r.user_id, r]));
  const decisions: RankingDecision[] = [];
  const skipped: RankingSkipCounts = {
    no_ranking_opt_in: 0,
    no_channel: 0,
    no_piece: 0,
    not_on_scoreboard: 0,
  };

  for (const userId of input.evaluatedUserIds) {
    const row = rowByUserId.get(userId);
    if (!row) {
      skipped.not_on_scoreboard += 1;
      continue;
    }

    const consent = input.consentByUserId.get(userId);
    if (!consent || consent.ranking_opt_in !== true) {
      skipped.no_ranking_opt_in += 1;
      continue;
    }

    const channel = resolveRankingChannel(consent);
    if (!channel) {
      skipped.no_channel += 1;
      continue;
    }

    const piece = selectRankingPiece(row, {
      weekRows: input.weekRows,
      elapsedDays,
      lastCommunicatedRank: input.lastCommunicatedRankByUserId.get(userId),
      hasZeroBalance: input.zeroBalanceUserIds === null ? null : input.zeroBalanceUserIds.has(userId),
    });
    if (!piece) {
      skipped.no_piece += 1;
      continue;
    }

    decisions.push({
      user_id: userId,
      piece,
      channel,
      // The streak piece speaks of the streak, not of the table: it carries no position.
      rank: piece === 'streak_at_risk' ? null : row.rank_official,
      points: piece === 'streak_at_risk' ? null : row.points_official,
    });
  }

  return { decisions, skipped };
}
