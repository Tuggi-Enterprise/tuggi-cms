/**
 * QUEM ALCANÇA A ÁRVORE `/dashboard` — e por que uma barreira não bastava.
 *
 * BR-CMS-002 (o parceiro só enxerga o que é do cliente dele) e BR-CMS-004 (a unidade de acesso
 * é módulo **e** papel). O #732 pôs nas RPCs do painel dez colunas de rastro, estado de guia e
 * produto comprado — dado de turista identificado; o #733 é o aperto de escopo por cima, e este
 * arquivo é a metade do CMS.
 *
 * A invariante, em uma frase: **toda rota sob `app/[locale]/dashboard/` é alcançada exatamente
 * por quem `resolveAccess` deixa entrar em `/dashboard`** — que é a única pergunta que o layout
 * faz. Se algum dia uma rota abaixo dele passar a ter resposta própria (um prefixo de módulo,
 * por exemplo), a pergunta única do layout vira mentira, e é aqui que isso falha.
 *
 * Mutações que deixam esta suíte vermelha:
 *  · o layout do painel voltar a renderizar sem provar papel — o estado anterior ao #733;
 *  · uma tela sob `/dashboard` reintroduzir teste de papel por literal (`role === 'admin'`),
 *    que é a segunda definição de "quem entra" e o defeito que `my-clients` carregava;
 *  · o portão de página deixar de perguntar a `resolveAccess` e passar a decidir sozinho;
 *  · o portão parar de exigir `is_active`, ou trocar `getUser()` por `getSession()`;
 *  · `resolveAccess` passar a responder coisas diferentes para rotas diferentes sob
 *    `/dashboard`, sem que a guarda desça junto para as telas.
 *
 * Puro de propósito: sem banco, sem React, sem `mock.module` — mesma razão escrita em
 * `tests/api/navigation.test.ts`.
 *
 * Run with: npx tsx --test tests/api/dashboard-role-guard.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

import { resolveAccess, CLIENT_HOME, type AccessDecision } from '@/lib/navigation/access'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const DASHBOARD_DIR = 'app/[locale]/dashboard'
const LAYOUT = `${DASHBOARD_DIR}/layout.tsx`
const GUARD = 'lib/navigation/server-guard.ts'

/** Toda rota que existe de fato sob a árvore do layout, derivada do disco e não de uma lista. */
function dashboardRoutes(): string[] {
  const found: string[] = []
  const walk = (relative: string) => {
    for (const entry of readdirSync(resolve(root, relative), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(relative, entry.name))
      else if (entry.name === 'page.tsx') {
        const route = relative.slice('app/[locale]'.length).replace(/\\/g, '/')
        found.push(route === '' ? '/' : route)
      }
    }
  }
  walk(DASHBOARD_DIR)
  return found.sort()
}

const ROUTES = dashboardRoutes()

const ctx = (role: string | null) => ({ role, enabledModules: [] as string[] })
const kinds = (d: AccessDecision) => (d.kind === 'redirect' ? `redirect:${d.to}` : d.kind)

test('BR-CMS-004: a árvore /dashboard existe e tem mais de uma rota', () => {
  assert.ok(ROUTES.includes('/dashboard'), 'a Overview global sumiu da árvore')
  assert.ok(ROUTES.length > 1, `esperava várias rotas sob o layout, achei ${ROUTES.length}`)
})

test('BR-CMS-002: a pergunta única do layout vale para toda rota abaixo dele', () => {
  // O layout pergunta por `/dashboard` uma vez só. Isto prova que nenhuma rota filha tem
  // resposta própria — se tiver, a guarda precisa descer para a tela, e não ficar no layout.
  for (const role of ['admin', 'client', 'editor', 'viewer', 'coordinator', null]) {
    const atRoot = kinds(resolveAccess('/dashboard', ctx(role)))
    for (const route of ROUTES) {
      assert.equal(
        kinds(resolveAccess(route, ctx(role))),
        atRoot,
        `${route} responde diferente de /dashboard para role=${role}`
      )
    }
  }
})

test('BR-CMS-002: só admin alcança o painel; parceiro vai para o painel dele', () => {
  for (const route of ROUTES) {
    assert.equal(resolveAccess(route, ctx('admin')).kind, 'allow', `${route} fechou para admin`)

    const forClient = resolveAccess(route, ctx('client'))
    assert.deepEqual(
      forClient,
      { kind: 'redirect', to: CLIENT_HOME },
      `${route} devia mandar o parceiro para ${CLIENT_HOME}`
    )

    for (const role of ['editor', 'viewer', 'desconhecido', null]) {
      assert.equal(
        resolveAccess(route, ctx(role)).kind,
        'unauthorized',
        `${route} abriu para role=${role}`
      )
    }
  }
})

test('BR-CMS-002: o layout do painel prova o papel antes de renderizar', () => {
  const layout = read(LAYOUT)
  assert.match(layout, /requireAccess/, 'o layout do painel voltou a renderizar sem portão')
  assert.match(
    layout,
    /requireAccess\(\s*'\/dashboard'/,
    'o layout precisa perguntar pelo caminho que ele cobre'
  )
})

test('BR-CMS-004: nenhuma tela sob /dashboard redefine quem entra', () => {
  const offenders: string[] = []
  const walk = (relative: string) => {
    for (const entry of readdirSync(resolve(root, relative), { withFileTypes: true })) {
      const child = join(relative, entry.name)
      if (entry.isDirectory()) walk(child)
      else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
        // Comparar `role` com literal é a segunda definição de "quem é admin" — a que
        // divergiu da régua em `my-clients` e ficou divergente por dois meses sem quebrar nada.
        if (/\brole\s*(===|!==)\s*['"]/.test(read(child))) offenders.push(child)
      }
    }
  }
  walk(DASHBOARD_DIR)
  assert.deepEqual(offenders, [], `teste de papel por literal: ${offenders.join(', ')}`)
})

test('BR-CMS-004: o portão de página obedece a resolveAccess, e não decide sozinho', () => {
  const guard = read(GUARD)
  assert.match(guard, /from '\.\/access'/, 'o portão parou de ler a régua canônica')
  assert.match(guard, /resolveAccess\(/, 'o portão precisa consultar resolveAccess')
  assert.doesNotMatch(
    guard,
    /\brole\s*(===|!==)\s*['"]/,
    'o portão passou a comparar papel com literal — segunda definição de quem é admin'
  )
})

test('BR-CMS-002: o portão falha fechado — sessão autêntica e conta ativa', () => {
  const guard = read(GUARD)
  assert.match(guard, /auth\.getUser\(\)/, 'só getUser() revalida o JWT e pode embasar autorização')
  assert.doesNotMatch(guard, /auth\.getSession\(\)/, 'getSession() lê o cookie e não autoriza nada')
  assert.match(
    guard,
    /\.eq\('is_active',\s*true\)/,
    'conta desativada não renderiza tela de CMS (BR-CMS-015)'
  )
  assert.match(
    guard,
    /kind:\s*'no-cms-access'/,
    'consulta que falha ou usuário ausente precisam terminar em negação, nunca em allow'
  )
})
