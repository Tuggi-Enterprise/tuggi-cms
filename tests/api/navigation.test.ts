/**
 * O MENU E O PORTÃO SÃO A MESMA DECISÃO — e isto é o que prova.
 *
 * A invariante, em uma frase: **um item visível no menu é um caminho que o proxy admite para
 * aquele usuário.** Antes de 2026-09-01 ela era falsa para dois dos quatro roles.
 *
 * Mutações que deixam esta suíte vermelha:
 *  · o menu voltar a decidir visibilidade por `isAdmin`/`role === 'x'` em vez de perguntar a
 *    `canReach` — um `editor` volta a ver "Dashboard" e "Pontos de Interesse", e os dois
 *    respondem `/unauthorized`;
 *  · `resolveAccess` deixar de mandar o `client` da Overview global para o painel dele, ou
 *    passar a devolver `unauthorized` ali — a Overview é global por construção (10 das 14
 *    chamadas não aceitam dono) e mandar um parceiro para "não autorizado" descreveria o
 *    problema errado;
 *  · um prefixo de módulo virar decisão local em vez de `isModuleEnabled`, o que ressuscita o
 *    defeito que `MODULE_MIN_ROLES` foi criado para matar;
 *  · um item de menu apontar para uma chave de tradução que não existe nos três idiomas — o
 *    menu quebra no idioma que ninguém testa;
 *  · um grupo ficar na barra sem nenhum item alcançável, abrindo um painel em branco;
 *  · `Parcerias` voltar a carregar um filtro de estado no href, que esvaziava duas colunas do
 *    quadro (a mesma regra travada em `client-board-surface.test.ts`, agora onde o menu mora).
 *
 * Puro de propósito: sem banco, sem React, sem `mock.module`. Nesta máquina (Node 20.18) o mock
 * de módulo não resolve o alias `@/` e derruba a suíte antes da primeira asserção — um teste de
 * acesso que só roda no CI é um teste que ninguém vê falhar enquanto escreve o defeito.
 *
 * Run with: npx tsx --test tests/api/navigation.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { resolveAccess, canReach, CLIENT_HOME } from '@/lib/navigation/access'
import { buildNavTree, type NavContext, type NavItem } from '@/lib/navigation/menu'
import { MODULES } from '@/lib/modules'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const messages = (locale: string) => JSON.parse(read(`messages/${locale}.json`))

/** Sem comentários: a prosa que explica o defeito não pode satisfazer a prova dele. */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const ADMIN: NavContext = { role: 'admin', enabledModules: [] }
const CLIENT: NavContext = { role: 'client', enabledModules: [] }
const EDITOR: NavContext = { role: 'editor', enabledModules: [] }
const VIEWER: NavContext = { role: 'viewer', enabledModules: [] }

/** Todo href que a árvore oferece, achatado. */
function hrefs(ctx: NavContext): string[] {
  const tree = buildNavTree(ctx)
  return [
    ...tree.primary.map((i) => i.href),
    ...tree.groups.flatMap((g) => g.sections.flatMap((s) => s.items.map((i) => i.href))),
  ]
}

function allItems(ctx: NavContext): NavItem[] {
  const tree = buildNavTree(ctx)
  return [...tree.primary, ...tree.groups.flatMap((g) => g.sections.flatMap((s) => s.items))]
}

// ── A invariante ──────────────────────────────────────────────────────────────────────────

test('todo item oferecido é um caminho que o portão admite — para os quatro roles', () => {
  for (const ctx of [ADMIN, CLIENT, EDITOR, VIEWER]) {
    for (const href of hrefs(ctx)) {
      assert.equal(
        resolveAccess(href, ctx).kind,
        'allow',
        `role=${ctx.role}: o menu oferece ${href}, e o portão não deixa entrar`
      )
    }
  }
})

