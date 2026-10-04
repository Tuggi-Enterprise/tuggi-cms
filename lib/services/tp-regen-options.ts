import type { PipelineOptions } from './poi-migration-pipeline'

/**
 * The one path from the `--stored-boundary` command-line flag to the pipeline option
 * `stored_boundary_reference` (#779), shared by `--id`, `--dry-run` and the queue worker of
 * `scripts/regen-trigger-points.ts`. The worker runs each POI in a child process
 * (`runInChild`), so the flag has to cross the `fork` as an argument: `queueChildArgs` writes
 * it, `parseQueueChildArgs` reads it back.
 */
export const STORED_BOUNDARY_FLAG = '--stored-boundary'
export const QUEUE_CHILD_FLAG = '--pipeline-child'

export function regenPipelineOptions(storedBoundary: boolean): PipelineOptions {
  return { mode: 'reprocess_triggers_core', stored_boundary_reference: storedBoundary }
}

export function storedBoundaryLogSuffix(storedBoundary: boolean): string {
  return storedBoundary ? ' (borda gravada como referência)' : ''
}

export function queueChildArgs(attractionId: string, storedBoundary: boolean): string[] {
  return [QUEUE_CHILD_FLAG, attractionId, ...(storedBoundary ? [STORED_BOUNDARY_FLAG] : [])]
}

export function parseQueueChildArgs(args: string[]): { attractionId: string; storedBoundary: boolean } {
  return { attractionId: args[1], storedBoundary: args.includes(STORED_BOUNDARY_FLAG) }
}
