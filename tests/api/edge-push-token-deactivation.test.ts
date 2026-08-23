/**
 * Who may deactivate a push token, and what a rejected payload may NOT do.
 *
 * `firebase-push-notification` (`sendNotification`) walks the recipients one by
 * one with the SAME payload and used to answer two different FCM errors with the
 * same consequence — `drive.fcm_tokens.is_active = false`:
 *
 *     if (error.includes('UNREGISTERED') || error.includes('INVALID_ARGUMENT'))
 *
 * UNREGISTERED means the registration is gone. INVALID_ARGUMENT means the
 * REQUEST is malformed, and Firebase says so in writing: deleting the
 * registration is safe only "if you are certain that the message payload is
 * valid" (https://firebase.google.com/docs/cloud-messaging/manage-tokens).
 * Because the payload is shared by every iteration, one bad payload would
 * deactivate the entire base in a single run, and a user only comes back when
 * they reopen the app and `FCMTokenService` re-registers.
 *
 * The brake that stops such a run is itself a lever, and this suite pins both
 * ends of it:
 *  - it must fire on a payload FCM refuses;
 *  - it must NOT be reachable by whoever can put rows at the head of the
 *    audience. `core.get_audience_push_tokens` uses `array_agg(DISTINCT tok)`
 *    and DISTINCT sorts, so the head of the list is the lexicographically
 *    smallest tokens in the base — and `drive.fcm_tokens` accepts an INSERT from
 *    any signed-in user for their own `user_id`;
 *  - and no 404 may deactivate anything unless FCM named the token itself in
 *    `details[].errorCode`, because `NOT_FOUND` alone is what a wrong
 *    `FIREBASE_PROJECT_ID` answers for every token in the base.
 *
 * Two halves, and both are needed:
 *  1. the decision itself (`_shared/fcm-errors.ts`), exercised directly,
 *     including a replay of the send loop over a large audience — that is what
 *     pins the mass-failure brake to a number;
 *  2. a source ruler over `firebase-push-notification/index.ts`, because that
 *     file CANNOT be loaded here: it imports
 *     `https://esm.sh/@supabase/supabase-js@2` on its first line, which Node
 *     cannot resolve and `mock.module` does not intercept (measured 2026-08-23,
 *     same constraint as tests/api/edge-push-deeplink.test.ts). Without the
 *     ruler, half 1 would keep passing while someone folded the two codes back
 *     into one `if`, or walked the audience in the order the database handed it.
 *
 * The module is Deno source (`.ts` specifier), so it is loaded through a path
 * built at run time — a static import ending in `.ts` fails `npm run type-check`
 * for the whole repo.
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
  '../../supabase/functions/_shared/fcm-errors.ts'
)
const FUNCTION_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/firebase-push-notification/index.ts'
)

type FcmErrorBody = Record<string, unknown> | null
type Mod = {
  fcmErrorCode: (body: FcmErrorBody) => string
  isDeadRegistration: (code: string) => boolean
  isUnclassifiedNotFound: (code: string) => boolean
  isSenderPayloadError: (code: string) => boolean
  shouldAbortForBadPayload: (invalidArgumentCount: number, attempted: number) => boolean
  sampledSendOrder: <T>(tokens: readonly T[]) => T[]
  ABORT_MIN_SAMPLE: number
}

let mod: Mod

before(async () => {
  mod = (await import(pathToFileURL(MODULE_PATH).href)) as Mod
  for (const name of [
    'fcmErrorCode',
    'isDeadRegistration',
    'isUnclassifiedNotFound',
    'isSenderPayloadError',
    'shouldAbortForBadPayload',
    'sampledSendOrder',
  ] as const) {
    assert.equal(typeof mod[name], 'function', `${name} is not exported`)
  }
})

// --- The bodies FCM actually returns -----------------------------------------

/** HTTP 404. The FCM code is in `details[].errorCode`; `status` is NOT_FOUND. */
const UNREGISTERED_BODY = {
  error: {
    code: 404,
    message: 'Requested entity was not found.',
    status: 'NOT_FOUND',
    details: [
      { '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' },
    ],
  },
}

