/**
 * No Vercel Function may exceed the platform's 250 MB uncompressed limit.
 *
 * Incident of 2026-08-06 (#179): the production deploy was refused with
 * "The Vercel Function `api/migration/migrate-batch` is 2.88gb uncompressed".
 * `SRTMLocalService` builds `path.join(process.cwd(), 'data', 'srtm-cache')` and
 * hands it to `srtm-elevation`'s `TileSet`. @vercel/nft evaluates that expression
 * statically and emits the *whole directory* as an asset, so every route that can
 * reach the module carried the developer's 2.9 GB tile cache. Nine routes did.
 *
 * The only measure that counts is the module graph the build emits, not the
 * `import` list of the route file: the offending files were reached transitively
 * and were not JavaScript at all. This test reads the same `.nft.json` files the
 * Vercel builder consumes and sums the bytes on disk.
 *
 * Requires a build. Run with: npm run test:bundle
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SERVER_DIR = path.join(REPO_ROOT, '.next', 'server')

/** Vercel's hard limit for an uncompressed Function bundle. */
const LIMIT_BYTES = 250 * 1024 * 1024

/**
 * Below this, a route is measured but uninteresting. It exists so a resolution
 * bug that silently yields empty traces cannot turn this file green: a real
 * Next.js build always produces at least one route well past 1 MB.
 */
const SANITY_FLOOR_BYTES = 1024 * 1024

interface TracedRoute {
  /** Path of the entry the trace belongs to, relative to `.next/server`. */
  entry: string
  bytes: number
  fileCount: number
}

function findTraceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...findTraceFiles(full))
    else if (entry.name.endsWith('.nft.json')) found.push(full)
  }
  return found
}

/**
 * Sums the bytes of every file listed in one `.nft.json`. Paths inside the trace
 * are relative to the trace file itself, which is how the Vercel builder reads
 * them. Duplicates are counted once, symlinks by their own size — the same way a
 * bundle is assembled.
 */