test('o defeito concreto que isto corrigiu: editor e viewer não recebem links quebrados', () => {
  // Os três que o menu antigo mostrava para todo não-admin não-coordenador, e que o proxy
  // recusava porque `ALLOWED_CLIENT_PATHS` só vale dentro do ramo `client`.
  for (const ctx of [EDITOR, VIEWER]) {
    for (const dead of ['/dashboard', CLIENT_HOME, '/pois', '/routes']) {
      assert.equal(
        canReach(dead, ctx),
        false,
        `${ctx.role} não entra em ${dead} — o portão nunca deixou`
      )
      assert.equal(
        hrefs(ctx).includes(dead),
        false,
        `${ctx.role}: ${dead} não pode aparecer no menu`
      )
    }
  }
})

test('um editor SEM módulo nenhum não recebe menu de navegação', () => {
  // Não é um menu vazio por acidente: é a consequência honesta de o proxy não ter ramo para
  // `editor`. Se algum dia ele ganhar um, este teste muda junto — de propósito.
  assert.deepEqual(hrefs(EDITOR), [])
  assert.deepEqual(hrefs(VIEWER), [])
})

test('um editor COM o módulo financeiro recebe exatamente uma entrada', () => {
  const ctx: NavContext = { role: 'editor', enabledModules: [MODULES.FINANCE] }
  assert.deepEqual(hrefs(ctx), ['/finance'])
  assert.equal(buildNavTree(ctx).groups.length, 0, 'nenhum grupo abre painel em branco')
})

// ── O que cada role vê ────────────────────────────────────────────────────────────────────

test('o client vê o painel dele, os POIs e as rotas — e nada de /dashboard', () => {
  const seen = hrefs(CLIENT)
  assert.ok(seen.includes(CLIENT_HOME), 'o item dele é `/clients/dashboard`, escrito como tal')
  assert.equal(seen.includes('/dashboard'), false, 'a Overview global não é oferecida a ele')
  assert.ok(seen.includes('/pois'))
  assert.ok(seen.includes('/routes'))
  assert.equal(seen.includes('/admin/materials'), false)
  assert.equal(seen.includes('/dashboard/reports/catalog'), false)

  // E o portão concorda com o que o menu escondeu.
  assert.equal(resolveAccess('/dashboard', CLIENT).kind, 'redirect')
  assert.equal(resolveAccess('/admin/materials', CLIENT).kind, 'unauthorized')
})

test('o coordenador usa `Minha rede`, e não recebe um Dashboard além dela', () => {
  const coord: NavContext = { role: 'client', enabledModules: [], isCoordinator: true }
  const seen = hrefs(coord)
  assert.ok(seen.includes('/clients/coordinator'))
  assert.equal(seen.includes(CLIENT_HOME), false, 'decisão do operador: ele usa Minha rede')
  assert.equal(seen.includes('/dashboard'), false)

  // COORDENADOR NÃO GERENCIA PONTOS — decisão de produto, e `canReach` sozinho não a aplica:
  // ele é `client`, e o portao deixaria ele entrar em `/pois` e `/routes`. `useCmsUser` diz o
  // mesmo do outro lado (`canManagePois = canEdit && !isCoordinator`), então oferecer o grupo
  // seria a porta de uma sala onde ele não age.
  assert.equal(
    buildNavTree(coord).groups.some((g) => g.id === 'points'),
    false,
    'o grupo Pontos some inteiro para o coordenador'
  )
  assert.equal(seen.includes('/pois'), false)
  assert.equal(seen.includes('/routes'), false)
})

test('o admin vê a Overview global E Minha rede, para dar suporte a qualquer guarda-chuva', () => {
  const seen = hrefs(ADMIN)
  assert.ok(seen.includes('/dashboard'))
  assert.ok(seen.includes('/clients/coordinator'))
  assert.equal(seen.includes(CLIENT_HOME), false, 'um lugar na barra, um item')
})

