/**
 * As rotas que fazem estrago com `service_role` precisam provar o role de quem pede.
 *
 * Este arquivo lê o TEXTO-FONTE, como `finance-surface.test.ts` e `material-queue.test.ts`. Não
 * usa `mock.module`, de propósito: nesta máquina (Node 20.18) o mock de módulo não resolve o
 * alias `@/` e derruba a suíte inteira antes da primeira asserção. Um teste de segurança que só
 * roda no CI é um teste que ninguém vê falhar enquanto escreve o defeito.
 *
 * O QUE ELE PEGA. Em 2026-09-01 uma revisão de acesso encontrou quatro rotas que instanciam o
 * cliente de serviço, executam ato destrutivo ou caro, e autorizavam apenas por "existe sessão":
 *
 *  · `/api/pois/bulk-garbage` — apagava POIs de `core.attractions` em massa. O docstring dizia
 *    "Only system admins can perform this action" e o código nunca comparava `role`. O botão só
 *    aparecia para admin na tela, e o proxy não cobre `/api`: a UI era a única barreira.
 *  · `/api/migration/{migrate-batch,migrate-stream,list-candidates}` — disparavam o pipeline de
 *    migração (escrita em `core.attractions`, geração de descrição e áudio com custo de LLM/TTS,
 *    leitura do schema `homolog`). Nenhuma delas lia `role` ou `cms_users` em linha nenhuma.
 *
 * A regra que este arquivo trava é estreita e verificável: PARA ESTAS ROTAS, o método exportado
 * é produto de `withAuth` com `roles: ['admin']`, e `getSession()` não decide nada. Não é um
 * varredor geral — `npm run check:routes` é quem sabe apontar as ~118 rotas que ainda exportam
 * função simples, e ele não trava build nenhum (não está em `check-all`, nem em `pre-build`,
 * nem no workflow de deploy).
 *
 * Run with: npx tsx --test tests/api/privileged-routes.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

/** Sem comentários: o texto que explica o defeito não pode satisfazer a prova dele. */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** Rota → por que um não-admin chegando nela é um problema concreto. */
const ADMIN_ONLY: Array<{ path: string; why: string }> = [
  {
    path: 'app/api/pois/bulk-garbage/route.ts',
    why: 'apaga POIs de core.attractions em massa e os põe na blacklist',
  },
  {
    path: 'app/api/migration/migrate-batch/route.ts',
    why: 'escreve em core.attractions e gasta LLM/TTS por POI migrado',
  },
  {
    path: 'app/api/migration/migrate-stream/route.ts',
    why: 'mesmo pipeline da migrate-batch, em streaming',
  },
  {
    path: 'app/api/migration/list-candidates/route.ts',
    why: 'lê o schema homolog inteiro com o cliente de serviço',
  },
]

test('toda rota privilegiada exige admin pelo gate, e não pela tela', () => {
  for (const { path, why } of ADMIN_ONLY) {
    const source = code(path)

    const methods = source.match(/export (?:const|async function) (GET|POST|PATCH|PUT|DELETE)/g) ?? []
    assert.ok(methods.length > 0, `${path} não exporta método nenhum`)

    const gates = source.match(/withAuth\(/g) ?? []
    assert.equal(
      gates.length,
      methods.length,
      `${path}: um withAuth por método exportado — ${why}`
    )

    assert.ok(
      /roles: \['admin'\]/.test(source),
      `${path}: o role precisa ser declarado como 'admin' — ${why}`
    )
  }
})

test('nenhuma delas volta a autorizar por `getSession()`', () => {
  for (const { path, why } of ADMIN_ONLY) {
    const source = code(path)
    assert.ok(
      !/getSession\(\)/.test(source),
      `${path}: \`getSession()\` lê o cookie sem falar com o servidor de Auth e não pode ` +
        `embasar autorização (cabeçalho de lib/auth-middleware.ts) — ${why}`
    )
  }
})

test('a intenção continua escrita junto do código que a cumpre', () => {
  // O defeito de `bulk-garbage` durou porque a regra estava no docstring e não no código. Se o
  // arquivo voltar a prometer "admin" em prosa, que ao menos a prova acima esteja lá para cobrar.
  const garbage = read('app/api/pois/bulk-garbage/route.ts')
  assert.ok(
    /admin/i.test(garbage),
    'a rota declara que é de admin; a asserção anterior é quem verifica que ela cumpre'
  )
})
