import type { PipelineOptions } from './poi-migration-pipeline'

/**
 * The one path from the `--stored-boundary` command-line flag to the pipeline option
 * `stored_boundary_reference` (#779), shared by `--id`, `--dry-run` and the queue worker of
 * `scripts/regen-trigger-points.ts`. The worker runs the POIs in a child process
 * (`ReusableChild`), so the flag has to cross the `fork` as an argument: `queueChildArgs` writes
 * it, `parseQueueChildArgs` reads it back. The POI id reaches the child with each request.
 */
export const STORED_BOUNDARY_FLAG = '--stored-boundary'
export const QUEUE_CHILD_FLAG = '--pipeline-child'

export function regenPipelineOptions(storedBoundary: boolean): PipelineOptions {
  return { mode: 'reprocess_triggers_core', stored_boundary_reference: storedBoundary }
}

export function storedBoundaryLogSuffix(storedBoundary: boolean): string {
  return storedBoundary ? ' (borda gravada como referência)' : ''
}

export function queueChildArgs(storedBoundary: boolean): string[] {
  return [QUEUE_CHILD_FLAG, ...(storedBoundary ? [STORED_BOUNDARY_FLAG] : [])]
}

export function parseQueueChildArgs(args: string[]): { storedBoundary: boolean } {
  return { storedBoundary: args.includes(STORED_BOUNDARY_FLAG) }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `--create-batch <id> --ids-file <path>` (#779): the queue takes exactly the POIs listed, one
 * id per line — for a regeneration targeted at the POIs a simulation found, not a whole state.
 * Blank lines and `#` comments are skipped, repeats collapse, and any other line throws: a
 * typo must not shrink the queue in silence.
 */
export function parseIdsFile(text: string): string[] {
  const ids = new Set<string>()
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    if (!UUID_RE.test(line)) throw new Error(`--ids-file: linha ${i + 1} não é um id de POI: "${line}"`)
    ids.add(line.toLowerCase())
  })
  return [...ids]
}