/**
 * HTTP 404 with NO `details[].errorCode` — the shape a systemic failure returns:
 * a rotated `FIREBASE_PROJECT_ID`, a deleted Firebase project, a moved endpoint.
 * `NOT_FOUND` here is the google.rpc status, and it is not an FCM error code:
 * the FCM v1 table has eight, and this is not one of them
 * (https://firebase.google.com/docs/cloud-messaging/error-codes).
 */
const SYSTEMIC_NOT_FOUND_BODY = {
  error: {
    code: 404,
    message: 'Requested entity was not found.',
    status: 'NOT_FOUND',
  },
}

/** HTTP 400 raised by the token field. Still a sender error by FCM's own rule. */
const INVALID_ARGUMENT_TOKEN_BODY = {
  error: {
    code: 400,
    message: 'The registration token is not a valid FCM registration token',
    status: 'INVALID_ARGUMENT',
    details: [
      {
        '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
        errorCode: 'INVALID_ARGUMENT',
      },
    ],
  },
}

/** HTTP 400 raised by the message body — the mass-failure shape. */
const INVALID_ARGUMENT_PAYLOAD_BODY = {
  error: {
    code: 400,
    message: 'Invalid JSON payload received. Unknown name "typ" at \'message.data\'.',
    status: 'INVALID_ARGUMENT',
    details: [
      {
        '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
        errorCode: 'INVALID_ARGUMENT',
      },
    ],
  },
}

test('the FCM code is read from the field that carries it, not from the prose message', () => {
  assert.equal(mod.fcmErrorCode(UNREGISTERED_BODY), 'UNREGISTERED')
  assert.equal(mod.fcmErrorCode(INVALID_ARGUMENT_TOKEN_BODY), 'INVALID_ARGUMENT')

  // Why the old spelling could never work: neither literal appears in `message`.
  assert.equal(UNREGISTERED_BODY.error.message.includes('UNREGISTERED'), false)
  assert.equal(INVALID_ARGUMENT_TOKEN_BODY.error.message.includes('INVALID_ARGUMENT'), false)
})

test('a body without details falls back to the google.rpc status', () => {
  assert.equal(mod.fcmErrorCode({ error: { code: 404, status: 'NOT_FOUND' } }), 'NOT_FOUND')
  assert.equal(
    mod.fcmErrorCode({ error: { code: 400, status: 'INVALID_ARGUMENT' } }),
    'INVALID_ARGUMENT'
  )
})

test('an unrecognizable body yields no code, and no code classifies as nothing', () => {
  for (const body of [null, {}, { error: null }, { error: { code: 500 } }] as FcmErrorBody[]) {
    const code = mod.fcmErrorCode(body)
    assert.equal(code, '')
    assert.equal(mod.isDeadRegistration(code), false, 'an unknown error must not kill a token')
    assert.equal(mod.isSenderPayloadError(code), false)
  }
})

// --- The two codes never share a consequence ---------------------------------

test('UNREGISTERED deactivates the token', () => {
  assert.equal(mod.isDeadRegistration(mod.fcmErrorCode(UNREGISTERED_BODY)), true)
})

test('INVALID_ARGUMENT never deactivates the token, not even when it blames the token', () => {
  for (const body of [INVALID_ARGUMENT_TOKEN_BODY, INVALID_ARGUMENT_PAYLOAD_BODY]) {
    const code = mod.fcmErrorCode(body)
    assert.equal(
      mod.isDeadRegistration(code),
      false,
      'INVALID_ARGUMENT indicts the request; the token may be alive'
    )
    assert.equal(mod.isSenderPayloadError(code), true)
  }
})

test('a transient FCM failure touches nothing', () => {
  for (const code of ['UNAVAILABLE', 'INTERNAL', 'QUOTA_EXCEEDED', 'THIRD_PARTY_AUTH_ERROR']) {
    assert.equal(mod.isDeadRegistration(code), false)
    assert.equal(mod.isSenderPayloadError(code), false)
  }
})

