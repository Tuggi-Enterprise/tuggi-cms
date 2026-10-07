import { fork, type ChildProcess } from 'child_process'

/**
 * Runs requests in a child process that is kept alive between them, and kills it at the
 * deadline of each request (#779).
 *
 * A process, not `Promise.race`: the TP engine can hold the event loop synchronously for
 * hours (measured: 0 timer ticks in 300 s on Pico Alto do Boqueirão), and a timer in the same
 * process never fires. SIGKILL ends the child whatever it is doing, and the OS returns its
 * memory; the next request starts a new child.
 *
 * Reused, not forked per request: a POI of the queue spends ~1 s on its TPs and ~8 s on what
 * every fresh process repeats — loading the modules under tsx, opening the local OSM region,
 * loading the relief. The child keeps that state, and is replaced every `maxRequests` so a
 * cache nobody bounded cannot grow without limit.
 *
 * Protocol: the parent sends `{ request }`; the child (`serveParentRequests`) answers
 * `{ done: true, error? }` and waits for the next one. `fork` reuses `process.execArgv`, so a
 * parent under `tsx` starts a child under `tsx`.
 */
export type ChildOutcome = { ok: true } | { ok: false; error: string; timedOut: boolean }

type Pending = { resolve: (o: ChildOutcome) => void; timer: NodeJS.Timeout; timeoutMs: number; timedOut: boolean }

export class ReusableChild {
  private child: ChildProcess | null = null
  private served = 0
  private pending: Pending | null = null
  /** Children started so far — the test reads it to tell a reused child from a new one. */
  started = 0

  constructor(private readonly modulePath: string, private readonly args: string[], private readonly maxRequests: number) {}

  run(request: unknown, timeoutMs: number): Promise<ChildOutcome> {
    if (this.pending) throw new Error('ReusableChild runs one request at a time')
    if (this.child && this.served >= this.maxRequests) this.stop()
    const child = this.child ?? this.start()
    this.served++
    return new Promise(resolve => {
      const pending: Pending = {
        resolve, timeoutMs, timedOut: false,
        timer: setTimeout(() => { pending.timedOut = true; child.kill('SIGKILL') }, timeoutMs),
      }
      this.pending = pending
      child.send({ request })
    })
  }

  /** Ends the child; the parent can exit once it is gone (the IPC channel keeps it alive). */
  close(): void {
    this.stop()
  }

  private start(): ChildProcess {
    const child = fork(this.modulePath, this.args, { stdio: 'inherit' })
    this.child = child
    this.served = 0
    this.started++
    let reported: string | null = null
    child.on('message', (m: unknown) => {
      if (this.child !== child || !m || typeof m !== 'object' || !('done' in m)) return
      const error = (m as { error?: unknown }).error
      this.settle(error === undefined ? { ok: true } : { ok: false, timedOut: false, error: String(error) })
    })
    child.on('error', e => { reported ??= e.message })
    child.on('exit', (code, signal) => {
      if (this.child !== child) return // a child already replaced (`stop`) answers for nothing
      this.child = null
      const p = this.pending
      if (!p) return
      if (p.timedOut) return this.settle({ ok: false, timedOut: true, error: `timeout after ${Math.round(p.timeoutMs / 1000)} s` })
      this.settle({ ok: false, timedOut: false, error: reported ?? `child exited with ${signal ?? `code ${code}`}` })
    })
    return child
  }

  private settle(outcome: ChildOutcome): void {
    const p = this.pending
    if (!p) return
    this.pending = null
    clearTimeout(p.timer)
    p.resolve(outcome)
  }

  private stop(): void {
    const child = this.child
    this.child = null
    child?.kill('SIGKILL')
  }
}

/**
 * Child side: answers each request of the parent in turn. A request that throws or returns an
 * error is answered with it, and the child goes on to the next one.
 */
export function serveParentRequests(handle: (request: unknown) => Promise<string | null>): void {
  if (!process.send) throw new Error('serveParentRequests needs a parent (fork)')
  process.on('disconnect', () => process.exit(0))
  process.on('message', async (m: unknown) => {
    if (!m || typeof m !== 'object' || !('request' in m)) return
    let error: string | null
    try {
      error = await handle((m as { request: unknown }).request)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
    process.send!(error === null ? { done: true } : { done: true, error })
  })
}
