/**
 * The ranking communication mechanism — #747, the server half of phase 2.4 of epic #737.
 *
 * What this file proves, and every case names the rule it answers to:
 *
 *  - **BR-MONETIZACAO-081 item 6.2** — the ONE predicate of "position in dispute": roster,
 *    `points_official > 0`, a neighbour within 10 points, and a balance at zero. Item 6.6 says
 *    the push and the funnel origin may not disagree, so this predicate having a second
 *    implementation anywhere is the defect; the last test in this file is the ruler that keeps
 *    the orchestrator consuming it instead of re-inlining it.
 *  - **BR-COMUNICACAO-012 item 1.4.a** — both consents, and neither implies the other.
 *  - **BR-COMUNICACAO-012 item 1.4.e** — no schedule of its own, one evaluation per recipient per
 *    day, and the dispute order is perishability. Also: **no countdown in hours anywhere**, which
 *    is proved structurally — the decision carries no clock at all.
 *  - **BR-COMUNICACAO-017 items 2 and 3** — e-mail is the channel of whoever push does not reach,
 *    with a third, independent consent.
 *  - **BR-RANKING-002** — never the total of participants, nor anything it can be deduced from.
 *  - **BR-RANKING-007 item 4** — the three consents are independent.
 *  - **BR-RANKING-008** — the streak is UTC calendar days with a story delivered.
 *
 * The degenerate case the card asked to see proved has its own test: a week in which nobody
 * scored sends nothing at all.
 *
 * The module is Deno source (`.ts` specifier), so it is loaded through a path built at run time —
 * a static import ending in `.ts` fails `npm run type-check` for the whole repo.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MODULE_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/_shared/ranking-communication.ts'
)
const ORCHESTRATOR_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/daily-gamification-orchestrator/index.ts'
)

let mod: any

before(async () => {
  mod = await import(pathToFileURL(MODULE_PATH).href)
})

/** A scoreboard week row with everything neutral, so each test states only what it is about. */
const row = (over: Record<string, unknown> = {}) => ({
  user_id: 'u1',
  rank_official: 4,
  points_official: 20,
  story_days: 0,
  in_roster: true,
  ...over,
})

/** A consent record with everything granted, so each test states only what it removes. */
const consent = (over: Record<string, unknown> = {}) => ({
  user_id: 'u1',
  ranking_opt_in: true,
  email_opt_in: true,
  push_notifications_enabled: true,
  has_live_push_token: true,
  ...over,
})

const CYCLE_START = new Date('2026-09-14T00:00:00.000Z') // a Monday, UTC

/** `days` full UTC days into the cycle, plus a few hours so it is mid-day. */
const dayOfCycle = (days: number) =>
  new Date(CYCLE_START.getTime() + days * 86_400_000 + 7 * 3_600_000)

// ---------------------------------------------------------------------------------------------
// BR-COMUNICACAO-012 item 1.4.e — the order is perishability, and there is no clock
// ---------------------------------------------------------------------------------------------

test('BR-COMUNICACAO-012 item 1.4.e: the dispute order is streak → balance → drop, by perishability', () => {
  assert.deepEqual(
    [...mod.RANKING_PIECES_BY_PERISHABILITY],
    ['streak_at_risk', 'rank_at_risk', 'rank_drop']
  )
})

test('BR-COMUNICACAO-012 item 1.4.e: a decision carries no clock, so no piece can promise hours', () => {
  const result = mod.buildRankingDispatch({
    now: dayOfCycle(3),
    cycleStart: CYCLE_START,
    weekRows: [row({ story_days: 3 })],
    evaluatedUserIds: ['u1'],
    consentByUserId: new Map([['u1', consent()]]),
    lastCommunicatedRankByUserId: new Map(),
    zeroBalanceUserIds: new Set(),
  })

  assert.equal(result.decisions.length, 1)
  const keys = Object.keys(result.decisions[0]).sort()
  // The whole shape, enumerated: adding a deadline, a duration or an expiry to this object is
  // what would let a template render "3 hours left", and the daily window cannot sustain that.
  assert.deepEqual(keys, ['channel', 'piece', 'points', 'rank', 'user_id'])
})

