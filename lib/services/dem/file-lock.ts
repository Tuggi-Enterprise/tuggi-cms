/**
 * Locks between workers (processes on this machine) of the EP: one cell being prepared (#831),
 * one source file being downloaded. A lock is a file created with O_EXCL; one whose process died
 * (the queue kills a POI child at its deadline) is taken over.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

export const LOCK_POLL_MS = 2_000

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function tryLock(file: string): boolean {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, host: os.hostname(), at: new Date().toISOString() }), { flag: 'wx' })
      return true
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      let holder: { pid?: number; host?: string } = {}
      try {
        holder = JSON.parse(fs.readFileSync(file, 'utf8'))
      } catch {
        // half-written by a process that died: stale once it is not fresh
        if (Date.now() - fs.statSync(file).mtimeMs < 60_000) return false
      }
      const stale = !holder.pid || (holder.host === os.hostname() && !processAlive(holder.pid))
      if (!stale) return false
      fs.rmSync(file, { force: true })
    }
  }
  return false
}

/** Runs `fn` holding the lock, waiting for it while another worker (or call) has it. */
export async function withFileLock<T>(file: string, fn: () => Promise<T>, pollMs = LOCK_POLL_MS): Promise<T> {
  while (!tryLock(file)) await new Promise(r => setTimeout(r, pollMs))
  try {
    return await fn()
  } finally {
    fs.rmSync(file, { force: true })
  }
}
