/**
 * O que a superfície do financeiro promete, e o que ela tem proibido de fazer.
 *
 * Este arquivo lê o TEXTO-FONTE. É o mesmo lint semântico que `material-queue.test.ts` faz: as
 * invariantes abaixo não são sobre um valor de retorno, são sobre não existir um segundo lugar
 * onde a mesma decisão possa ser tomada de outro jeito.
 *
 * Mutations that turn this suite red:
 *  · converter minutos comprados em dinheiro em qualquer canto da Fase 1;
 *  · escrever custo por uma rota, em vez de pela esteira, criando um segundo caminho para a linha;
 *  · dar ao custo fixo um caminho até a linha de um cliente;
 *  · uma rota do financeiro sem `withAuth` ou sem `requireModule`;
 *  · gatear `/finance` só por role, o que faria a ativação por módulo não decidir nada;
 *  · pôr `/finance` sob `/admin/*`, onde o middleware barra todo não-admin antes do módulo;
 *  · esconder a entrada do menu atrás de `isAdmin` em vez do entitlement;
 *  · esquecer `finance` em `MODULES`, em `TOGGLEABLE_MODULES` ou em `MODULE_PREFIXES`;
 *  · deixar um `client` ou `viewer` com a checkbox marcada entrar em `/finance` — o portão da
 *    tela tem de recusar quem a API recusa, e um `client` É o parceiro medido pela tela;
 *  · o middleware voltar a decidir o entitlement por conta própria, fora de `isModuleEnabled`;
 *  · somar a taxa padrão dentro do custo direto na tela;
 *  · uma tabela de LANÇAMENTO com `delete` no grant, em qualquer migration;
 *  · tirar o `delete` de `finance.purchases`, que é a exceção declarada — uma nota errada não
 *    tem oposto e envenena toda derivação futura do custo por peça;
 *  · um formulário de dinheiro voltando a fazer `Number(v.replace(',', '.'))`, que lia `1.000`
 *    como um real e aceitava R$ 0,01 em silêncio como o valor de uma compra;
 *  · custear pela quantidade PEDIDA em vez da enviada, ou cair para o pedido quando o envio não
 *    foi informado — é a suposição que `finance.order_shipment` existe para impedir;
 *  · uma leitura de custo que devolva lista vazia quando o banco recusou — um custo zero por
 *    erro afirma que os parceiros saíram de graça, que é a única coisa que este módulo não pode
 *    dizer por engano.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { MODULES, TOGGLEABLE_MODULES, isModuleEnabled } from '@/lib/modules'
import { buildNavTree } from '@/lib/navigation/menu'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const pt = JSON.parse(read('messages/pt.json'))

function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const ROUTES = readdirSync(resolve(root, 'app/api/finance'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `app/api/finance/${entry.name}/route.ts`)

test('o módulo está registrado nos quatro lugares que decidem se ele existe', () => {
  assert.equal(MODULES.FINANCE, 'finance')
  assert.ok(
    TOGGLEABLE_MODULES.includes(MODULES.FINANCE),
    'sem isto a checkbox de /admin/users não existe e a ativação não é ativação'
  )

  // O mapa prefixo→módulo saiu de `proxy.ts` em 2026-09-01 e passou a morar em
  // `lib/navigation/access.ts`, que é o módulo que o middleware E o menu consultam.
  const access = code('lib/navigation/access.ts')
  assert.ok(
    /MODULE_PREFIXES[\s\S]*'\/finance':\s*MODULES\.FINANCE/.test(access),
    'o portao precisa deixar entrar quem tem o módulo, e barrar quem não tem'
  )
  assert.ok(
    /resolveAccess\(/.test(code('proxy.ts')),
    'e o middleware precisa perguntar a ele, em vez de reimplementar a regra'
  )

  const userForm = code('components/admin/UserFormAdmin.tsx')
  assert.ok(
    /MODULE_LABELS[\s\S]*MODULES\.FINANCE/.test(userForm),
    'um módulo toggleável sem rótulo aparece como checkbox sem nome'
  )
})

test('o portão da tela recusa exatamente quem a API recusa', () => {
  const finance = (role: string) =>
    isModuleEnabled(MODULES.FINANCE, { role, enabledModules: ['finance'] })

  assert.equal(finance('admin'), true, 'admin ignora o array por código')
  assert.equal(finance('editor'), true, "'editor' é o que `withAuth` das rotas aceita")
  assert.equal(
    finance('client'),
    false,
    'um `client` É um parceiro — o próprio sujeito dos números da tela'
  )
  assert.equal(finance('viewer'), false)

  // O piso é POR MÓDULO, nunca global: `events` e `places` sempre aceitaram qualquer não-admin
  // com a checkbox marcada, e endurecê-los expulsaria usuário que hoje entra — sem defeito que
  // tenha pedido isso.
  assert.equal(
    isModuleEnabled(MODULES.EVENTS, { role: 'viewer', enabledModules: ['events'] }),
    true
  )
  assert.equal(
    isModuleEnabled(MODULES.PLACES, { role: 'client', enabledModules: ['places'] }),
    true
  )

  // E o piso não concede nada sozinho: sem a checkbox, `editor` continua de fora.
  assert.equal(isModuleEnabled(MODULES.FINANCE, { role: 'editor', enabledModules: [] }), false)

  // O middleware delega a decisão. Se ele voltar a compará-la localmente, o piso morre sem que
  // nada mais fique vermelho — que foi exatamente como os dois portões divergiram.
  assert.ok(
    /isModuleEnabled\(MODULE_PREFIXES\[gatedPrefix\]/.test(code('lib/navigation/access.ts')),
    'o portao pergunta ao SSOT de módulos, não decide sozinho'
  )
})

test('a RPC de consumo roda como quem chama, não como quem a criou', () => {
  const files = readdirSync(resolve(root, 'supabase/migrations'))
    .filter((file) => file.includes('finance'))
    .sort()

  // A ÚLTIMA definição é a que vale no banco. Procurar a string nas migrations concatenadas
  // acharia o `security definer` da `01`, que a `09` já substituiu — e o teste passaria a
  // reprovar a correção em vez do defeito.
  const defining = files.filter((file) =>
    /create or replace function finance\.record_material_consumption/i.test(
      read(`supabase/migrations/${file}`)
    )
  )
  assert.ok(defining.length > 0, 'a RPC de consumo é definida em alguma migration')

  // Comentários de SQL são `--`, que `code()` não remove: sem tirá-los, a prova bate na prosa
  // que explica a correção.
  const sql = read(`supabase/migrations/${defining[defining.length - 1]}`).replace(
    /^\s*--.*$/gm,
    ''
  )

  assert.ok(
    !/security definer/i.test(sql),
    'o único grantee é `service_role`, que já tem `insert` próprio: o definer não concedia nada ' +
      'e só ampliava o alcance de um defeito futuro'
  )
  assert.ok(/security invoker/i.test(sql), 'ela roda com os privilégios de quem chama')
  assert.ok(
    /set search_path = ''/.test(sql),
    'caminho vazio: nada resolve por nome curto, e não sobra nome ambíguo para sequestrar'
  )
})

test('o piso de k é aplicado no servidor, e o componente só o desenha', () => {
  const service = code('lib/services/finance-service.ts')
  assert.ok(
    /suppressSmallCohortPurchases\(\{/.test(service),
    'suprimir na tela deixaria o valor exato viajando na resposta da API, onde qualquer um com ' +
      'o cookie de um editor o lê com o DevTools aberto'
  )

  // A tela LÊ a marca e não a recalcula: um segundo lugar decidindo o que é identificável é a
  // mesma divergência de portões que este arquivo já trava em `/finance`.
  for (const path of [
    'components/finance/ClientProfitabilityTable.tsx',
    'components/finance/FinanceFigures.tsx',
  ]) {
    const view = code(path)
    assert.ok(
      /purchase(Suppressed|IsFloor)/.test(view),
      `${path}: a tela precisa distinguir o piso do fato`
    )
    assert.ok(
      !/PURCHASE_MIN_COHORT|linkedByPartnerId\s*<\s*5/.test(view),
      `${path}: o componente não reimplementa o piso — ele já chegou aplicado`
    )
  }
})

test('a rota que CONCEDE o módulo é pelo menos tão forte quanto o módulo', () => {
  // Esta rota não é do financeiro, mas é a que escreve `enabled_modules` — e portanto a que
  // decide quem entra em `/finance`. Um portão de entrada mais fraco que a sala torna a força
  // da sala decorativa, e é por isso que a invariante mora aqui e não num arquivo distante.
  const grant = code('app/api/admin/users/[userId]/route.ts')

  const methods = grant.match(/export const (GET|POST|PATCH|PUT|DELETE)/g) ?? []
  const gates = grant.match(/withAuth<\{ userId: string \}>\(/g) ?? []
  assert.ok(methods.length >= 3, 'a rota exporta GET, PATCH e DELETE')
  assert.equal(gates.length, methods.length, 'um withAuth por método exportado')

  assert.ok(
    !/getSession\(\)/.test(grant),
    '`getSession()` lê o cookie sem falar com o Auth: o cabeçalho de `lib/auth-middleware.ts` ' +
      'diz em palavras que ele não pode embasar autorização, e uma sessão revogada seguia ' +
      'concedendo módulo até o cookie expirar'
  )

  assert.ok(
    /TOGGLEABLE_MODULES/.test(grant),
    '`enabled_modules` é coluna de texto: sem validar contra o catálogo, `finanace` grava em ' +
      'silêncio e a checkbox volta desmarcada sem explicação'
  )
  assert.ok(
    /MODULE_MIN_ROLES/.test(grant),
    'e sem o piso de role a rota grava `finance` num `client` — um entitlement que toda porta ' +
      'recusa, mostrado como ligado na tela de admin'
  )
})

test('`/finance` não mora sob a área de admin, onde o módulo nunca decidiria nada', () => {
  // O catálogo do menu saiu do componente em 2026-09-01. `Header.tsx` desenha; quem monta a
  // árvore é `lib/navigation/menu.ts`, e quem decide visibilidade é `canReach`.
  const menu = code('lib/navigation/menu.ts')

  assert.ok(/'\/finance'/.test(menu), 'a entrada existe')
  assert.ok(
    !/'\/admin\/finance'/.test(menu),
    'a área de admin é barrada para todo não-admin ANTES de o módulo ser consultado'
  )

  // A ENTRADA É DECIDIDA PELO ENTITLEMENT, NÃO PELO ROLE, e agora isso é provado pelo
  // COMPORTAMENTO e não por uma expressão no texto-fonte: um editor com o módulo vê a entrada,
  // e ela é a única que ele vê. Se alguém voltar a gatear por `isAdmin`, esta lista fica vazia.
  const editorComModulo = buildNavTree({
    role: 'editor',
    enabledModules: [MODULES.FINANCE],
  })
  const hrefs = [...editorComModulo.basic, ...editorComModulo.modules].flatMap((entry) =>
    entry.kind === 'link'
      ? [entry.item.href]
      : entry.group.sections.flatMap((s) => s.items.map((i) => i.href))
  )
  assert.deepEqual(
    hrefs,
    ['/finance'],
    'o dia em que um editor tiver o módulo marcado, ele precisa achar a tela'
  )

  // E o menu não carrega condição de role própria: quem responde é o portao.
  assert.ok(/canReach/.test(menu), 'a visibilidade vem de `canReach`, o mesmo que o proxy usa')
  assert.equal(
    /isAdmin\(/.test(menu),
    false,
    'um `isAdmin` aqui seria o menu decidindo sozinho de novo'
  )
})

test('toda rota do financeiro passa pelos dois portões', () => {
  assert.ok(ROUTES.length >= 5, 'as rotas do módulo existem')

  for (const path of ROUTES) {
    const source = code(path)
    const methods = source.match(/export const (GET|POST|PATCH|PUT|DELETE)/g) ?? []
    assert.ok(methods.length > 0, `${path} não exporta método nenhum`)

    const withAuth = source.match(/withAuth[<(]/g) ?? []
    const gates = source.match(/requireModule\(MODULES\.FINANCE/g) ?? []

    assert.equal(withAuth.length, methods.length, `${path}: um withAuth por método exportado`)
    assert.equal(gates.length, methods.length, `${path}: um requireModule por método exportado`)

    // `['admin']` sozinho faria o segundo portão nunca decidir nada — admin ignora
    // `enabled_modules` por código, e a ativação viraria uma chave que não liga nada.
    assert.ok(
      /roles: \['admin', 'editor'\]/.test(source),
      `${path}: o role precisa incluir 'editor' para que o módulo seja quem decide`
    )
  }
})

test('nenhuma rota grava custo de material — quem grava é a esteira', () => {
  for (const path of ROUTES) {
    const source = code(path)
    assert.ok(
      !/record_material_consumption|recordConsumption/.test(source),
      `${path}: um segundo caminho de escrita é um segundo lugar para a regra divergir`
    )
  }

  const order = code('lib/services/material-order-service.ts')
  assert.ok(
    /consumesCost\(status\)[\s\S]{0,200}recordConsumption\(orderId, status\)/.test(order),
    'o custo nasce dentro de setMaterialOrderStatus, depois de o update confirmar'
  )
  assert.ok(
    !/'dispatched'|'fulfilled'/.test(
      order.slice(order.indexOf('export async function setMaterialOrderStatus'))
    ),
    'a esteira não repete os dois nomes: quem sabe quais status custam é `consumesCost`'
  )
})

test('o custo sai do que foi ENVIADO, e nunca cai para o que foi pedido', () => {
  const consumption = code('lib/finance/consumption.ts')

  // A quantidade da linha vem do envio. Um `item.quantity` sobrevivente aqui seria a suposição
  // que o operador recusou em 2026-09-01: "não é pq um parceiro pediu 40, que enviamos os 40".
  const loop = consumption.slice(consumption.indexOf('for (const item of input.items)'))
  assert.ok(/quantity: shipped\.quantity/.test(loop), 'a linha custeia o que saiu')
  assert.ok(
    !/item\.quantity\s*\)/.test(loop.replace(/if \(item\.quantity <= 0\) continue/, '')),
    'nenhum total é multiplicado pela quantidade pedida'
  )
  assert.ok(
    /if \(!shipped\) \{[\s\S]{0,120}awaitingShipment\.push/.test(loop),
    'sem envio informado o item vira pendência, não custo'
  )
  assert.ok(
    !/shipped\s*\?\?|shipped\?\.quantity\s*\?\?/.test(loop),
    'não existe fallback do envio para o pedido'
  )
})

test('o custo fixo não tem caminho até a linha de um cliente', () => {
  const structure = code('lib/finance/structure.ts')
  assert.ok(!/clientId/.test(structure))

  const profitability = code('lib/finance/profitability.ts')
  assert.ok(
    !/fixedCost|FixedCost/.test(profitability),
    'o veredito do parceiro não pode nem enxergar custo de estrutura'
  )

  const fixedCostsRoute = code('app/api/finance/fixed-costs/route.ts')
  assert.ok(
    !/clientId/.test(fixedCostsRoute),
    'a rota de custo fixo não aceita cliente — rateio por cliente é a distorção que MC I evita'
  )
})

test('a taxa padrão nunca entra no custo direto, nem no cálculo nem na tela', () => {
  const consumption = code('lib/finance/consumption.ts')
  const direct = consumption.slice(consumption.indexOf('export function lineDirectCostCents'))
  assert.ok(
    !/standardCost/.test(direct),
    'lineDirectCostCents soma peças e componentes, e nada mais'
  )

  const table = code('components/finance/ClientProfitabilityTable.tsx')
  assert.ok(
    /directCostCents[\s\S]*standardCostCents/.test(table),
    'a tela mostra os dois lado a lado, em colunas separadas'
  )
  assert.ok(
    !/directCostCents\s*\+\s*\w*[Ss]tandard/.test(table),
    'e nunca os soma'
  )
})

test('nada na Fase 1 converte minutos comprados em dinheiro', () => {
  const surfaces = [
    'lib/finance/profitability.ts',
    'lib/finance/summary.ts',
    'lib/services/finance-service.ts',
    'components/finance/ClientProfitabilityTable.tsx',
    'components/finance/FinanceFigures.tsx',
  ]

  for (const path of surfaces) {
    const source = code(path)
    assert.ok(
      !/(minutes\w*\s*\*\s*\w*(cent|price|rate|valor))|((cent|price|rate)\w*\s*\*\s*\w*minutes)/i.test(
        source
      ),
      `${path}: o valor em dinheiro da compra do app não existe no CMS (BR-MONETIZACAO-048)`
    )
  }

  // E a tela diz isso em palavras, para ninguém ler a contagem como receita.
  assert.ok(
    typeof pt.Finance.summary.minutesHint === 'string' && pt.Finance.summary.minutesHint.length > 0,
    'a ressalva dos minutos é texto na tela, não só um comentário no código'
  )
})

test('nenhum formulário converte dinheiro à mão', () => {
  for (const file of ['CatalogPanel.tsx', 'StructurePanel.tsx']) {
    const source = code(`components/finance/${file}`)
    assert.ok(
      !/replace\(\s*','\s*,\s*'\.'\s*\)/.test(source),
      `${file}: a conversão de reais para centavos tem um dono, e é parseMoneyToCents`
    )
    assert.ok(
      /parseMoneyToCents\(/.test(source),
      `${file}: todo campo de dinheiro passa pelo parser`
    )
  }
})

test('nenhuma leitura de custo transforma um erro do banco em lista vazia', () => {
  const service = code('lib/services/finance-service.ts')

  for (const fn of [
    'loadCatalog',
    'loadPurchases',
    'loadConsumption',
    'loadCostEntries',
    'loadOrderShipments',
  ]) {
    const start = service.indexOf(`function ${fn}(`)
    assert.ok(start > 0, `${fn} existe`)
    const body = service.slice(start, start + 1400)
    assert.ok(
      /if \(error\) return null|if \(products\.error/.test(body),
      `${fn} precisa devolver null quando o banco recusa, nunca uma lista vazia`
    )
  }

  // E a gravação do custo recusa escrever quando não pôde ler o preço: o `unique` tornaria a
  // linha sem preço permanente, e um erro de dois segundos congelaria o custo para sempre.
  assert.ok(
    /if \(!catalog \|\| !purchases \|\| shipments === null\) return null/.test(service),
    'recordConsumption não grava nada quando catálogo, compras ou envios não responderam'
  )
})

test('toda linha de lançamento é auditada, e nenhuma pode ser apagada', () => {
  // TODAS as migrations do financeiro, e não só a primeira: um `grant delete` numa migration
  // posterior é exatamente como esta invariante morreria sem ninguém notar.
  const files = readdirSync(resolve(root, 'supabase/migrations')).filter((file) =>
    file.includes('finance')
  )
  const migrations = files.map((file) => read(`supabase/migrations/${file}`)).join('\n')
  assert.ok(files.length > 0, 'as migrations do financeiro existem')

  // As tabelas de LANÇAMENTO. Uma linha apagada aqui faz o total de um parceiro mudar sem nada
  // explicar, e o log de auditoria passaria a apontar para uma linha que não existe mais.
  // `material_consumption` saiu desta lista em 2026-09-01, e a exceção é estreita: ela é uma
  // DERIVAÇÃO (pedido × envio × regras), não um lançamento digitado, e quando o envio de um
  // produto vai a zero a linha dele não é custo errado — é consumo que não houve. Só
  // `recomputeConsumption` apaga, e o teste seguinte garante que nenhuma rota o faça.
  for (const table of ['standard_rates', 'fixed_costs', 'client_cost_entries']) {
    assert.ok(
      !new RegExp(`grant[^;]*delete[^;]*on finance\\.${table}`, 'i').test(migrations),
      `finance.${table} não pode conceder delete: corrigir um lançamento é lançar o oposto`
    )
  }

  // `purchases` é a EXCEÇÃO, e ela é declarada numa migration própria que explica por quê: uma
  // compra é o registro de uma nota, não tem oposto (não se compra menos uma bobina), e uma nota
  // errada não erra uma linha — envenena toda derivação futura do custo por peça.
  assert.ok(
    /grant delete on finance\.purchases to service_role/.test(migrations),
    'a compra precisa ser corrigível — ver 20260901_04_finance_purchase_edit.sql'
  )

  for (const path of ROUTES) {
    const source = code(path)
    if (!/export const (POST|PATCH|PUT|DELETE)/.test(source)) continue
    assert.ok(
      /logAuditEvent\(/.test(source),
      `${path}: toda escrita de dinheiro deixa quem e quando`
    )
    // A porta de `delete` em custo apurado é uma só, e não é uma rota.
    assert.ok(
      !/from\('material_consumption'\)[\s\S]{0,80}\.delete\(/.test(source),
      `${path}: nenhuma rota apaga custo apurado — só o recálculo explícito`
    )
  }

  const service = code('lib/services/finance-service.ts')
  const deletions = service.match(/from\('material_consumption'\)\s*\.delete\(/g) ?? []
  assert.equal(
    deletions.length,
    1,
    'existe exatamente uma porta de delete em material_consumption, dentro de recomputeConsumption'
  )
  // E ela está DENTRO do recálculo: qualquer delete que apareça antes daquela função é um
  // segundo caminho para apagar custo apurado, que é o que esta invariante existe para impedir.
  const deleteAt = service.search(/from\('material_consumption'\)\s*\.delete\(/)
  assert.ok(
    deleteAt > service.indexOf('export async function recomputeConsumption'),
    'a única porta de delete está dentro de recomputeConsumption'
  )
})

test('os sete vereditos têm rótulo e explicação em texto', () => {
  const verdicts = [
    'uncosted',
    'undated',
    'no_return',
    'unknown_return',
    'non_monetary_return',
    'payback_pending',
    'profitable',
  ]

  for (const verdict of verdicts) {
    assert.ok(pt.Finance.verdict[verdict], `falta o rótulo de ${verdict}`)
    assert.ok(pt.Finance.verdictHint[verdict], `falta a explicação de ${verdict}`)
  }

  const badge = code('components/finance/VerdictBadge.tsx')
  // DS-A11Y-003: todo estado é texto. Quem não enxerga a cor lê o mesmo veredito.
  assert.ok(/t\(`verdict\.\$\{verdict\}`\)/.test(badge), 'o veredito é impresso como texto')
  assert.ok(/sr-only/.test(badge), 'e a diferença entre dois vereditos chega a quem usa leitor')
})

test('o rótulo micro-caps do financeiro usa a tinta que passa AA', () => {
  // Divergência D-C, medida em 2026-08-17: `text-gray-400` sobre o painel mede 2,51:1 e reprova
  // SC 1.4.3; `text-gray-500` mede 4,83:1. 10px não é texto grande sob nenhuma leitura.
  for (const file of readdirSync(resolve(root, 'components/finance'))) {
    const source = read(`components/finance/${file}`)
    // `dark:text-gray-400` é legítimo — #9CA3AF sobre gray-900 passa com folga. O que reprova
    // é a tinta CLARA, então o lookbehind exclui o par escuro em vez de proibir a classe.
    const offenders = source.match(/text-\[10px\][^"'`]*(?<!dark:)text-gray-400/g) ?? []
    assert.deepEqual(offenders, [], `${file}: rótulo de 10px em text-gray-400 reprova AA`)
  }
})
