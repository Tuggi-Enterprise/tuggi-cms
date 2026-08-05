/**
 * CARD-CMS-01 — every API route must declare its policy.
 *
 * Enumerates `app/api/**​/route.ts` and, for each exported HTTP method
 * (GET|POST|PATCH|PUT|DELETE), requires the export to be the product of
 * `withAuth(...)` or `withPublicRoute(...)` from `lib/auth-middleware`.
 *
 * "The policy is in the handler body" does not pass: the point of the card is that
 * "who may call this route?" must be answerable without opening the handler, and
 * that a new `route.ts` without a policy cannot slip in unnoticed.
 *
 * It also refuses one combination outright: a method declared `withPublicRoute` in a
 * file that reaches `service_role`. Declaring is not authorizing, and `service_role`
 * ignores RLS — that pair is an anonymous caller with the whole database.
 *
 * Exit code 1 lists file and method still missing a policy.
 *
 *   npm run check:routes
 *   npm run check:routes -- <dir>   scan <dir> instead of app/api (used by the tests)
 *
 * NOT wired into `npm run check-all` yet — that is phase 3, after the 134 routes are
 * converted. Wiring it now would break the build for everyone.
 *
 * The parse is done with the TypeScript compiler API rather than a regex so that a
 * comment, a string or a differently formatted call cannot fake a policy.
 */

import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { glob } from 'node:fs/promises'
import ts from 'typescript'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const API_DIR = resolve(REPO_ROOT, 'app/api')
const HTTP_METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])

/** The gate module, resolved. `supabase/functions/_shared/auth-middleware.ts` is a
 *  different file with a different job, and a `withAuth` from there is not this gate. */
const GATE_MODULE = resolve(REPO_ROOT, 'lib/auth-middleware')
/** Where the service-role client comes from. Same reason: resolved, not matched by name. */
const SUPABASE_CLIENT_MODULE = resolve(REPO_ROOT, 'lib/core/supabase-client')

const AUTH_GATES = new Set(['withAuth'])
const PUBLIC_GATES = new Set(['withPublicRoute'])
/**
 * Closed list of functions allowed to sit *between* the export and the gate.
 * Anything else — `wrap(withAuth(...))` — is rejected, because the script cannot
 * know whether the wrapper calls its argument or throws it away.
 */
const COMPOSERS = new Set(['withRateLimit'])

/** Named exports of `lib/core/supabase-client` that hand out a service-role client. */
const SERVICE_CLIENT_FACTORIES = new Set(['getSupabaseService'])
/** `getSupabase('service')` reaches the same client through the type argument. */
const SERVICE_CLIENT_SELECTOR = 'getSupabase'
/** Env names that *are* the secret, however the client is built. */
const SERVICE_KEY_ENV = new Set(['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'])

interface Finding {
  file: string
  method: string
  reason: string
}

/** Local names, in one file, for what was imported from the gate module. */
interface GateNames {
  /** Local names bound to `withAuth`. */
  auth: Set<string>
  /** Local names bound to `withPublicRoute`. */
  public: Set<string>
  /** Local names bound to an allowed composer. */
  composers: Set<string>
}

/**
 * Resolves an import specifier to an absolute path without extension, so it can be
 * compared with a known module. Returns null for a bare package specifier, which by
 * definition is not one of ours.
 */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  let absolute: string
  if (specifier.startsWith('@/')) absolute = resolve(REPO_ROOT, specifier.slice(2))
  else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    absolute = resolve(dirname(fromFile), specifier)
  } else return null

  return absolute.replace(/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, '').replace(/\/index$/, '')
}

/**
 * Names imported from `lib/auth-middleware` in this file. A local `withAuth` that
 * came from somewhere else is not the gate, and must not be accepted as one — the
 * repo has a second `auth-middleware.ts` under `supabase/functions/_shared/`.
 */
