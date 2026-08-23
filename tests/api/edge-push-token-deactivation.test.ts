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
 * REQUEST is malformed, and Firebase says so in writing: it "signals an invalid
 * registration only if the payload is completely valid"
 * (https://firebase.google.com/docs/cloud-messaging/manage-tokens). Because the
 * payload is shared by every iteration, one bad payload would deactivate the
 * entire base in a single run, and a user only comes back when they reopen the
 * app and `FCMTokenService` re-registers. Two payload changes were about to
 * ship (`data.type` and the rewritten daily copy), which is what made this
 * urgent rather than theoretical.
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
 *     into one `if`.
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
  isSenderPayloadError: (code: string) => boolean
  shouldAbortForBadPayload: (invalidArgumentCount: number, attempted: number) => boolean
  INVALID_ARGUMENT_ABORT_FLOOR: number
}

let mod: Mod

before(async () => {
  mod = (await import(pathToFileURL(MODULE_PATH).href)) as Mod
  for (const name of [
    'fcmErrorCode',
    'isDeadRegistration',
    'isSenderPayloadError',
    'shouldAbortForBadPayload',
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
  assert.equal(mod.isDeadRegistration('NOT_FOUND'), true)
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

// --- The mass-failure brake ---------------------------------------------------

/**
 * Replay of the loop in `sendNotification`: walk the recipients, count what
 * INVALID_ARGUMENT does, and stop when the brake says so. Returns how far the
 * send got and how many tokens would have been deactivated.
 */
function replaySend(outcomes: string[]) {
  let attempted = 0
  let invalidArgumentCount = 0
  let deactivated = 0
  let aborted = false

  for (const code of outcomes) {
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

const FLOOR = 10

test('the abort floor is the number this suite was written against', () => {
  // Guards the replays below: moving the constant without moving the test would
  // otherwise silently change what "the threshold" means here.
  assert.equal(mod.INVALID_ARGUMENT_ABORT_FLOOR, FLOOR)
})

test('a payload FCM rejects stops the send at the floor, whatever the audience size', () => {
  const audience = 200_000
  const result = replaySend(Array(audience).fill('INVALID_ARGUMENT'))

  assert.equal(result.aborted, true, 'the loop kept hammering FCM with a request it already refused')
  assert.equal(result.attempted, FLOOR, `expected the send to stop on token ${FLOOR}`)
  assert.equal(result.notAttempted, audience - FLOOR)
  assert.equal(result.deactivated, 0, 'a bad payload must not cost a single token')
})

test('one rotten token does not derail a broadcast', () => {
  const outcomes = Array(5_000).fill('OK')
  outcomes[3] = 'INVALID_ARGUMENT'

  const result = replaySend(outcomes)
  assert.equal(result.aborted, false)
  assert.equal(result.attempted, 5_000)
  assert.equal(result.deactivated, 0)
})

test('a cluster of junk tokens below the floor does not derail a broadcast', () => {
  // `drive.profiles.push_token` is appended as a contiguous block to the end of
  // the recipient list and is never cleaned, so junk arrives clustered, not
  // spread out. FLOOR - 1 of them in a row must still let the send finish.
  const outcomes = [
    ...Array(500).fill('OK'),
    ...Array(FLOOR - 1).fill('INVALID_ARGUMENT'),
    ...Array(500).fill('OK'),
  ]

  const result = replaySend(outcomes)
  assert.equal(result.aborted, false)
  assert.equal(result.attempted, outcomes.length)
})

test('the brake needs the rate too: junk spread over a large audience never aborts', () => {
  // 10x the floor in INVALID_ARGUMENT, but only 2% of the audience: the payload
  // is demonstrably fine, so the send must go through to everyone else.
  const outcomes = Array.from({ length: 5_000 }, (_, i) =>
    i % 50 === 0 ? 'INVALID_ARGUMENT' : 'OK'
  )

  const result = replaySend(outcomes)
  assert.equal(result.invalidArgumentCount, 100)
  assert.equal(result.aborted, false, 'the count alone must not be enough to abort')
  assert.equal(result.attempted, 5_000)
})

test('dead tokens are cleaned up while the send continues', () => {
  const outcomes = [...Array(50).fill('UNREGISTERED'), ...Array(50).fill('OK')]

  const result = replaySend(outcomes)
  assert.equal(result.aborted, false, 'UNREGISTERED is a token problem, never a payload problem')
  assert.equal(result.deactivated, 50)
  assert.equal(result.attempted, 100)
})

test('the brake is a conjunction, exactly at the boundary', () => {
  assert.equal(mod.shouldAbortForBadPayload(FLOOR - 1, FLOOR - 1), false, 'floor not reached')
  assert.equal(mod.shouldAbortForBadPayload(FLOOR, FLOOR), true)
  assert.equal(mod.shouldAbortForBadPayload(FLOOR, FLOOR * 2), true, 'exactly half still aborts')
  assert.equal(mod.shouldAbortForBadPayload(FLOOR, FLOOR * 2 + 1), false, 'below half does not')
  assert.equal(mod.shouldAbortForBadPayload(0, 10_000), false)
})

// --- Source ruler: the two codes must stay apart in the function --------------

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
    /INVALID_ARGUMENT|isSenderPayloadError/,
    `INVALID_ARGUMENT is back on the path that deactivates tokens: ${guard.trim()}`
  )
})

test('the function never classifies an FCM error by scanning the prose message', () => {
  const source = readFileSync(FUNCTION_PATH, 'utf8')
  const code = source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')

  assert.doesNotMatch(
    code,
    /\.includes\(\s*['"](UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND)['"]\s*\)/,
    'the FCM code lives in error.details[].errorCode / error.status — a message scan matches neither'
  )
  assert.match(code, /fcmErrorCode\(/, 'the function stopped reading the FCM code from the right place')
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
