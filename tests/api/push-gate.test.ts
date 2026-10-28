/**
 * #955: the one gate of every push to a tourist (BR-COMUNICACAO-019 items 2, 4, 5, 7 and 9).
 *
 * Two halves, as everywhere an Edge Function talks to the database:
 *  1. `_shared/push-gate.ts` is pure and is EXECUTED here against a fake `drive` client that
 *     answers like PostgREST: allowed, denied, function missing, requested and unrequested.
 *  2. a source ruler over `firebase-push-notification/index.ts` and the orchestrator, because both
 *     import a remote URL and Node cannot load them: every FCM send of the function is inside the
 *     gated sender, and the daily window no longer sends `daily_fomo`.
 *
 * The module is imported through a path built at runtime: a static import ending in `.ts` fails
 * `npm run type-check` for the whole repo.
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const FUNCTIONS = resolve(import.meta.dirname, '../../supabase/functions')
const MODULE_PATH = resolve(FUNCTIONS, '_shared/push-gate.ts')
const RANKING_PATH = resolve(FUNCTIONS, '_shared/ranking-communication.ts')
const PUSH_PATH = resolve(FUNCTIONS, 'firebase-push-notification/index.ts')
const ORCHESTRATOR_PATH = resolve(FUNCTIONS, 'daily-gamification-orchestrator/index.ts')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let gate: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ranking: any

before(async () => {
  gate = await import(pathToFileURL(MODULE_PATH).href)
  ranking = await import(pathToFileURL(RANKING_PATH).href)
})

type RpcAnswer = { data: unknown; error: { code?: string } | null }

/** A `drive` client whose answers are scripted per function, and which records every call. */
function fakeDrive(answers: Record<string, RpcAnswer>) {
  const calls: Array<{ fn: string; args: Record<string, unknown> | undefined }> = []
  return {
    calls,
    rpc(fn: string, args?: Record<string, unknown>) {
      calls.push({ fn, args })
      return Promise.resolve(answers[fn] ?? { data: null, error: { code: 'PGRST202' } })
    },
  }
}

const MISSING = { data: null, error: { code: 'PGRST202' } }
const USER = '00000000-0000-4000-8000-000000000001'

const unrequested = (kind = 'cms_direct') => ({ userId: USER, kind, requested: false, requiresActive: false })
const requested = () => ({ userId: USER, kind: 'cms_direct', requested: true, requiresActive: false })

function deliverSpy(accepted = true) {
  const spy = { count: 0, fn: async () => { spy.count += 1; return accepted } }
  return spy
}

// ---------------------------------------------------------------------------------------------
// The helper: asks, sends on a yes, records after the provider accepted
// ---------------------------------------------------------------------------------------------

test('BR-COMUNICACAO-019 item 9: allowed: sends once and records after the provider accepted', async () => {
  const drive = fakeDrive({ push_allowed: { data: true, error: null }, record_push_sent: { data: null, error: null } })
  const deliver = deliverSpy(true)
  const result = await gate.sendThroughPushGate(drive, unrequested(), null, deliver.fn)
  assert.deepEqual(result, { outcome: 'sent', recorded: true })
  assert.equal(deliver.count, 1)
  assert.deepEqual(drive.calls.map((c) => c.fn), ['push_allowed', 'record_push_sent'])
  // The same three arguments both times: what was asked is what is counted.
  assert.deepEqual(drive.calls[0].args, { p_user_id: USER, p_kind: 'cms_direct', p_requested: false })
  assert.deepEqual(drive.calls[1].args, drive.calls[0].args)
})

test('BR-COMUNICACAO-019 items 4 and 5: denied: nothing is sent and nothing is recorded', async () => {
  const drive = fakeDrive({ push_allowed: { data: false, error: null } })
  const deliver = deliverSpy()
  const result = await gate.sendThroughPushGate(drive, unrequested(), null, deliver.fn)
  assert.deepEqual(result, { outcome: 'denied', recorded: false })
  assert.equal(deliver.count, 0)
  assert.deepEqual(drive.calls.map((c) => c.fn), ['push_allowed'])
})

