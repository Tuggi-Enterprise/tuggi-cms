/**
 * #780 — as rotas de migração gravam em produção como service role (migram POI, geram áudio,
 * substituem TPs). Por isso toda rota de escrita em `app/api/migration/` fica atrás de
 * `withAuth({ roles: ['admin'] })`, que revalida o JWT com `getUser()`. `getSession()` lê o
 * cookie sem revalidar e aceitava qualquer sessão — inclusive a de um turista do app.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = resolve(root, 'app/api/migration')

test('toda rota de escrita de migração exige admin por withAuth (#780)', () => {
  const routes = readdirSync(dir)
    .map(name => join(dir, name, 'route.ts'))
    .filter(existsSync)
  assert.ok(routes.length > 0)
  for (const path of routes) {
    const src = readFileSync(path, 'utf8')
    if (!/export (const|async function) (POST|PUT|PATCH|DELETE)\b/.test(src)) continue
    assert.match(src, /withAuth\s*(<[^>]*>)?\(\s*\{\s*roles:\s*\[\s*'admin'\s*\]\s*\}/, path)
    assert.doesNotMatch(src, /auth\.getSession\(/, path)
  }
})

test('migrate-poi-safe, sem chamador, não existe (#780)', () => {
  assert.equal(existsSync(join(dir, 'migrate-poi-safe')), false)
})
