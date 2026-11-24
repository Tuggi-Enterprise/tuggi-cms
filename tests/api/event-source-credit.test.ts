/**
 * The credit of the source in the event form (#1082): it comes from `source_credit` of get_event_details and is
 * shown only when the RPC sends a real one.
 *
 * Mutations that turn this suite red:
 *  · reading the credit off the description again (a manual event would show nothing, an imported one twice);
 *  · showing a blank credit as an empty label;
 *  · throwing when the RPC does not send the field yet (the form would break before the migration is applied).
 *
 * Run with: npm run test:api
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { sourceCreditOf } from '@/lib/core/event-service'

const CREDIT = 'Informações: Cidade de São Paulo (cidadedesaopaulo.com)'

test('#1082 BR-EVENTO-009 item 3: an imported event shows the credit line of its source', () => {
  assert.equal(sourceCreditOf({ name: 'Fórmula 1', source_credit: CREDIT }), CREDIT)
  assert.equal(sourceCreditOf({ source_credit: `  ${CREDIT}\n` }), CREDIT)
})

test('#1082 BR-EVENTO-009 item 6: a manual or linked event (null credit) shows nothing', () => {
  assert.equal(sourceCreditOf({ name: 'Show manual', source_credit: null }), null)
  assert.equal(sourceCreditOf({ source_credit: '   ' }), null)
})

test('#1082: before the RPC sends the field, the form reads no credit and does not break', () => {
  assert.equal(sourceCreditOf({ name: 'Evento', description: `Texto.\n\n${CREDIT}` }), null)
  assert.equal(sourceCreditOf(null), null)
  assert.equal(sourceCreditOf(undefined), null)
  assert.equal(sourceCreditOf({ source_credit: 42 }), null)
})