test('BR-COMUNICACAO-019 item 9: a gate answer that is not exactly true is not a yes', async () => {
  for (const data of [null, 'true', 1, {}]) {
    const drive = fakeDrive({ push_allowed: { data, error: null } })
    const deliver = deliverSpy()
    const result = await gate.sendThroughPushGate(drive, unrequested(), null, deliver.fn)
    assert.equal(result.outcome, 'denied', JSON.stringify(data))
    assert.equal(deliver.count, 0)
  }
})

test('#955: gate function missing: the unrequested push is withheld', async () => {
  for (const code of ['PGRST202', '42883']) {
    const drive = fakeDrive({ push_allowed: { data: null, error: { code } } })
    const deliver = deliverSpy()
    const result = await gate.sendThroughPushGate(drive, unrequested(), null, deliver.fn)
    assert.deepEqual(result, { outcome: 'gate_missing', recorded: false }, code)
    assert.equal(deliver.count, 0)
  }
})

test('#955: gate function missing: the requested push still leaves, and is not recorded', async () => {
  const drive = fakeDrive({ push_allowed: MISSING })
  const deliver = deliverSpy(true)
  const result = await gate.sendThroughPushGate(drive, requested(), null, deliver.fn)
  assert.deepEqual(result, { outcome: 'sent', recorded: false })
  assert.equal(deliver.count, 1)
  // record_push_sent lives in the same migration: there is nothing to call.
  assert.deepEqual(drive.calls.map((c) => c.fn), ['push_allowed'])
})

test('BR-COMUNICACAO-019 item 3.a: a requested push asks the gate with p_requested = true', async () => {
  const drive = fakeDrive({ push_allowed: { data: true, error: null }, record_push_sent: { data: null, error: null } })
  await gate.sendThroughPushGate(drive, requested(), null, deliverSpy().fn)
  assert.equal(drive.calls[0].args?.p_requested, true)
  assert.equal(drive.calls[1].args?.p_requested, true)
})

test('#955: any other gate error sends nothing, requested or not: unknown is not consent', async () => {
  for (const request of [unrequested(), requested()]) {
    const drive = fakeDrive({ push_allowed: { data: null, error: { code: '57014' } } })
    const deliver = deliverSpy()
    const result = await gate.sendThroughPushGate(drive, request, null, deliver.fn)
    assert.equal(result.outcome, 'gate_error')
    assert.equal(deliver.count, 0)
  }
})

test('#955: the provider took nothing: not recorded, so the cap does not count a push nobody got', async () => {
  const drive = fakeDrive({ push_allowed: { data: true, error: null } })
  const result = await gate.sendThroughPushGate(drive, unrequested(), null, deliverSpy(false).fn)
  assert.deepEqual(result, { outcome: 'not_delivered', recorded: false })
  assert.deepEqual(drive.calls.map((c) => c.fn), ['push_allowed'])
})

test('#955: a delivery that throws is a failure, not a send', async () => {
  const drive = fakeDrive({ push_allowed: { data: true, error: null } })
  const result = await gate.sendThroughPushGate(drive, unrequested(), null, async () => {
    throw new Error('network')
  })
  assert.deepEqual(result, { outcome: 'failed', recorded: false })
})

test('#955: a failed record is reported, and the push already left', async () => {
  const drive = fakeDrive({ push_allowed: { data: true, error: null }, record_push_sent: { data: null, error: { code: '23503' } } })
  const result = await gate.sendThroughPushGate(drive, unrequested(), null, deliverSpy().fn)
  assert.deepEqual(result, { outcome: 'sent', recorded: false })
})

// ---------------------------------------------------------------------------------------------
// "Using the app": BR-COMUNICACAO-019 item 2
// ---------------------------------------------------------------------------------------------

test('BR-COMUNICACAO-019 item 2: a kind that needs "using the app" asks with the policy window, before the cap', async () => {
  const drive = fakeDrive({
    user_active_within_days: { data: true, error: null },
    push_allowed: { data: true, error: null },
    record_push_sent: { data: null, error: null },
  })
  const request = gate.pushGateRequest(USER, 'referral_hours_credited')
  const result = await gate.sendThroughPushGate(drive, request, 7, deliverSpy().fn)
  assert.equal(result.outcome, 'sent')
  assert.deepEqual(drive.calls[0], { fn: 'user_active_within_days', args: { p_user_id: USER, p_days: 7 } })
  assert.equal(drive.calls[1].fn, 'push_allowed')
})