test('BR-RANKING-002: a decision carries no total, no neighbour and no denominator', () => {
  const result = mod.buildRankingDispatch({
    now: dayOfCycle(2),
    cycleStart: CYCLE_START,
    weekRows: [row({ rank_official: 5, points_official: 30 }), row({ user_id: 'u2', rank_official: 1, points_official: 90 })],
    evaluatedUserIds: ['u1'],
    consentByUserId: new Map([['u1', consent()]]),
    lastCommunicatedRankByUserId: new Map([['u1', 2]]),
    zeroBalanceUserIds: new Set(),
  })

  const decision = result.decisions[0]
  assert.equal(decision.piece, 'rank_drop')
  const serialized = JSON.stringify(decision)
  // 2 accounts exist in the cycle; nothing in the payload says so, or allows it to be worked out.
  assert.equal(serialized.includes('total'), false)
  assert.equal(serialized.includes('count'), false)
  assert.equal(decision.rank, 5)
})

// ---------------------------------------------------------------------------------------------
// BR-RANKING-008 — the streak
// ---------------------------------------------------------------------------------------------

test('BR-RANKING-008: the streak is at risk when every banked day has a story and today has none', () => {
  // Day 4 of the cycle: 3 completed days, 3 story days, today still empty.
  assert.equal(mod.isStreakAtRisk(row({ story_days: 3 }), 3), true)
})

test('BR-RANKING-008: a streak already broken this cycle is not at risk — it is gone', () => {
  assert.equal(mod.isStreakAtRisk(row({ story_days: 2 }), 3), false)
})

test('BR-RANKING-008: today already has a story, so nothing is at risk', () => {
  assert.equal(mod.isStreakAtRisk(row({ story_days: 4 }), 3), false)
})

test('BR-RANKING-008 item 5.b: on the first day of the cycle there is no streak to lose', () => {
  assert.equal(mod.isStreakAtRisk(row({ story_days: 0 }), 0), false)
})

test('BR-RANKING-008: an account outside the roster has no streak piece', () => {
  assert.equal(mod.isStreakAtRisk(row({ story_days: 3, in_roster: false }), 3), false)
})

test('BR-RANKING-005 item 1: elapsed days are counted in UTC and never exceed the cycle', () => {
  assert.equal(mod.elapsedCycleDays(dayOfCycle(0), CYCLE_START), 0)
  assert.equal(mod.elapsedCycleDays(dayOfCycle(6), CYCLE_START), 6)
  // A late read, after the boundary, still belongs to the cycle it was given.
  assert.equal(mod.elapsedCycleDays(dayOfCycle(9), CYCLE_START), 6)
})

// ---------------------------------------------------------------------------------------------
// BR-MONETIZACAO-081 item 6.2 — the single predicate of "position in dispute"
// ---------------------------------------------------------------------------------------------

const disputeRows = [
  row({ user_id: 'above', rank_official: 3, points_official: 26 }),
  row({ user_id: 'me', rank_official: 4, points_official: 20 }),
  row({ user_id: 'below', rank_official: 5, points_official: 4 }),
]
const me = disputeRows[1]

test('BR-MONETIZACAO-081 item 6.2: roster, points, a neighbour within 10 and a zero balance', () => {
  assert.equal(mod.isPositionInDispute(me, disputeRows, true), true)
})

test('BR-MONETIZACAO-081 item 6.2.c: a balance above zero is not a dispute — it is the instant that matters', () => {
  assert.equal(mod.isPositionInDispute(me, disputeRows, false), false)
})

test('BR-MONETIZACAO-081 item 6.2.a: whoever never scored this week has no position to lose', () => {
  const rows = disputeRows.map((r) => (r.user_id === 'me' ? { ...r, points_official: 0 } : r))
  assert.equal(mod.isPositionInDispute(rows[1], rows, true), false)
})

test('BR-MONETIZACAO-081 item 6.2.a: outside the roster there is no dispute', () => {
  const rows = disputeRows.map((r) => (r.user_id === 'me' ? { ...r, in_roster: false } : r))
  assert.equal(mod.isPositionInDispute(rows[1], rows, true), false)
})

test('BR-MONETIZACAO-081 item 6.2.b: 40th place with nobody within 10 points receives nothing, and that is the design', () => {
  const lonely = [
    row({ user_id: 'above', rank_official: 39, points_official: 80 }),
    row({ user_id: 'me', rank_official: 40, points_official: 20 }),
    row({ user_id: 'below', rank_official: 41, points_official: 2 }),
  ]
  assert.equal(mod.isPositionInDispute(lonely[1], lonely, true), false)
})