function collectGateImports(source: ts.SourceFile): GateNames {
  const names: GateNames = { auth: new Set(), public: new Set(), composers: new Set() }

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
    if (resolveSpecifier(statement.moduleSpecifier.text, source.fileName) !== GATE_MODULE) continue

    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue

    for (const element of bindings.elements) {
      // `import { withAuth as gate }` — the local name is what the call site uses.
      const original = (element.propertyName ?? element.name).text
      const local = element.name.text
      if (AUTH_GATES.has(original)) names.auth.add(local)
      if (PUBLIC_GATES.has(original)) names.public.add(local)
      if (COMPOSERS.has(original)) names.composers.add(local)
    }
  }

  return names
}

function unwrap(expr: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) {
    return unwrap(expr.expression)
  }
  return expr
}

/**
 * True when the expression is a call to one of `gates`, optionally through a
 * composer from the closed list — `withRateLimit(...)(withAuth(...))` counts.
 *
 * Deliberately *not* "contains a call to a gate anywhere": `wrap(withAuth(...))`
 * would pass that test even if `wrap` discarded its argument and exported an
 * ungated handler. The gate has to be what produces the exported value.
 */
function isGatedBy(expr: ts.Expression, gates: Set<string>, composers: Set<string>): boolean {
  const node = unwrap(expr)
  if (!ts.isCallExpression(node)) return false

  const callee = unwrap(node.expression)

  // withAuth({ roles }, handler) / withPublicRoute({ reason }, handler)
  if (ts.isIdentifier(callee) && gates.has(callee.text)) return true

  // withRateLimit(...)(withAuth(...)) — the composer is applied to the gate.
  if (ts.isCallExpression(callee)) {
    const composer = unwrap(callee.expression)
    if (ts.isIdentifier(composer) && composers.has(composer.text)) {
      return node.arguments.some((arg) => isGatedBy(arg, gates, composers))
    }
  }

  return false
}

const isGatedExpression = (expr: ts.Expression, names: GateNames): boolean =>
  isGatedBy(expr, new Set([...names.auth, ...names.public]), names.composers)

const isPublicExpression = (expr: ts.Expression, names: GateNames): boolean =>
  isGatedBy(expr, names.public, names.composers)

/**
 * True when this file can build a service-role client directly: it imports one of
 * the service factories, calls `getSupabase('service')`, or names the secret env.
 *
 * Scope, stated on purpose: this only sees what the route file itself does. A route
 * that reaches `service_role` through `lib/services/*` is invisible here, and the
 * check does not claim otherwise — it closes the fast path (`withPublicRoute` stamped
 * on a handler that queries with the secret key), not every path.
 */
function usesServiceRole(source: ts.SourceFile): boolean {
  const serviceFactories = new Set<string>()
  const selectors = new Set<string>()
  let found = false

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
    if (resolveSpecifier(statement.moduleSpecifier.text, source.fileName) !== SUPABASE_CLIENT_MODULE) {
      continue
    }

    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue

    for (const element of bindings.elements) {
      const original = (element.propertyName ?? element.name).text
      if (SERVICE_CLIENT_FACTORIES.has(original)) serviceFactories.add(element.name.text)
      if (original === SERVICE_CLIENT_SELECTOR) selectors.add(element.name.text)
    }
  }

  if (serviceFactories.size > 0) return true

  const visit = (node: ts.Node): void => {
    if (found) return

    // process.env.SUPABASE_SECRET_KEY, process.env['SUPABASE_SECRET_KEY'], Deno.env.get(...)
    if (ts.isIdentifier(node) && SERVICE_KEY_ENV.has(node.text)) found = true
    if (ts.isStringLiteral(node) && SERVICE_KEY_ENV.has(node.text)) found = true

    // getSupabase('service')
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && selectors.has(node.expression.text)) {
      const [first] = node.arguments
      if (first && ts.isStringLiteral(first) && first.text === 'service') found = true
    }

    ts.forEachChild(node, visit)
  }
  visit(source)

  return found
}