test('o admin com um módulo desligado ainda vê tudo — ele ignora o array por código', () => {
  assert.ok(hrefs(ADMIN).includes('/finance'))
  assert.ok(hrefs(ADMIN).includes('/events'))
})

// ── A estrutura ───────────────────────────────────────────────────────────────────────────

test('todo destino do menu é uma página que existe no disco', () => {
  // `resolveAccess` devolve `allow` para QUALQUER string quando o role é admin — ele decide
  // permissão, não existência. Sem esta prova, trocar `/admin/materials` por `/admin/materiais`
  // deixa a suíte inteira verde e entrega um 404 ao operador.
  for (const href of hrefs(ADMIN)) {
    const page = resolve(root, `app/[locale]${href}/page.tsx`)
    assert.ok(existsSync(page), `${href} não tem página em app/[locale]${href}/page.tsx`)
  }
})

test('o catálogo do admin é exatamente este — apagar um destino tem de doer', () => {
  // Lista explícita, e não uma contagem: um item removido por engano some sem barulho, e o
  // menu é justamente onde ninguém percebe a ausência de algo que raramente se usa.
  assert.deepEqual(hrefs(ADMIN).sort(), [
    '/admin/audit-logs',
    '/admin/clients',
    '/admin/coupons',
    '/admin/materials',
    '/admin/poi-trigger-map',
    '/admin/users',
    '/clients/coordinator',
    '/dashboard',
    '/dashboard/marketing/newsletter',
    '/dashboard/marketing/notifications',
    '/dashboard/realtime',
    '/dashboard/reports/acquisition',
    '/dashboard/reports/catalog',
    '/dashboard/reports/engagement',
    '/dashboard/reports/geography',
    '/dashboard/reports/users',
    '/dashboard/system-audio',
    '/events',
    '/finance',
    '/osm-importer',
    '/places',
    '/poi-importer',
    '/poi-processing',
    '/pois',
    '/routes',
    '/trail-visualization',
    '/trigger-points-single',
    '/users/app',
  ])
})

test('o módulo responde ANTES do ramo de client, e a ordem importa', () => {
  // Se as duas checagens trocarem de lugar em `resolveAccess`, um `client` com `places`
  // marcado perde `/places` — cai no ramo de client, que não conhece o prefixo, e vira
  // `unauthorized`. Nenhum outro caso de teste pega isso: todos os contextos padrão têm
  // `enabledModules: []`, e `finance` tem piso de role que exclui `client` de qualquer jeito.
  const clientComPlaces: NavContext = { role: 'client', enabledModules: [MODULES.PLACES] }
  assert.equal(resolveAccess('/places', clientComPlaces).kind, 'allow')
  assert.equal(resolveAccess('/places/abc-123', clientComPlaces).kind, 'allow')
  assert.ok(hrefs(clientComPlaces).includes('/places'))

  const clientComEvents: NavContext = { role: 'client', enabledModules: [MODULES.EVENTS] }
  assert.equal(resolveAccess('/events', clientComEvents).kind, 'allow')
  assert.ok(hrefs(clientComEvents).includes('/events'))

  // E sem o módulo, o mesmo client não entra — o ramo de client não conhece esses prefixos.
  assert.equal(resolveAccess('/places', CLIENT).kind, 'unauthorized')
})

test('prefixo é SEGMENTO, não pedaço de string', () => {
  // `/poi-importer` começa com `/poi`, e `/client-registration` começa com `/client`. Com
  // `startsWith` puro, um `client` entraria em `/poi-importer` — que é admin-only.
  assert.equal(resolveAccess('/poi-importer', CLIENT).kind, 'unauthorized')
  assert.equal(resolveAccess('/poi-processing', CLIENT).kind, 'unauthorized')
  assert.equal(resolveAccess('/client-registration', CLIENT).kind, 'unauthorized')
  // E o que É segmento continua entrando.
  assert.equal(resolveAccess('/pois', CLIENT).kind, 'allow')
  assert.equal(resolveAccess('/pois/abc-123', CLIENT).kind, 'allow')
})