// --- A 404 only kills a token when FCM names the token -----------------------

test('a 404 without details[].errorCode is systemic, and deactivates nothing', () => {
  const code = mod.fcmErrorCode(SYSTEMIC_NOT_FOUND_BODY)

  assert.equal(code, 'NOT_FOUND', 'the status is still read, so the failure can be logged')
  assert.equal(
    mod.isDeadRegistration(code),
    false,
    'NOT_FOUND is a google.rpc status, not an FCM error code — the token was never accused'
  )
  assert.equal(mod.isUnclassifiedNotFound(code), true)
  assert.equal(mod.isSenderPayloadError(code), false)
})

test('UNREGISTERED is the only code that deactivates, whatever the status says', () => {
  // The eight codes of the FCM v1 table, plus the two generic statuses that ride
  // along on the wire. Only one of them may reach `is_active = false`.
  const deadly = [
    'UNSPECIFIED_ERROR',
    'INVALID_ARGUMENT',
    'UNREGISTERED',
    'SENDER_ID_MISMATCH',
    'QUOTA_EXCEEDED',
    'UNAVAILABLE',
    'INTERNAL',
    'THIRD_PARTY_AUTH_ERROR',
    'NOT_FOUND',
    'PERMISSION_DENIED',
  ].filter((code) => mod.isDeadRegistration(code))

  assert.deepEqual(deadly, ['UNREGISTERED'])
})

// --- The mass-failure brake ---------------------------------------------------

/**
 * Replay of the loop in `sendNotification`: walk the recipients, count what
 * INVALID_ARGUMENT does, and stop when the brake says so. Returns how far the
 * send got and how many tokens would have been deactivated.
 *
 * `sampled` mirrors what the function does with the audience before iterating;
 * the unsampled replay is kept so the tests can show what the ordering alone
 * used to buy an attacker.
 */
function replaySend(outcomes: string[], { sampled = false } = {}) {
  const order = sampled ? mod.sampledSendOrder(outcomes) : outcomes
  let attempted = 0
  let invalidArgumentCount = 0
  let deactivated = 0
  let aborted = false

  for (const code of order) {
    attempted++
    if (mod.isDeadRegistration(code)) {
      deactivated++
    } else if (mod.isSenderPayloadError(code)) {
      invalidArgumentCount++
      if (mod.shouldAbortForBadPayload(invalidArgumentCount, attempted)) {
        aborted = true
        break
      }
    }
  }

  return { attempted, invalidArgumentCount, deactivated, aborted, notAttempted: outcomes.length - attempted }
}

const SAMPLE = 50

test('the minimum sample is the number this suite was written against', () => {
  // Guards the replays below: moving the constant without moving the test would
  // otherwise silently change what "the threshold" means here.
  assert.equal(mod.ABORT_MIN_SAMPLE, SAMPLE)
})

test('a payload FCM rejects stops the send at the minimum sample, whatever the audience size', () => {
  const audience = 200_000
  const result = replaySend(Array(audience).fill('INVALID_ARGUMENT'))

  assert.equal(result.aborted, true, 'the loop kept hammering FCM with a request it already refused')
  assert.equal(result.attempted, SAMPLE, `expected the send to stop on token ${SAMPLE}`)
  assert.equal(result.notAttempted, audience - SAMPLE)
  assert.equal(result.deactivated, 0, 'a bad payload must not cost a single token')
})

test('a payload FCM rejects still aborts when the base carries dead tokens too', () => {
  // Why the brake reads "half", not "all": with the audience shuffled, the dead
  // registrations of a real base land inside the first sample. Demanding a clean
  // streak of INVALID_ARGUMENT would disarm the brake on exactly the run that
  // needs it.
  const outcomes = Array.from({ length: 5_000 }, (_, i) =>
    i % 5 === 0 ? 'UNREGISTERED' : 'INVALID_ARGUMENT'
  )

  const result = replaySend(outcomes)
  assert.equal(result.aborted, true, '20% dead tokens must not disarm the brake')
  assert.ok(result.attempted <= SAMPLE * 2, `aborted late: ${result.attempted} attempts`)
})

