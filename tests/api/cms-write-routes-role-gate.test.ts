/**
 * #780 — rotas de escrita do CMS fora de `app/api/migration/` que só checavam `getSession()`
 * (ou só a existência do e-mail em `cms_users`, sem papel nem `is_active`). `getSession()` lê o
 * cookie sem revalidar o JWT: cookie forjado passava. Agora todo método exportado nelas é
 * produto de `withAuth` com papel, que revalida com `getUser()`.
 *
 * O papel segue quem chama: `admin` onde a tela é só de admin ou não há chamador; `admin` e
 * `client` nas rotas do editor de `/routes`, tela que `lib/navigation/access.ts#resolveAccess`
 * abre para os dois.
 *
 * A única leitura de `getSession()` admitida é `auth.supabase.auth.getSession()` — o client que
 * `withAuth` entrega depois de revalidar, usado só para repassar o `access_token` a uma Edge
 * Function (mesmo padrão de `app/api/system-audio/route.ts`).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')

const GATES: Record<string, string[]> = {
  'app/api/pois/[id]/names/route.ts': ['admin'],
  'app/api/pois/[id]/garbage/route.ts': ['admin'],
  'app/api/pois/geofences/update/route.ts': ['admin'],
  'app/api/routes/[id]/translations/route.ts': ['admin', 'client'],
  'app/api/routes/[id]/translations/generate/route.ts': ['admin', 'client'],
  'app/api/routes/[id]/route.ts': ['admin', 'client'],
}

for (const [path, roles] of Object.entries(GATES)) {
  test(`${path}: todo método exige ${roles.join('+')} por withAuth, sem getSession cru (#780)`, () => {
    const src = readFileSync(resolve(root, path), 'utf8')

    const methods = [...src.matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b/g)]
    assert.ok(methods.length > 0, path)

    const roleList = roles.map((r) => `'${r}'`).join(',\\s*')
    const gate = new RegExp(
      `export const (GET|POST|PUT|PATCH|DELETE) = withAuth\\s*(<[^>]*>)?\\(\\s*\\{\\s*roles:\\s*\\[\\s*${roleList}\\s*\\]\\s*\\}`,
      'g'
    )
    const gated = [...src.matchAll(gate)].map((m) => m[1])
    assert.deepEqual(gated.sort(), methods.map((m) => m[1]).sort(), `${path}: método fora do portão`)

    assert.doesNotMatch(src, /export async function (GET|POST|PUT|PATCH|DELETE)\b/, path)
    assert.doesNotMatch(src, /(?<!auth\.supabase)\.auth\.getSession\(/, path)
    assert.doesNotMatch(src, /from 'next\/headers'/, `${path}: cookie lido fora de withAuth`)
  })
}