test('nenhum grupo chega à barra sem item dentro', () => {
  for (const ctx of [ADMIN, CLIENT, EDITOR, VIEWER]) {
    for (const group of buildNavTree(ctx).groups) {
      assert.ok(group.sections.length > 0, `${ctx.role}: grupo ${group.id} sem seção`)
      for (const section of group.sections) {
        assert.ok(section.items.length > 0, `${ctx.role}: seção vazia em ${group.id}`)
      }
    }
  }
})

test('cabeçalho de seção só existe quando há mais de uma seção para separar', () => {
  for (const group of buildNavTree(CLIENT).groups) {
    if (group.sections.length === 1) {
      assert.equal(
        group.sections[0].labelKey,
        undefined,
        `${group.id}: um título sobre a única seção é mobília sem função`
      )
    }
  }
  // Para o admin, `Pontos` tem as três seções e todas nomeadas.
  const points = buildNavTree(ADMIN).groups.find((g) => g.id === 'points')
  assert.ok(points, 'o grupo de pontos existe para o admin')
  assert.equal(points!.sections.length, 3)
  for (const section of points!.sections) {
    assert.ok(section.labelKey, 'com mais de uma seção, cada uma se nomeia')
  }
})

test('`Admin` deixou de ser um grupo — permissão não é assunto', () => {
  const ids = buildNavTree(ADMIN).groups.map((g) => g.id)
  assert.equal(ids.includes('admin'), false)
  assert.deepEqual(ids, ['points', 'partners', 'marketing', 'reports', 'system'])
})

test('a barra não passa de 8 elementos para ninguém', () => {
  for (const ctx of [ADMIN, CLIENT, EDITOR, VIEWER]) {
    const tree = buildNavTree(ctx)
    const width = tree.primary.length + tree.groups.length
    assert.ok(width <= 8, `role=${ctx.role}: ${width} elementos na barra`)
  }
})

// ── Rótulos ───────────────────────────────────────────────────────────────────────────────

test('toda chave de rótulo existe nos três idiomas', () => {
  const locales = ['pt', 'en', 'es'].map((l) => ({ l, nav: messages(l).Navigation ?? {} }))
  const tree = buildNavTree(ADMIN)
  const keys = [
    ...allItems(ADMIN).map((i) => i.labelKey),
    ...tree.groups.map((g) => g.labelKey),
    ...tree.groups.flatMap((g) => g.sections.map((s) => s.labelKey).filter(Boolean)),
  ] as string[]

  assert.ok(keys.length > 0)
  for (const key of keys) {
    for (const { l, nav } of locales) {
      assert.equal(
        typeof nav[key],
        'string',
        `Navigation.${key} falta em ${l}.json — o menu quebra no idioma que ninguém testa`
      )
    }
  }
})

test('o rótulo fala a língua da tela que ele abre', () => {
  // DECISÃO, e não esquecimento. `finance`, `materials` e `partnerships` carregam o MESMO valor
  // em português nos três idiomas porque os namespaces `Finance`, `Materials` e `Partnerships`
  // só existem em `pt.json` — as telas são em português. Traduzir o rótulo prometeria uma
  // tradução que a tela não entrega, e quem chegasse lá em `en` acharia que quebrou.
  //
  // Este teste é o que impede a decisão de virar um acidente silencioso: no dia em que aqueles
  // namespaces existirem em `en`/`es`, ele fica vermelho e cobra a tradução do rótulo junto.
  const PT_ONLY = { finance: 'Financeiro', materials: 'Material', partnerships: 'Parcerias' }
  const namespaces = ['Finance', 'Materials', 'Partnerships'] as const

  for (const locale of ['en', 'es']) {
    const file = messages(locale)
    for (const ns of namespaces) {
      assert.equal(
        ns in file,
        false,
        `${locale}.json ganhou o namespace ${ns} — traduza também o rótulo de menu correspondente`
      )
    }
    for (const [key, value] of Object.entries(PT_ONLY)) {
      assert.equal(
        file.Navigation[key],
        value,
        `Navigation.${key} em ${locale} tem de nomear a tela como ela é: em português`
      )
    }
  }
})