test('BR-MONETIZACAO-081 item 6.3: the distance is the podium floor of BR-RANKING-003, exactly 10', () => {
  assert.equal(mod.DISPUTE_POINT_DISTANCE, 10)
  const atTen = [
    row({ user_id: 'me', rank_official: 4, points_official: 20 }),
    row({ user_id: 'above', rank_official: 3, points_official: 30 }),
  ]
  assert.equal(mod.isPositionInDispute(atTen[0], atTen, true), true)

  const justOver = [
    row({ user_id: 'me', rank_official: 4, points_official: 20 }),
    row({ user_id: 'above', rank_official: 3, points_official: 30.01 }),
  ]
  assert.equal(mod.isPositionInDispute(justOver[0], justOver, true), false)
})

test('BR-MONETIZACAO-081 item 6.2.b: the neighbour is the immediate rank, not any account within 10 points', () => {
  // `far` is within 10 points but three positions away: not a neighbour, not a dispute.
  const rows = [
    row({ user_id: 'me', rank_official: 4, points_official: 20 }),
    row({ user_id: 'above', rank_official: 3, points_official: 60 }),
    row({ user_id: 'below', rank_official: 5, points_official: 1 }),
    row({ user_id: 'far', rank_official: 7, points_official: 19 }),
  ]
  assert.equal(mod.isPositionInDispute(rows[0], rows, true), false)
})

test('BR-MONETIZACAO-081 item 6.2: a balance that could not be measured is not a zero balance', () => {
  const result = mod.buildRankingDispatch({
    now: dayOfCycle(2),
    cycleStart: CYCLE_START,
    weekRows: disputeRows,
    evaluatedUserIds: ['me'],
    consentByUserId: new Map([['me', consent({ user_id: 'me' })]]),
    lastCommunicatedRankByUserId: new Map(),
    zeroBalanceUserIds: null, // the ledger gate refused, or the RPC is missing
  })
  assert.deepEqual(result.decisions, [])
  assert.equal(result.skipped.no_piece, 1)
})

// ---------------------------------------------------------------------------------------------
// The drop
// ---------------------------------------------------------------------------------------------

test('#747: a drop is measured against the position the recipient was TOLD', () => {
  assert.equal(mod.hasRankDrop(row({ rank_official: 4 }), 3), true)
  assert.equal(mod.hasRankDrop(row({ rank_official: 2 }), 3), false) // a rise is not this piece
  assert.equal(mod.hasRankDrop(row({ rank_official: 3 }), 3), false)
})

test('#747: never having been told a position means there is no drop to announce', () => {
  assert.equal(mod.hasRankDrop(row({ rank_official: 9 }), undefined), false)
})

test('BR-RANKING-001: a 0-point roster row is ranked last and its "drop" is somebody else arriving', () => {
  assert.equal(mod.hasRankDrop(row({ rank_official: 12, points_official: 0 }), 8), false)
})

// ---------------------------------------------------------------------------------------------
// Consent — BR-COMUNICACAO-012 item 1.4.a, BR-COMUNICACAO-017 items 2/3, BR-RANKING-007 item 4
// ---------------------------------------------------------------------------------------------

test('BR-RANKING-007 item 4: without the scoreboard opt-in there is no recipient, on any channel', () => {
  assert.equal(mod.resolveRankingChannel(consent({ ranking_opt_in: null })), null)
  assert.equal(mod.resolveRankingChannel(consent({ ranking_opt_in: false })), null)
})

test('BR-COMUNICACAO-012 item 1.4.a: in the roster without the push opt-in is not a push recipient', () => {
  assert.equal(
    mod.resolveRankingChannel(consent({ push_notifications_enabled: false, email_opt_in: false })),
    null
  )
})

test('BR-RANKING-007 item 4: the push opt-in alone does not grant e-mail', () => {
  // Push unreachable (no token) and no e-mail consent: nothing goes out, in either direction.
  assert.equal(
    mod.resolveRankingChannel(consent({ has_live_push_token: false, email_opt_in: null })),
    null
  )
})

test('BR-COMUNICACAO-017 item 2: e-mail is the channel of whoever push does not reach', () => {
  // The 105 accounts that uninstalled: the token died with the installation.
  assert.equal(mod.resolveRankingChannel(consent({ has_live_push_token: false })), 'email')
  // And whoever refused push but accepted e-mail.
  assert.equal(mod.resolveRankingChannel(consent({ push_notifications_enabled: false })), 'email')
})

test('BR-COMUNICACAO-017 item 2: the same piece never leaves by both channels for the same person', () => {
  // Push reachable wins; `resolveRankingChannel` returns one value and there is no second path.
  assert.equal(mod.resolveRankingChannel(consent()), 'push')
})

