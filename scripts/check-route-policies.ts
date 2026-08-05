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
 * Exit code 1 lists file and method still missing a policy.
 *
 *   npm run check:routes
 *
 * NOT wired into `npm run check-all` yet — that is phase 3, after the 134 routes are
 * converted. Wiring it now would break the build for everyone.
 *
 * The parse is done with the TypeScript compiler API rather than a regex so that a
 * comment, a string or a differently formatted call cannot fake a policy.
 */

import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { glob } from 'node:fs/promises'
import ts from 'typescript'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const API_DIR = resolve(REPO_ROOT, 'app/api')
const HTTP_METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
const GATES = new Set(['withAuth', 'withPublicRoute'])
const GATE_MODULE = 'auth-middleware'

interface Finding {
  file: string
  method: string
  reason: string
}

/**
 * Names imported from `lib/auth-middleware` in this file. A local `withAuth` that
 * came from somewhere else is not the gate, and must not be accepted as one.
 */
function collectGateImports(source: ts.SourceFile): Set<string> {
  const names = new Set<string>()

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
    if (!statement.moduleSpecifier.text.endsWith(GATE_MODULE)) continue

    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue

    for (const element of bindings.elements) {
      // `import { withAuth as gate }` — the local name is what the call site uses.
      const original = (element.propertyName ?? element.name).text
      if (GATES.has(original)) names.add(element.name.text)
    }
  }

  return names
}

/**
 * True when the expression is (or wraps) a call to one of the gates, so that a
 * future `withRateLimit(...)(withAuth(...))` composition still counts as declared.
 */
function isGatedExpression(expr: ts.Expression, gateNames: Set<string>): boolean {
  if (ts.isCallExpression(expr)) {
    if (ts.isIdentifier(expr.expression) && gateNames.has(expr.expression.text)) return true
    // The callee itself may be the gate call, e.g. withRateLimit(...)(withAuth(...)).
    if (isGatedExpression(expr.expression, gateNames)) return true
    return expr.arguments.some((arg) => isGatedExpression(arg, gateNames))
  }
  if (ts.isParenthesizedExpression(expr)) return isGatedExpression(expr.expression, gateNames)
  if (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) {
    return isGatedExpression(expr.expression, gateNames)
  }
  return false
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
  const findings: Finding[] = []
  /** Local declarations, so `export { handler as GET }` can be resolved. */
  const locals = new Map<string, ts.Expression | null>()

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
        }
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
        }
      }
    }
  }

  return findings
}

async function main(): Promise<void> {
  const files: string[] = []
  for await (const entry of glob('**/route.ts', { cwd: API_DIR })) {
    files.push(resolve(API_DIR, entry))
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
    `\n❌ CARD-CMS-01: ${findings.length} of ${totalMethods} HTTP methods have no declared policy` +
    ` (${filesInFault} of ${files.length} route files).`
  )
  console.log('   Wrap the export in withAuth({ roles: [...] }, handler) or withPublicRoute({ reason }, handler).')
  process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
