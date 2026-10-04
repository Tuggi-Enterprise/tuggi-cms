/**
 * #779 — the queue worker of `scripts/regen-trigger-points.ts` honours `--stored-boundary`.
 *
 * `runBatch` runs each POI in a child process (`runInChild`), so the flag has to cross the
 * `fork` and reach `PoiMigrationPipeline.executePipeline` as `stored_boundary_reference` —
 * the same field `--id` uses (`regenPipelineOptions`).
 *
 * Mutations that turn this suite red:
 *  · `queueChildArgs` dropping the flag — the São Paulo queue would run on the detection;
 *  · the child building its own options instead of `regenPipelineOptions`;
 *  · the flag present by default.
 *
 * Run with: npm run test:api
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  QUEUE_CHILD_FLAG, parseQueueChildArgs, queueChildArgs, regenPipelineOptions, storedBoundaryLogSuffix,
} from '../../lib/services/tp-regen-options'

const ID = '00000000-0000-0000-0000-000000000779'

/** What the queue child hands to the pipeline, from the argv the worker forks it with. */
const pipelineOptionsInChild = (storedBoundary: boolean) => {
  const child = parseQueueChildArgs(queueChildArgs(ID, storedBoundary))
  assert.equal(child.attractionId, ID)
  return regenPipelineOptions(child.storedBoundary)
}

test('#779 worker with --stored-boundary: each queued POI reaches the pipeline with stored_boundary_reference true', () => {
  assert.deepEqual(pipelineOptionsInChild(true), { mode: 'reprocess_triggers_core', stored_boundary_reference: true })
  assert.equal(storedBoundaryLogSuffix(true), ' (borda gravada como referência)')
})

test('#779 worker without --stored-boundary: the pipeline gets stored_boundary_reference false', () => {
  assert.deepEqual(queueChildArgs(ID, false), [QUEUE_CHILD_FLAG, ID])
  assert.deepEqual(pipelineOptionsInChild(false), { mode: 'reprocess_triggers_core', stored_boundary_reference: false })
  assert.equal(storedBoundaryLogSuffix(false), '')
})
