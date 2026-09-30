import { fork } from 'child_process'

/**
 * Runs `modulePath args…` in a child process and kills it at the deadline (#779).
 *
 * A process, not `Promise.race`: the TP engine can hold the event loop synchronously for
 * hours (measured: 0 timer ticks in 300 s on Pico Alto do Boqueirão), and a timer in the same
 * process never fires. SIGKILL ends the child whatever it is doing, and the OS returns its
 * memory — the queue worker does not grow across POIs.
 *
 * The child reports a failure with `process.send({ error })` and a non-zero exit
 * (`reportChildFailure`); `fork` reuses `process.execArgv`, so a parent under `tsx` starts a
 * child under `tsx`.
 */
export type ChildOutcome = { ok: true } | { ok: false; error: string; timedOut: boolean }

export function runInChild(modulePath: string, args: string[], timeoutMs: number): Promise<ChildOutcome> {
  return new Promise(resolve => {
    const child = fork(modulePath, args, { stdio: 'inherit' })
    let reported: string | null = null
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs)
    child.on('message', (m: unknown) => {
      if (m && typeof m === 'object' && 'error' in m) reported = String((m as { error: unknown }).error)
    })
    child.on('error', e => { reported ??= e.message })
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      if (timedOut) return resolve({ ok: false, timedOut: true, error: `timeout after ${Math.round(timeoutMs / 1000)} s` })
      if (code === 0) return resolve({ ok: true })
      resolve({ ok: false, timedOut: false, error: reported ?? `child exited with ${signal ?? `code ${code}`}` })
    })
  })
}

/** Child side: sends the error to the parent, then exits non-zero once the message is out. */
export function reportChildFailure(error: string): void {
  if (!process.send) { console.error(error); process.exit(1) }
  process.send({ error }, () => process.exit(1))
}