function measureTrace(traceFile: string): TracedRoute {
  const trace = JSON.parse(fs.readFileSync(traceFile, 'utf8')) as { files: string[] }
  const base = path.dirname(traceFile)
  const seen = new Set<string>()
  let bytes = 0

  for (const relative of trace.files) {
    const absolute = path.resolve(base, relative)
    if (seen.has(absolute)) continue
    seen.add(absolute)
    let stats: fs.Stats
    try {
      stats = fs.lstatSync(absolute)
    } catch {
      continue // Listed but absent: the builder skips it too.
    }
    if (stats.isFile()) bytes += stats.size
  }

  return {
    entry: path.relative(SERVER_DIR, traceFile).replace(/\.nft\.json$/, ''),
    bytes,
    fileCount: seen.size,
  }
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Groups the traced bytes by npm package, or by top-level repo directory. */
function heaviestOrigins(traceFile: string, top: number): string[] {
  const trace = JSON.parse(fs.readFileSync(traceFile, 'utf8')) as { files: string[] }
  const base = path.dirname(traceFile)
  const byOrigin = new Map<string, number>()
  const seen = new Set<string>()

  for (const relative of trace.files) {
    const absolute = path.resolve(base, relative)
    if (seen.has(absolute)) continue
    seen.add(absolute)
    let stats: fs.Stats
    try {
      stats = fs.lstatSync(absolute)
    } catch {
      continue
    }
    if (!stats.isFile()) continue
    const inPackage = absolute.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
    const origin = inPackage
      ? `node_modules/${inPackage[1]}`
      : path.relative(REPO_ROOT, absolute).split(path.sep).slice(0, 2).join('/')
    byOrigin.set(origin, (byOrigin.get(origin) ?? 0) + stats.size)
  }

  return [...byOrigin.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([origin, bytes]) => `${megabytes(bytes).padStart(10)}  ${origin}`)
}

function measureAllRoutes(): TracedRoute[] {
  assert.ok(
    fs.existsSync(SERVER_DIR),
    `${path.relative(REPO_ROOT, SERVER_DIR)} not found. This test measures the module ` +
      'graph the build emits, so it needs one: run `npm run test:bundle`, which builds first.'
  )
  return findTraceFiles(SERVER_DIR)
    .map(measureTrace)
    .sort((a, b) => b.bytes - a.bytes)
}

test('no traced route bundle reaches the 250 MB Vercel Function limit', () => {
  const routes = measureAllRoutes()
  assert.ok(routes.length > 50, `expected the route traces to be found, got ${routes.length}`)

  const overLimit = routes.filter((route) => route.bytes > LIMIT_BYTES)
  const report = overLimit
    .map((route) => {
      const traceFile = path.join(SERVER_DIR, `${route.entry}.nft.json`)
      return (
        `${route.entry} — ${megabytes(route.bytes)} in ${route.fileCount} files\n` +
        heaviestOrigins(traceFile, 5)
          .map((line) => `        ${line}`)
          .join('\n')
      )
    })
    .join('\n      ')

  assert.equal(
    overLimit.length,
    0,
    'these Functions exceed the 250 MB uncompressed limit and will be refused at deploy.\n' +
      '      Exclude what they do not need at runtime with `outputFileTracingExcludes` in\n' +
      '      next.config.js. Do not raise the ceiling with the environment variable Vercel\n' +
      '      suggests in the refusal message: it trades the build error for a permanent\n' +
      `      cold-start cost, and tests/api/route-module-graph.test.ts forbids it.\n      ${report}`
  )
})

test('the measurement really reads bytes off disk (mutation check)', () => {
  // Guards the guard. If path resolution or the stat call breaks, measureTrace
  // returns 0 for everything and the limit test passes while measuring nothing.
  const routes = measureAllRoutes()
  assert.ok(
    routes[0].bytes > SANITY_FLOOR_BYTES,
    `the largest traced route measured only ${megabytes(routes[0].bytes)} — the measurement ` +
      'is broken, not the bundle. A Next.js build always traces more than that.'
  )

  // And a trace that is over the limit must be reported as over the limit.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tuggi-trace-'))
  try {
    const payload = path.join(scratch, 'payload.bin')
    fs.writeFileSync(payload, Buffer.alloc(3 * 1024 * 1024))
    const traceFile = path.join(scratch, 'route.js.nft.json')
    fs.writeFileSync(traceFile, JSON.stringify({ version: 1, files: ['payload.bin'] }))

    const measured = measureTrace(traceFile)
    assert.equal(measured.bytes, 3 * 1024 * 1024)
    assert.equal(measured.fileCount, 1)
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('data/ stays out of every route trace (#179 regression)', () => {
  // `data/` holds local caches written by scripts — 2.9 GB of SRTM tiles when the
  // deploy broke. Nothing reads them at runtime: the Lambda filesystem is read-only.
  // This asserts the effect of `outputFileTracingExcludes`, not its presence, so it
  // also catches a second cache directory arriving under a different name.
  const offenders: string[] = []
  for (const traceFile of findTraceFiles(SERVER_DIR)) {
    const trace = JSON.parse(fs.readFileSync(traceFile, 'utf8')) as { files: string[] }
    const base = path.dirname(traceFile)
    const fromData = trace.files
      .map((relative) => path.resolve(base, relative))
      .filter((absolute) => absolute.startsWith(path.join(REPO_ROOT, 'data') + path.sep))
    if (fromData.length > 0) {
      offenders.push(
        `${path.relative(SERVER_DIR, traceFile)} traces ${fromData.length} file(s) from data/, ` +
          `e.g. ${path.relative(REPO_ROOT, fromData[0])}`
      )
    }
  }

  assert.deepEqual(offenders, [], `data/ must not be traced into a Function:\n  ${offenders.join('\n  ')}`)
})
