/**
 * The direct push banner says why nothing left (BR-COMUNICACAO-019).
 *
 * Incident of 2026-11-24: a direct push to a person with an active token showed "no active
 * device". The gate had refused it, so `result` read 0 and 0 like a person without a device. The
 * reason travels in `gate`, the per-person tally of `/send`; `directPushNotSent` reads it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createTranslator } from 'next-intl'
import { directPushNotSent } from '../../lib/notifications/direct-push-outcome'

const root = resolve(import.meta.dirname, '../..')
const LOCALES = ['pt', 'en', 'es'] as const
const messages = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(resolve(root, `messages/${l}.json`), 'utf8'))]),
)
const tFor = (l: (typeof LOCALES)[number]) =>
  createTranslator({ locale: l, messages: messages[l], namespace: 'Pages.Notifications' })

const zero = { success: 0, failure: 0 }
const gateOf = (g: Record<string, number>) => ({
  sent: 0, not_delivered: 0, denied: 0, inactive: 0, gate_missing: 0, gate_error: 0, failed: 0, ...g,
})

test('BR-COMUNICACAO-019: a push that reached a device shows no refusal', () => {
  assert.equal(directPushNotSent({ success: 1, failure: 0 }, gateOf({ sent: 1 })), null)
  assert.equal(directPushNotSent({ success: 2, failure: 1 }, gateOf({ sent: 2, not_delivered: 1 })), null)
})

test('BR-COMUNICACAO-019: notifications off (denied or inactive) is not "no active device"', () => {
  assert.equal(directPushNotSent(zero, gateOf({ denied: 1 }))?.key, 'not_sent_off')
  assert.equal(directPushNotSent(zero, gateOf({ inactive: 1 }))?.key, 'not_sent_off')
  const two = directPushNotSent(zero, gateOf({ denied: 1, inactive: 1 }))
  assert.equal(two?.key, 'not_sent_off')
  assert.equal(two?.values.count, 2)
})

test('no device, or every token refused by the provider, keeps no_tokens', () => {
  assert.equal(directPushNotSent(zero, gateOf({ not_delivered: 1 }))?.key, 'no_tokens')
  assert.equal(directPushNotSent({ success: 0, failure: 3 }, gateOf({ not_delivered: 1 }))?.key, 'no_tokens')
})

test('a gate that could not answer and a failed send each say so', () => {
  assert.equal(directPushNotSent(zero, gateOf({ gate_missing: 1 }))?.key, 'not_sent_unknown')
  assert.equal(directPushNotSent(zero, gateOf({ gate_error: 1 }))?.key, 'not_sent_unknown')
  assert.equal(directPushNotSent(zero, gateOf({ failed: 1 }))?.key, 'not_sent_failed')
})

test('mixed reasons across several people give one line with the counts', () => {
  const r = directPushNotSent(zero, gateOf({ denied: 2, not_delivered: 1 }))
  assert.equal(r?.key, 'not_sent_mixed')
  assert.deepEqual(r?.values, { count: 3, off: 2, noDevice: 1, unknown: 0, failed: 0 })
})

test('no gate in the answer, or an empty one, keeps no_tokens', () => {
  assert.equal(directPushNotSent(zero, undefined)?.key, 'no_tokens')
  assert.equal(directPushNotSent(zero, null)?.key, 'no_tokens')
  assert.equal(directPushNotSent(undefined, undefined)?.key, 'no_tokens')
  assert.equal(directPushNotSent(zero, gateOf({}))?.key, 'no_tokens')
  // A malformed count is not a reason.
  assert.equal(directPushNotSent(zero, { denied: Number.NaN })?.key, 'no_tokens')
})

for (const l of LOCALES) {
  test(`${l}: every key renders, in singular, plural and mixed form`, () => {
    const t = tFor(l)
    const cases = [
      directPushNotSent(zero, gateOf({ denied: 1 })),
      directPushNotSent(zero, gateOf({ denied: 3 })),
      directPushNotSent(zero, gateOf({ gate_error: 1 })),
      directPushNotSent(zero, gateOf({ gate_missing: 2 })),
      directPushNotSent(zero, gateOf({ failed: 1 })),
      directPushNotSent(zero, gateOf({ not_delivered: 1 })),
      directPushNotSent(zero, gateOf({ denied: 1, not_delivered: 2, gate_error: 1, failed: 1 })),
    ]
    for (const c of cases) {
      assert.ok(c)
      const text = t(`messages.${c.key}`, c.values)
      assert.ok(!text.includes('{') && !text.includes('messages.'), `${l} ${c.key}: ${text}`)
      assert.ok(!text.includes('—'), `${l} ${c.key} has an em dash`)
    }
  })
}

test('pt: the mixed line names only the reasons that happened', () => {
  const t = tFor('pt')
  const c = directPushNotSent(zero, gateOf({ denied: 2, not_delivered: 1 }))!
  const text = t(`messages.${c.key}`, c.values)
  assert.equal(text.trim(), 'O push não saiu para ninguém. 2 com notificações desligadas. 1 sem aparelho ativo.')
})
