/**
 * No route handler may reach jsdom through a static import.
 *
 * Incident of 2026-08-05: `app/api/admin/clients/route.ts` started importing
 * `@/lib/services/client-editable-fields` → `@/lib/input-validation` →
 * `isomorphic-dompurify`, which loads jsdom on the server. In production the
 * route module failed to evaluate and every request answered 500 with an HTML
 * body — including the unauthenticated one, which never reached the handler's
 * own 401. `next dev`, `next build && next start` and the unit tests were all
 * green: the failure lives in the traced serverless bundle, so only the import
 * graph gives an early signal.
 *
 * This test walks the static import graph of every app/api route and fails with
 * the offending chain. Dynamic `await import()` inside a handler is deliberately
 * not followed: that is the supported escape hatch.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '..', '..')

/** Bare modules that pull a DOM implementation into the server bundle. */
const FORBIDDEN_MODULES = ['isomorphic-dompurify', 'jsdom']

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs']

function listRouteFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...listRouteFiles(full))
    else if (entry.name === 'route.ts' || entry.name === 'route.tsx') found.push(full)
  }
  return found
}

/**
 * Static `import ... from 'x'` / `export ... from 'x'` specifiers.
 * `import('x')` is intentionally excluded — it is evaluated on call, not on
 * module load, which is exactly the property this test protects.
 */
function readStaticImports(file: string): string[] {
  const source = fs.readFileSync(file, 'utf8')
  const specifiers: string[] = []
  const pattern = /(?:^|\n)\s*(?:import|export)\s[^;\n]*?from\s*['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) specifiers.push(match[1])

  const sideEffect = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g
  while ((match = sideEffect.exec(source)) !== null) specifiers.push(match[1])

  return specifiers
}

/** Resolves only local specifiers; bare modules are returned as-is. */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = path.join(REPO_ROOT, specifier.slice(2))
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(fromFile), specifier)
  else return null

  for (const ext of EXTENSIONS) {
    if (fs.existsSync(base + ext)) return base + ext
  }
  for (const ext of EXTENSIONS) {
    const indexFile = path.join(base, 'index' + ext)
    if (fs.existsSync(indexFile)) return indexFile
  }
  return null
}

/** Returns the import chain from `entry` to a forbidden module, or null. */
function findForbiddenChain(entry: string, cache: Map<string, string[] | null>): string[] | null {
  const visiting = new Set<string>()

  function walk(file: string): string[] | null {
    if (cache.has(file)) {
      const cached = cache.get(file)!
      return cached ? [file, ...cached.slice(1)] : null
    }
    if (visiting.has(file)) return null
    visiting.add(file)

    let result: string[] | null = null
    for (const specifier of readStaticImports(file)) {
      if (FORBIDDEN_MODULES.includes(specifier)) {
        result = [file, specifier]
        break
      }
      const resolved = resolveSpecifier(specifier, file)
      if (!resolved) continue
      const deeper = walk(resolved)
      if (deeper) {
        result = [file, ...deeper]
        break
      }
    }

    visiting.delete(file)
    cache.set(file, result)
    return result
  }

  return walk(entry)
}

function relative(file: string): string {
  return file.startsWith(REPO_ROOT) ? path.relative(REPO_ROOT, file) : file
}

test('no app/api route reaches jsdom through a static import', () => {
  const routes = listRouteFiles(path.join(REPO_ROOT, 'app', 'api'))
  assert.ok(routes.length > 50, `expected the api routes to be found, got ${routes.length}`)

  const cache = new Map<string, string[] | null>()
  const offenders = routes
    .map((route) => ({ route, chain: findForbiddenChain(route, cache) }))
    .filter((entry) => entry.chain !== null)
    .map(({ chain }) => chain!.map(relative).join('\n      → '))

  assert.deepEqual(
    offenders,
    [],
    `route modules must not load jsdom at evaluation time:\n  ${offenders.join('\n  ')}`
  )
})

test('the crawler still detects a forbidden chain (mutation check)', () => {
  // Guards the guard: lib/html-sanitization.ts is the module that does import
  // isomorphic-dompurify, so the crawler must flag it when used as an entry.
  const chain = findForbiddenChain(
    path.join(REPO_ROOT, 'lib', 'html-sanitization.ts'),
    new Map<string, string[] | null>()
  )
  assert.ok(chain, 'crawler failed to detect the known isomorphic-dompurify import')
  assert.equal(chain![chain!.length - 1], 'isomorphic-dompurify')
})

test('lib/input-validation.ts stays free of jsdom for every future importer', () => {
  const chain = findForbiddenChain(
    path.join(REPO_ROOT, 'lib', 'input-validation.ts'),
    new Map<string, string[] | null>()
  )
  assert.equal(
    chain,
    null,
    `lib/input-validation.ts must stay DOM-free: ${chain?.map(relative).join(' → ')}`
  )
})