function isExported(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return !!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
}

function checkFile(absolutePath: string): Finding[] {
  const file = relative(REPO_ROOT, absolutePath)
  const source = ts.createSourceFile(
    absolutePath,
    readFileSync(absolutePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )

  const gateNames = collectGateImports(source)
  const serviceRole = usesServiceRole(source)
  const findings: Finding[] = []
  /** Local declarations, so `export { handler as GET }` can be resolved. */
  const locals = new Map<string, ts.Expression | null>()

  /**
   * `withPublicRoute` proves nothing, and `service_role` ignores RLS. Together they
   * are an unauthenticated route with full read/write on the database — and that is
   * exactly the shortcut that makes a red check turn green during a bulk conversion.
   */
  const checkPublicOverServiceRole = (expr: ts.Expression, method: string): void => {
    if (!serviceRole || !isPublicExpression(expr, gateNames)) return
    findings.push({
      file,
      method,
      reason: 'declared public but the file reaches service_role — service_role ignores RLS',
    })
  }

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      locals.set(statement.name.text, null)
      if (isExported(statement) && HTTP_METHODS.has(statement.name.text)) {
        findings.push({
          file,
          method: statement.name.text,
          reason: 'exported as a plain function — no policy declared',
        })
      }
    }

    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue
        locals.set(decl.name.text, decl.initializer ?? null)

        if (!isExported(statement) || !HTTP_METHODS.has(decl.name.text)) continue

        if (!decl.initializer || !isGatedExpression(decl.initializer, gateNames)) {
          findings.push({
            file,
            method: decl.name.text,
            reason: 'not produced by withAuth() or withPublicRoute()',
          })
          continue
        }

        checkPublicOverServiceRole(decl.initializer, decl.name.text)
      }
    }

    // `export { handler as GET }`
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (!HTTP_METHODS.has(element.name.text)) continue
        const localName = (element.propertyName ?? element.name).text
        const initializer = locals.get(localName)
        if (!initializer || !isGatedExpression(initializer, gateNames)) {
          findings.push({
            file,
            method: element.name.text,
            reason: `re-exported from \`${localName}\` without a policy`,
          })
          continue
        }

        checkPublicOverServiceRole(initializer, element.name.text)
      }
    }
  }

  return findings
}

async function main(): Promise<void> {
  // Optional argument: the directory to scan. Defaults to `app/api`, and exists so
  // `tests/api/auth-middleware.test.ts` can point the real script at fixture routes
  // without those fixtures becoming routes of the CMS.
  const scanDir = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : API_DIR

  const files: string[] = []
  for await (const entry of glob('**/route.ts', { cwd: scanDir })) {
    files.push(resolve(scanDir, entry))
  }
  files.sort()

  const findings = files.flatMap(checkFile)

  const totalMethods = files.reduce((total, file) => {
    const source = readFileSync(file, 'utf8')
    return total + [...source.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+([A-Z]+)\b/g)]
      .filter((m) => HTTP_METHODS.has(m[1])).length
  }, 0)

  if (findings.length === 0) {
    console.log(`✅ ${files.length} route files, ${totalMethods} HTTP methods — all declare a policy.`)
    return
  }

  let currentFile = ''
  for (const finding of findings) {
    if (finding.file !== currentFile) {
      currentFile = finding.file
      console.log(`\n${currentFile}`)
    }
    console.log(`  ${finding.method.padEnd(6)} ${finding.reason}`)
  }

  const filesInFault = new Set(findings.map((f) => f.file)).size
  console.log(
    `\n❌ CARD-CMS-01: ${findings.length} of ${totalMethods} HTTP methods are rejected` +
    ` (${filesInFault} of ${files.length} route files).`
  )
  console.log('   Wrap the export in withAuth({ roles: [...] }, handler) or withPublicRoute({ reason }, handler).')
  console.log('   A route that reaches service_role cannot be public: give it withAuth, or drop the service client.')
  process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
