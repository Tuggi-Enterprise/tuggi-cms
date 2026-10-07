/**
 * #779 — `--create-batch <id> --ids-file <path>` queues exactly the POIs a simulation found
 * (BR-POI-010 regeneration of Minas Gerais), not the whole state.
 *
 * Mutations that turn this suite red:
 *  · a malformed line skipped instead of refused — the queue would shrink in silence;
 *  · repeats kept — the upsert would collapse them, but the count reported would lie;
 *  · comments or blank lines read as ids.
 *
 * Run with: npm run test:api
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseIdsFile } from '../../lib/services/tp-regen-options'

const A = 'f3e90995-9ebd-5c30-9f1d-7f5b7e3786fa'
const B = '9aab0a3f-d54f-4845-8726-2353bc808b56'

test('#779 BR-POI-010 --ids-file: one id per line, blanks and # comments skipped, repeats collapsed', () => {
  assert.deepEqual(parseIdsFile(`# MG, regra 5\n${A}\n\n  ${B}  \r\n${A.toUpperCase()}\n`), [A, B])
})

test('#779 BR-POI-010 --ids-file: a line that is not a POI id is refused with its line number', () => {
  assert.throws(() => parseIdsFile(`${A}\n${B.slice(0, -1)}\n`), /linha 2/)
  assert.throws(() => parseIdsFile(`${A},${B}\n`), /linha 1/)
})

test('#779 --ids-file: an empty file yields no ids (the script refuses an empty queue)', () => {
  assert.deepEqual(parseIdsFile('\n# nada\n'), [])
})