// ---------------------------------------------------------------------------------------------
// The whole mechanism
// ---------------------------------------------------------------------------------------------

test('#747: a week in which nobody scored sends no piece at all', () => {
  const quietWeek = [
    row({ user_id: 'a', rank_official: 1, points_official: 0, story_days: 0 }),
    row({ user_id: 'b', rank_official: 1, points_official: 0, story_days: 0 }),
    row({ user_id: 'c', rank_official: 1, points_official: 0, story_days: 0 }),
  ]
  const result = mod.buildRankingDispatch({
    now: dayOfCycle(4),
    cycleStart: CYCLE_START,
    weekRows: quietWeek,
    evaluatedUserIds: ['a', 'b', 'c'],
    consentByUserId: new Map(
      quietWeek.map((r) => [r.user_id, consent({ user_id: r.user_id })])
    ),
    // Even with a position told last week and a zero balance, nothing is due: no points, no story.
    lastCommunicatedRankByUserId: new Map([['a', 1], ['b', 1], ['c', 1]]),
    zeroBalanceUserIds: new Set(['a', 'b', 'c']),
  })

  assert.deepEqual(result.decisions, [])
  assert.equal(result.skipped.no_piece, 3)
})

test('BR-COMUNICACAO-012 item 1.4.e: one evaluation per recipient, and one piece — the most perishable', () => {
  // This account qualifies for all three at once: streak alive and missing today, position in
  // dispute with a zero balance, and a drop from the 3rd place it was told about.
  const rows = [
    row({ user_id: 'me', rank_official: 4, points_official: 20, story_days: 3 }),
    row({ user_id: 'above', rank_official: 3, points_official: 26 }),
  ]
  const result = mod.buildRankingDispatch({
    now: dayOfCycle(3),
    cycleStart: CYCLE_START,
    weekRows: rows,
    evaluatedUserIds: ['me'],
    consentByUserId: new Map([['me', consent({ user_id: 'me' })]]),
    lastCommunicatedRankByUserId: new Map([['me', 3]]),
    zeroBalanceUserIds: new Set(['me']),
  })

  assert.equal(result.decisions.length, 1)
  assert.equal(result.decisions[0].piece, 'streak_at_risk')
})

test('BR-RANKING-008: the streak piece states no position and no points, because it has no day counter', () => {
  const result = mod.buildRankingDispatch({
    now: dayOfCycle(3),
    cycleStart: CYCLE_START,
    weekRows: [row({ story_days: 3 })],
    evaluatedUserIds: ['u1'],
    consentByUserId: new Map([['u1', consent()]]),
    lastCommunicatedRankByUserId: new Map(),
    zeroBalanceUserIds: new Set(),
  })
  assert.equal(result.decisions[0].rank, null)
  assert.equal(result.decisions[0].points, null)
})

test('#747: an account the scoreboard does not carry is counted, not guessed at', () => {
  const result = mod.buildRankingDispatch({
    now: dayOfCycle(3),
    cycleStart: CYCLE_START,
    weekRows: [],
    evaluatedUserIds: ['ghost'],
    consentByUserId: new Map([['ghost', consent({ user_id: 'ghost' })]]),
    lastCommunicatedRankByUserId: new Map(),
    zeroBalanceUserIds: new Set(),
  })
  assert.deepEqual(result.decisions, [])
  assert.equal(result.skipped.not_on_scoreboard, 1)
})

// ---------------------------------------------------------------------------------------------
// The ruler — the orchestrator CONSUMES the predicate, it does not re-inline it
// ---------------------------------------------------------------------------------------------

test('CLAUDE.md §6 / BR-MONETIZACAO-081 item 6.6: the orchestrator consumes the mechanism instead of restating it', () => {
  // `daily-gamification-orchestrator/index.ts` imports a remote URL on its first lines and cannot
  // be loaded here (measured 2026-08-23 on `firebase-push-notification`), so this half is a
  // source ruler. Without it the tests above would keep passing while somebody wrote a second
  // "is in dispute" by hand next to the send.
  const source = readFileSync(ORCHESTRATOR_PATH, 'utf8')
  assert.match(source, /from '\.\.\/_shared\/ranking-communication\.ts'/)
  assert.match(source, /buildRankingDispatch\(/)
  // No second predicate: the constants of the rule appear in the shared module and nowhere else.
  assert.equal(/DISPUTE_POINT_DISTANCE\s*=/.test(source), false)
  assert.equal(/points_official\s*>\s*0/.test(source), false)
})