test('BR-COMUNICACAO-019 item 3.e: not using the app: no push, and the cap is not even asked', async () => {
  const drive = fakeDrive({ user_active_within_days: { data: false, error: null } })
  const deliver = deliverSpy()
  const request = gate.pushGateRequest(USER, 'referral_hours_credited')
  const result = await gate.sendThroughPushGate(drive, request, 7, deliver.fn)
  assert.deepEqual(result, { outcome: 'inactive', recorded: false })
  assert.equal(deliver.count, 0)
  assert.deepEqual(drive.calls.map((c) => c.fn), ['user_active_within_days'])
})

test('BR-COMUNICACAO-019 item 2: the window could not be read, so nobody counts as using the app', async () => {
  const drive = fakeDrive({})
  const deliver = deliverSpy()
  const request = gate.pushGateRequest(USER, 'weekly_podium')
  const result = await gate.sendThroughPushGate(drive, request, null, deliver.fn)
  assert.equal(result.outcome, 'gate_error')
  assert.equal(deliver.count, 0)
  assert.equal(drive.calls.length, 0)
})

test('#955: the activity function missing withholds the push like the gate missing does', async () => {
  const drive = fakeDrive({ user_active_within_days: MISSING })
  const request = gate.pushGateRequest(USER, 'ranking_rank_drop')
  const result = await gate.sendThroughPushGate(drive, request, 7, deliverSpy().fn)
  assert.equal(result.outcome, 'gate_missing')
})

test('BR-COMUNICACAO-019 item 2: the window is the number of drive.unrequested_push_policy(), never one of ours', async () => {
  const drive = fakeDrive({ unrequested_push_policy: { data: [{ active_window_days: 7 }], error: null } })
  assert.equal(await gate.readActiveWindowDays(drive), 7)
  assert.equal(await gate.readActiveWindowDays(fakeDrive({ unrequested_push_policy: { data: [{ active_window_days: 3 }], error: null } })), 3)
  assert.equal(await gate.readActiveWindowDays(fakeDrive({})), null)
  assert.equal(await gate.readActiveWindowDays(fakeDrive({ unrequested_push_policy: { data: [{}], error: null } })), null)
  // And no 7 is written in the gate or the orchestrator.
  for (const path of [MODULE_PATH, ORCHESTRATOR_PATH]) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /p_days:\s*7\b/, path)
  }
})

// ---------------------------------------------------------------------------------------------
// The kinds and the vacancy order: BR-COMUNICACAO-019 items 3 and 7
// ---------------------------------------------------------------------------------------------

test('BR-COMUNICACAO-019 item 7: streak first, then referral hours, then the other ranking pieces, the CMS last', () => {
  const p = (kind: string) => gate.PUSH_KINDS[kind].vacancyPriority
  assert.ok(p('ranking_streak_at_risk') < p('referral_hours_credited'))
  for (const kind of ['ranking_rank_at_risk', 'ranking_rank_drop', 'weekly_podium']) {
    assert.ok(p('referral_hours_credited') < p(kind), kind)
    assert.ok(p(kind) < p('cms_broadcast'), kind)
  }
  assert.equal(p('cms_broadcast'), Math.max(...Object.values(gate.PUSH_KINDS).map((k: any) => k.vacancyPriority)))
})

test('BR-COMUNICACAO-019 item 7: the daily window order agrees with the vacancy order', () => {
  // `RANKING_PIECES_BY_PERISHABILITY` is the ranking slice of item 7 inside one evaluation; the
  // two orders may never disagree.
  const priorities = ranking.RANKING_PIECES_BY_PERISHABILITY.map(
    (piece: string) => gate.PUSH_KINDS[ranking.RANKING_PUSH_TYPE[piece]].vacancyPriority
  )
  assert.deepEqual([...priorities].sort((a: number, b: number) => a - b), priorities)
})

