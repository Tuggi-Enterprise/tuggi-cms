/**
 * #958: merging duplicate POIs moves the tourists' saves to the survivor BEFORE the losers are
 * deleted (the FK of drive.saved_items cascades and would drop them in silence).
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { repointSavedItemsBeforeDelete } from '@/lib/pois/repoint-saved-items'

function db(answer: { data: unknown; error: { code?: string; message?: string } | null }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
  return {
    calls,
    rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return answer },
  }
}

test('#958: the saves of the losers are repointed to the survivor', async () => {
  const client = db({ data: 3, error: null })
  const out = await repointSavedItemsBeforeDelete(client, ['l1', 'l2'], 's')
  assert.deepEqual(out, { moved: 3 })
  assert.deepEqual(client.calls, [{ fn: 'repoint_saved_items', args: { p_loser_ids: ['l1', 'l2'], p_survivor_id: 's' } }])
})

test('#958: before the migration the function is absent and the merge goes on', async () => {
  const out = await repointSavedItemsBeforeDelete(db({ data: null, error: { code: 'PGRST202' } }), ['l1'], 's')
  assert.deepEqual(out, { skipped: 'function_absent' })
})

test('#958: any other refusal stops the merge before the delete', async () => {
  await assert.rejects(repointSavedItemsBeforeDelete(db({ data: null, error: { code: '22023' } }), ['l1'], 's'), /NOT deleted/)
})

test('#958: the script calls the repoint before dedup_delete_pois', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../../scripts/merge-duplicate-pois.ts'), 'utf8')
  const repoint = source.indexOf('repointSavedItemsBeforeDelete(db')
  const del = source.indexOf("db.rpc('dedup_delete_pois'")
  assert.ok(repoint > 0 && del > repoint, 'repoint must run first')
})