test('one rotten token does not derail a broadcast', () => {
  const outcomes = Array(5_000).fill('OK')
  outcomes[3] = 'INVALID_ARGUMENT'

  const result = replaySend(outcomes)
  assert.equal(result.aborted, false)
  assert.equal(result.attempted, 5_000)
  assert.equal(result.deactivated, 0)
})

test('the brake needs the rate too: junk spread over a large audience never aborts', () => {
  // 10x the sample in INVALID_ARGUMENT, but only 2% of the audience: the payload
  // is demonstrably fine, so the send must go through to everyone else.
  const outcomes = Array.from({ length: 25_000 }, (_, i) =>
    i % 50 === 0 ? 'INVALID_ARGUMENT' : 'OK'
  )

  const result = replaySend(outcomes)
  assert.equal(result.invalidArgumentCount, 500)
  assert.equal(result.aborted, false, 'the count alone must not be enough to abort')
  assert.equal(result.attempted, 25_000)
})

test('dead tokens are cleaned up while the send continues', () => {
  const outcomes = [...Array(50).fill('UNREGISTERED'), ...Array(50).fill('OK')]

  const result = replaySend(outcomes)
  assert.equal(result.aborted, false, 'UNREGISTERED is a token problem, never a payload problem')
  assert.equal(result.deactivated, 50)
  assert.equal(result.attempted, 100)
})

test('a systemic 404 costs nothing: the whole base fails and not one token is touched', () => {
  const code = mod.fcmErrorCode(SYSTEMIC_NOT_FOUND_BODY)
  const result = replaySend(Array(5_000).fill(code))

  assert.equal(result.deactivated, 0, 'a wrong project id would have emptied the base')
  assert.equal(result.aborted, false, 'and it is not a payload error either')
  assert.equal(result.attempted, 5_000)
})

test('the brake is a conjunction, exactly at the boundary', () => {
  assert.equal(mod.shouldAbortForBadPayload(SAMPLE - 1, SAMPLE - 1), false, 'sample too small')
  assert.equal(mod.shouldAbortForBadPayload(SAMPLE / 2, SAMPLE), true, 'exactly half still aborts')
  assert.equal(mod.shouldAbortForBadPayload(SAMPLE / 2 - 1, SAMPLE), false, 'below half does not')
  assert.equal(mod.shouldAbortForBadPayload(SAMPLE, SAMPLE), true)
  assert.equal(mod.shouldAbortForBadPayload(0, 10_000), false)
  assert.equal(mod.shouldAbortForBadPayload(10, 10), false, 'ten failures are not a rate')
})

// --- The brake is not a lever for whoever controls the ordering --------------

/**
 * The audience arrives sorted (`array_agg(DISTINCT tok)`), so junk that sorts
 * early is tried first. Measured 2026-08-23: `array_agg(distinct …)` over
 * `zzz-token, !!!aaa, 0abc, mmm, APA91b-…` returns
 * `["0abc","!!!aaa","APA91b-…","mmm","zzz-token"]`.
 */
function plantedAtTheHead(planted: number, audience: number) {
  return [...Array(planted).fill('INVALID_ARGUMENT'), ...Array(audience).fill('OK')]
}

test('ten planted junk tokens at the head of a broadcast no longer stop it', () => {
  // The regression this closes: with a floor of 10 and no rate context, ten rows
  // any signed-in user can INSERT into `drive.fcm_tokens` broke the send for the
  // entire base on its 10th call — and on /process-scheduled the item was then
  // marked `failed` with no retry.
  const result = replaySend(plantedAtTheHead(10, 5_000))

  assert.equal(result.aborted, false, 'ten planted rows must not be a kill switch')
  assert.equal(result.attempted, 5_010, 'the rest of the base was never tried')
  assert.equal(result.deactivated, 0)
})