test('#955: every ranking piece pushes under a kind the gate knows, and p_kind is valid SQL-side', () => {
  for (const type of Object.values(ranking.RANKING_PUSH_TYPE)) {
    assert.equal(gate.parsePushKind(type), type)
  }
  for (const kind of Object.keys(gate.PUSH_KINDS)) {
    assert.match(kind, /^[a-z0-9_]{1,64}$/, kind)
  }
})

test('BR-COMUNICACAO-019 items 3.e, 3.j, 3.l, 3.m.1: who is unrequested and who needs "using the app"', () => {
  // 3.m.1: the weekly pieces reach whoever has push on, using the app or not.
  const reachesEveryone = (kind: string) => kind.startsWith('cms_') || kind.endsWith('_local')
  for (const [kind, policy] of Object.entries(gate.PUSH_KINDS) as Array<[string, any]>) {
    assert.equal(policy.requested, false, `${kind}: no requested sender exists yet`)
    assert.equal(policy.requiresActive, !reachesEveryone(kind), kind)
  }
})

test('#955: an unknown kind is refused, never defaulted', () => {
  for (const value of ['daily_fomo', 'hours_credited', '', null, undefined, 7, 'toString', '__proto__']) {
    assert.equal(gate.parsePushKind(value), null, String(value))
  }
})

test('#955: the one-person /send answer names its outcome; an answer without a tally names none', () => {
  const tally = { ...gate.emptyGateTally(), denied: 1 }
  assert.equal(gate.singleGateOutcome({ success: true, gate: tally }), 'denied')
  assert.equal(gate.singleGateOutcome({ success: true, gate: gate.emptyGateTally() }), null)
  assert.equal(gate.singleGateOutcome({ success: true, result: {} }), null)
  assert.equal(gate.singleGateOutcome(null), null)
})

// ---------------------------------------------------------------------------------------------
// The rulers: the functions import a remote URL and cannot be loaded here
// ---------------------------------------------------------------------------------------------

test('BR-COMUNICACAO-019 item 9: firebase-push-notification reaches FCM only from inside the gated sender', () => {
  const source = readFileSync(PUSH_PATH, 'utf8')
  assert.match(source, /from '\.\.\/_shared\/push-gate\.ts'/)
  assert.match(source, /sendThroughPushGate\(/)
  // `sendNotification(` is declared once and called once, in `deliverTo`, which only the gate (or
  // the partner path, `kind = null`) calls.
  const calls = source.match(/await sendNotification\(/g) ?? []
  assert.equal(calls.length, 1, `sendNotification is called ${calls.length} times`)
  const deliverAt = source.indexOf('const deliverTo = async')
  const callAt = source.indexOf('await sendNotification(')
  const gatedEnd = source.indexOf('// -------- ROUTES --------')
  assert.ok(deliverAt > -1 && callAt > deliverAt && callAt < gatedEnd, 'the FCM send moved out of the gated sender')
  // The routes send only through it.
  const routes = source.slice(gatedEnd)
  assert.ok((routes.match(/gatedSendToUsers\(/g) ?? []).length >= 4, 'a route sends around the gate')
  // The topic send is gone: nothing addresses FCM by topic any more.
  assert.doesNotMatch(source, /message: \{ \.\.\.baseMessage, topic \}/)
  assert.match(source, /TOPIC_NOT_GATED/)
})

test('BR-COMUNICACAO-019, "Não se aplica a": only the partner template skips the gate, and only without a caller title', () => {
  const source = readFileSync(PUSH_PATH, 'utf8')
  assert.match(source, /const isPartnerTemplate = Boolean\(template\) && !notification\?\.title;/)
  assert.match(source, /if \(type === 'user' && !isPartnerTemplate\) \{/)
  assert.match(source, /'cms_broadcast'/)
})

test('BR-COMUNICACAO-019 item 3.i: the daily window sends no daily_fomo any more', () => {
  const source = readFileSync(ORCHESTRATOR_PATH, 'utf8')
  assert.doesNotMatch(source, /type:\s*'daily_fomo'/)
  assert.doesNotMatch(source, /getTranslation|daily-push-i18n/)
  // What it still sends declares its kind to the gate.
  assert.match(source, /push_kind: RANKING_PUSH_TYPE\[decision\.piece\]/)
  assert.match(source, /dailyWindowStep\(/)
  assert.match(source, /readUserActive\(/)
})