test('os três idiomas têm exatamente as mesmas chaves de Navigation', () => {
  // A regra que fecha o buraco de vez: chave entra quando um item a consome, e sai junto com
  // ele. Antes desta versão o namespace tinha 44 chaves e 18 não eram usadas em lugar nenhum —
  // cinco delas nomeando rotas que hoje são apenas redirects de URL legada (`heatmap`,
  // `inventory`, `territorial`, `premium`, `content_coverage`). Vocabulário fóssil, traduzido em
  // três idiomas, apontando para nada.
  const [pt, en, es] = ['pt', 'en', 'es'].map((l) => Object.keys(messages(l).Navigation ?? {}).sort())
  assert.deepEqual(en, pt, 'en.json divergiu de pt.json')
  assert.deepEqual(es, pt, 'es.json divergiu de pt.json')
  assert.ok(pt.length > 0)
})

test('nenhum rótulo do menu é texto literal — nem no componente, nem no catálogo', () => {
  // Os dois arquivos, porque o rótulo MUDOU DE CASA: olhar só o Header passaria a vazio hoje,
  // já que ele não carrega rótulo nenhum por construção.
  for (const path of ['components/ui/Header.tsx', 'lib/navigation/menu.ts']) {
    const source = code(path)
    for (const literal of ['Parcerias', 'Audit Logs', 'Coupons', 'Minha rede', 'Financeiro']) {
      assert.equal(
        source.includes(`'${literal}'`),
        false,
        `${path}: \`${literal}\` é rótulo literal; o menu só aceita chave de Navigation`
      )
    }
  }

  // E toda `labelKey` do catálogo é um identificador em snake_case, nunca uma frase.
  const menu = code('lib/navigation/menu.ts')
  for (const label of menu.matchAll(/labelKey:\s*'([^']+)'/g)) {
    assert.match(label[1], /^[a-z][a-z0-9_]*$/, `labelKey \`${label[1]}\` não é uma chave`)
  }
})

// ── Regras herdadas que continuam valendo ─────────────────────────────────────────────────

test('nenhum link do menu carrega filtro de estado para o quadro de parcerias', () => {
  // Mesma invariante de `client-board-surface.test.ts`, aplicada onde o menu passou a morar:
  // `IN_PROGRESS_STATES` é o complemento das colunas terminais, então um `?state=` no href
  // esvazia `Publicado` e `Encerrados` antes de o operador ver o quadro.
  const menu = read('lib/navigation/menu.ts')
  assert.equal(/admin\/clients\?[^`'"]*state=/.test(menu), false)
  assert.ok(/CLIENT_DIRECTORY_PATH/.test(menu), 'o caminho vem da constante, não digitado à mão')
})

test('nada no menu aponta para as telas que foram retiradas', () => {
  const menu = read('lib/navigation/menu.ts')
  for (const dead of ['/admin/partner-proposals', '/admin/partnerships', '/admin/finance']) {
    assert.equal(menu.includes(`'${dead}'`), false, `nada no menu aponta para ${dead}`)
  }
})

test('o Financeiro é gateado por módulo, nunca por role', () => {
  // Um editor COM o módulo entra; um admin SEM o array também, porque é onipotente por código.
  assert.ok(canReach('/finance', { role: 'editor', enabledModules: [MODULES.FINANCE] }))
  assert.ok(canReach('/finance', ADMIN))
  // E o piso de role continua valendo: um client com o módulo marcado não entra.
  assert.equal(canReach('/finance', { role: 'client', enabledModules: [MODULES.FINANCE] }), false)
})