test('a contiguous block of junk shorter than the minimum sample never aborts', () => {
  // Worst case by construction: every junk token first, the best an attacker
  // could do even without the shuffle. The brake is only consulted ON a failure,
  // and inside a block of junk `attempted` equals the failure count — so a head
  // block has to be ABORT_MIN_SAMPLE long to satisfy both halves at once.
  for (const planted of [10, 20, SAMPLE - 1]) {
    const result = replaySend(plantedAtTheHead(planted, 5_000))
    assert.equal(result.aborted, false, `${planted} planted tokens aborted the send`)
    assert.equal(result.attempted, planted + 5_000)
  }
})

test('the shuffle is what caps the attack, not the threshold', () => {
  // A fixed number of planted rows still buys the abort if the attacker also
  // picks the order — 50 of them, contiguous at the head. `sampledSendOrder`
  // takes the ordering away, and then the cost is no longer a fixed 50: the
  // planted rows have to hold half of a 50-attempt window drawn from the whole
  // audience, which means being about half of that audience.
  const outcomes = plantedAtTheHead(SAMPLE, 5_000)

  assert.equal(replaySend(outcomes).aborted, true, 'the ordered walk is the lever')

  for (let trial = 0; trial < 100; trial++) {
    // 50 junk tokens in 5,050: holding half of any 50-attempt window has odds
    // well below 1e-20, so a failure here means the shuffle stopped shuffling.
    assert.equal(
      replaySend(outcomes, { sampled: true }).aborted,
      false,
      'the sampled walk let 50 planted rows abort a 5,000-token broadcast'
    )
  }
})

test('a broken payload still aborts when the audience is shuffled', () => {
  const result = replaySend(Array(5_000).fill('INVALID_ARGUMENT'), { sampled: true })

  assert.equal(result.aborted, true)
  assert.equal(result.attempted, SAMPLE)
})

test('the shuffle delivers to everyone exactly once', () => {
  // A dropped or duplicated token here is a silent delivery bug, so the
  // permutation is pinned, not just the disorder.
  const audience = Array.from({ length: 2_000 }, (_, i) => `token-${i}`)
  const walked = mod.sampledSendOrder(audience)

  assert.equal(walked.length, audience.length)
  assert.deepEqual([...walked].sort(), [...audience].sort(), 'a recipient was lost or duplicated')
  assert.deepEqual(audience[0], 'token-0', 'the caller\'s array was mutated')
  assert.notDeepEqual(walked, audience, 'the audience was walked in the order the database gave it')
})

test('the shuffle is uniform enough that the head is not the head', () => {
  // The property the brake depends on: the first ABORT_MIN_SAMPLE attempts are a
  // sample of the audience, not of its lexicographic head.
  const audience = Array.from({ length: 1_000 }, (_, i) => i)
  let headSurvivors = 0

  for (let trial = 0; trial < 200; trial++) {
    const walked = mod.sampledSendOrder(audience)
    headSurvivors += walked.slice(0, SAMPLE).filter((i) => i < SAMPLE).length
  }

  // Expected 2.5 per SAMPLE-sized window (50 * 50 / 1000), so ~500 in 200
  // trials; the unshuffled walk would score the maximum, 50 * 200 = 10,000.
  assert.ok(
    headSurvivors < 1_000,
    `the sorted head kept landing in the sample: ${headSurvivors} hits in 200 trials`
  )
})

// --- Source ruler: the two codes must stay apart in the function --------------

/** The function's source with comment lines dropped — a ruler must not match prose. */
function functionCode() {
  return readFileSync(FUNCTION_PATH, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
}

test('the only token deactivation in the send loop is guarded by isDeadRegistration', () => {
  const source = readFileSync(FUNCTION_PATH, 'utf8')
  const lines = source.split('\n')

  const deactivations = lines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => /is_active:\s*false/.test(line))

  assert.equal(
    deactivations.length,
    1,
    `expected exactly 1 token deactivation, found ${deactivations.length} — a new one needs the same guard`
  )

  const { line, i } = deactivations[0]
  assert.match(line, /fcm_tokens/, 'the deactivation moved to another table')

  // The nearest enclosing condition above the statement.
  const guard = lines
    .slice(Math.max(0, i - 8), i)
    .reverse()
    .find((candidate) => /\bif\s*\(/.test(candidate))

  assert.ok(guard, 'the token deactivation is not guarded by any condition')
  assert.match(
    guard,
    /isDeadRegistration\(/,
    `the deactivation is guarded by something else: ${guard.trim()}`
  )
  assert.doesNotMatch(
    guard,
    /INVALID_ARGUMENT|isSenderPayloadError|NOT_FOUND/,
    `something other than UNREGISTERED is back on the path that deactivates tokens: ${guard.trim()}`
  )
})

test('the systemic 404 branch logs and writes nothing', () => {
  const lines = functionCode().split('\n')
  const start = lines.findIndex((line) => /isUnclassifiedNotFound\(/.test(line))

  assert.ok(start > 0, 'a 404 with no FCM errorCode is no longer told apart')

  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /\}\s*else|^\s*\}/.test(line))
  const branch = rest.slice(0, end === -1 ? 12 : end).join('\n')

  assert.match(branch, /console\.error/, 'a systemic 404 must be loud')
  assert.doesNotMatch(
    branch,
    /is_active|\.update\(|\.delete\(/,
    'the unclassified 404 branch writes to the token'
  )
})

test('the function never classifies an FCM error by scanning the prose message', () => {
  const code = functionCode()

  assert.doesNotMatch(
    code,
    /\.includes\(\s*['"](UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND)['"]\s*\)/,
    'the FCM code lives in error.details[].errorCode / error.status — a message scan matches neither'
  )
  assert.match(code, /fcmErrorCode\(/, 'the function stopped reading the FCM code from the right place')
})

test('the send loop walks the audience in sampled order, not the order SQL returned', () => {
  // `array_agg(DISTINCT tok)` sorts, so iterating `tokens` directly hands the
  // first attempts — the ones the brake judges — to whoever plants a token that
  // sorts early.
  const code = functionCode()

  assert.match(
    code,
    /for\s*\(const token of sampledSendOrder\(tokens\)\)/,
    'the send loop is back to iterating the audience in the order the database gave it'
  )
})

test('the send loop can stop itself when FCM keeps rejecting the payload', () => {
  const source = readFileSync(FUNCTION_PATH, 'utf8')

  assert.match(
    source,
    /isSenderPayloadError\(/,
    'INVALID_ARGUMENT is no longer handled as a sender error'
  )
  assert.match(
    source,
    /if\s*\(shouldAbortForBadPayload\([^)]*\)\)\s*\{[\s\S]{0,600}?\bbreak;/,
    'the abort check no longer breaks out of the send loop'
  )

  // The abort has to reach the caller, not just the log: the daily orchestrator
  // keys off `response.ok` to decide whether to mark users as notified.
  assert.match(source, /FCM_PAYLOAD_REJECTED/, 'the aborted send returns no typed error')
  assert.match(
    source,
    /status:\s*400,[\s\S]{0,200}?Content-Type/,
    'the aborted send no longer answers with a non-2xx'
  )
})

test('the loud INVALID_ARGUMENT log carries the requestId and only 8 chars of the token', () => {
  const source = readFileSync(FUNCTION_PATH, 'utf8')
  const logLine = source
    .split('\n')
    .find((line) => /INVALID_ARGUMENT/.test(line) && /console\.error|requestId/.test(line) && /token=/.test(line))

  assert.ok(logLine, 'the INVALID_ARGUMENT failure is not logged distinguishably')
  assert.match(logLine, /\$\{requestId\}/, 'the log cannot be tied back to the run')
  assert.match(logLine, /substring\(0,\s*8\)/, 'the log must carry 8 chars of the token, no more')
})
