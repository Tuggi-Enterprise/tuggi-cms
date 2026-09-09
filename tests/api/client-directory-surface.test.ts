/**
 * The unified list, from the spine to the screen — one row per establishment, one rail, and no
 * second derivation of anything.
 *
 * WHAT WAS TRUE BEFORE. `/admin/clients` listed `partner.clients`; `/admin/partnerships` listed
 * `partner.partner_form_submissions`. A promoted proposal was a row in both, described by two
 * vocabularies, and a client somebody registered by hand was invisible in the queue. The two
 * screens each had a loader, so the same partnership could be `client_created` in one and
 * something else in the other.
 *
 * WHAT THE ASSERTIONS HOLD. There is ONE loader — the queue is a filter over the directory,
 * not a second assembly — and the list screen renders one component that reads one endpoint.
 * `ClientsListAdmin` is gone rather than left behind: a screen with no route is an orphan, and
 * an orphan that still fetches is worse than dead code (CLAUDE.md §6).
 *
 * Mutations that turn this suite red:
 *  · giving the queue its own assembly again;
 *  · filtering rows inside the endpoint, which would make the facet counts lie;
 *  · dropping `country` or `client_type` from the columns the directory decides with;
 *  · leaving a client with no proposal out of the list.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const messages = (locale: string) => JSON.parse(read(`messages/${locale}.json`))

const SERVICE = 'lib/services/partnership-service.ts'
const SCREEN = 'components/admin/clients/ClientDirectory.tsx'
const BOARD = 'components/admin/clients/ClientBoard.tsx'
const RAIL = 'components/admin/clients/DirectoryFilterRail.tsx'
const READ = 'lib/hooks/use-client-directory.ts'

test('one loader, because there is one list', () => {
  const service = read(SERVICE)

  // `loadPartnershipQueue` was a second assembly of the same rows, feeding a second screen.
  // Both are gone: the working set is `/admin/clients?state=in_progress`, a filter of this one.
  assert.equal(
    service.indexOf('loadPartnershipQueue'),
    -1,
    'a second assembly is how two screens end up disagreeing about the same partnership'
  )
  assert.equal(service.indexOf('PartnershipQueueRow'), -1)

  // The state is derived in exactly two places here — once per row shape the directory builds
  // (the proposal-backed rows and the clients no proposal claims), both inside the one loader.
  const directory = service.slice(service.indexOf('export async function loadClientDirectory'))
  assert.equal(
    (service.match(/derivePipelineState\(/g) ?? []).length,
    (directory.match(/derivePipelineState\(/g) ?? []).length,
    'nothing outside the directory loader derives a pipeline state'
  )
})

test('a client no proposal claims is still a row — the half the queue could not show', () => {
  const service = read(SERVICE)
  const directory = service.slice(service.indexOf('export async function loadClientDirectory'))

  // Every client, not only the promoted ones. The cap is the directory's, and the function
  // applies it — `cms_client_directory` selects `partner.clients` whole under `client_limit`.
  assert.match(service, /client_limit: DIRECTORY_CLIENT_CAP/, 'every client, not only the promoted ones')
  assert.match(directory, /indexClients\(payload\.clients/)
  assert.match(directory, /const claimed = new Set\(/)
  assert.match(directory, /if \(claimed\.has\(client\.id\)\) continue/)
  // Its state comes from the same pure function, fed by the client's OWN conference.
  //
  // It used to be fed `EMPTY_CONFERENCE`, on the premise that a client without a proposal had
  // nothing conferred — true only because there was nowhere to record it. Since 2026-08-21 the
  // conference is a fact about the client (`partner.client_conferences`), so the premise is
  // gone: reading a constant here would pin every directly registered client at `in_conference`
  // while the detail screen showed the conference it actually has.
  assert.match(
    directory,
    /proposalStatus: 'promoted',\s*conference: \(conferences\.get\(client\.id\) \?\? NO_CONFERENCE\)\.conference,/
  )
})

test('the directory decides with country and client_type, and says so in its columns', () => {
  const service = read(SERVICE)
  const columns = /const CLIENT_COLUMNS =\s*([\s\S]*?)\n\n/.exec(service)
  assert.ok(columns, 'the allowlist is still declared in one place')
  for (const column of ['country', 'client_type', 'city', 'state']) {
    assert.ok(
      columns![1].indexOf(column) >= 0,
      `\`${column}\` is a filter of the rail and must be read`
    )
  }
})

test('the columns the rail filters by are the ones the directory function selects', () => {
  // `CLIENT_COLUMNS` above is the DETAIL path's allowlist; the list reads through
  // `partner.cms_client_directory`, whose own `SELECT` is the allowlist for this screen. A
  // column dropped there is a facet that silently stops offering options — the failure mode is
  // an empty dimension, which looks exactly like a dimension nobody filled in.
  const sql = read('supabase/migrations/20260909_02_client_directory_refusals_ssot.sql')
  const cte = /c AS \(\s*SELECT([\s\S]*?)FROM partner\.clients/.exec(sql)
  assert.ok(cte, 'the client CTE is still readable from the migration')
  for (const column of ['country', 'client_type', 'city', 'state', 'status', 'monthly_fee_cents']) {
    assert.ok(cte![1].indexOf(column) >= 0, `\`${column}\` decides a facet and must be selected`)
  }

  // And the refusal travels with its id, which the act that stops the 72h clock posts.
  assert.match(sql, /'id',\s+x\.id/)
})

test('the endpoint returns the rows whole — filtering there would make the counts lie', () => {
  const route = read('app/api/admin/clients/directory/route.ts')
  assert.match(route, /withAuth\(\{ roles: \['admin'\] \}/)
  assert.match(route, /loadClientDirectory\(auth\.supabase\)/)
  // No `?country=`, no `?state=`: the facet counts are computed over the same set the table
  // renders, which is only possible if the screen holds all of it.
  assert.equal(route.indexOf('searchParams'), -1)
})

test('the screen reads one endpoint and decides nothing on its own', () => {
  // ONE READ FOR BOTH VIEWS since #409. The endpoint moved out of the table and into the hook
  // the table and the board share — without it, switching Quadro/Tabela re-fetched a thousand
  // rows and an act on a card could not invalidate the list behind it. The guarantee is
  // unchanged: one endpoint, and neither view calls it itself.
  const hook = read(READ)
  assert.match(hook, /DIRECTORY_ENDPOINT = '\/api\/admin\/clients\/directory'/)
  assert.match(hook, /fetch\(DIRECTORY_ENDPOINT\)/)

  for (const view of [SCREEN, BOARD]) {
    assert.equal(read(view).includes("fetch('/api/admin/clients"), false, `${view} must not fetch`)
  }

  const screen = read(SCREEN)
  assert.match(screen, /buildDirectoryView\(rows, filters\)/)

  /*
   * THE PAGE IS A SLICE OF THE VIEW, and that is the whole claim of this line.
   *
   * The table paged on 2026-08-24, and the danger of paging is a second source of truth: a screen
   * that re-filtered, re-sorted or re-fetched to build its page would leave the rail counting one
   * set and the rows showing another — the defect `directory-filter`'s own header was written
   * about. `view.rows.slice` is the only way rows may leave the view.
   */
  assert.match(screen, /view\.rows\.slice\(/)
  assert.match(screen, /pageRows\.map/)
  assert.equal(
    screen.indexOf('rows.filter('),
    -1,
    'the screen must not narrow the set on its own — buildDirectoryView decides'
  )
  // The overdue counter reads the WHOLE set: it exists to reach rows the filter is hiding.
  assert.match(screen, /overdueCount\(rows\)/)

  // The counts on the rail and the rows in either view come from the same call: the rail is
  // handed the view, it does not build one of its own.
  const rail = read(RAIL)
  assert.match(rail, /view\.facets\[key\]/)
  assert.equal(
    rail.includes('buildDirectoryView('),
    false,
    'the rail must not filter on its own'
  )

  // The board hands the rail the SAME view it bucketed into columns.
  const board = read(BOARD)
  assert.match(board, /buildBoardView\(rows, filters/)
  assert.match(board, /view=\{board\.directory\}/)
  assert.match(board, /overdueCount\(rows\)/)
})

test('the old client list is gone, not left behind', () => {
  assert.equal(
    existsSync(resolve(root, 'components/admin/ClientsListAdmin.tsx')),
    false,
    'a screen with no route is an orphan (CLAUDE.md §6)'
  )
})

test('the rail speaks the esteira’s language, and the esteira is Portuguese', () => {
  // IT USED TO BE TRANSLATED, and the seam landed inside a card: `Proposta recebida` over
  // `Proposal, not registered yet` over `Open`. The pipeline vocabulary was already pt-only by
  // decision (#408); the rail describes the same pipeline, so it is pt too. What stayed
  // translated is the CLIENT's own record — a different object with a different owner.
  const directory = messages('pt').Clients.directory
  assert.equal(typeof directory.title, 'string')
  for (const key of ['country', 'region', 'city', 'clientType', 'status', 'contract', 'state']) {
    assert.equal(typeof directory.filters[key], 'string', `the ${key} facet needs a label`)
  }
  for (const key of ['none', 'draft', 'sent', 'signed']) {
    assert.equal(typeof directory.contractValues[key], 'string')
  }

  // Overlaid by the host rather than copied into en/es — the full assertion, including the
  // proof that nothing outside the esteira reads these namespaces, is in
  // `client-board-surface.test.ts`.
  const host = read('components/admin/AdminClientsPageContent.tsx')
  assert.match(host, /Partnerships: ptMessages\.Partnerships,/)
  assert.match(host, /directory: ptMessages\.Clients\.directory,/)
  for (const locale of ['en', 'es']) {
    assert.equal('Partnerships' in messages(locale), false, `${locale} must not carry the namespace`)
    assert.equal('directory' in messages(locale).Clients, false, `${locale} must not fork the rail`)
  }
})

// ── The search field does not write the URL once per keystroke ────────────────────────────────

test('the search box types locally and reaches the URL once the typing stops', () => {
  // Reported on 2026-09-09: "a busca é lenta e não responde corretamente". Bound straight to
  // `filters.search`, every character ran `router.replace()` — an App Router navigation each
  // fetching the route's RSC payload — so letters arrived late and out of order.
  const rail = readFileSync(
    resolve(import.meta.dirname, '../../components/admin/clients/DirectoryFilterRail.tsx'),
    'utf8'
  )

  // The field holds its own letters...
  assert.match(rail, /const \[text, setText\] = useState\(value\)/)
  assert.match(rail, /onChange=\{\(event\) => setText\(event\.target\.value\)\}/)
  // ...and commits on a timer, through a ref — as a dependency the callback is rebuilt every
  // render, the timer restarts, and the term would never be committed at all.
  assert.match(rail, /setTimeout\(\(\) => commit\.current\(text\), 250\)/)
  // The URL still wins when it changes from anywhere else, or the rail and the sheet would
  // disagree about what is typed in the one filter they share. Adjusted during render rather
  // than in an effect, which would paint the stale term once first.
  assert.match(rail, /if \(known !== value\) \{/)

  // And nothing writes the filter straight from a keystroke any more. `filters.search` is still
  // handed to the field — it is the value the URL owns — but it reaches it as a prop to sync
  // from, not as the input's bound value.
  assert.equal(rail.indexOf("set('search', event.target.value)"), -1)
  assert.match(rail, /<SearchField/)
  assert.match(rail, /onCommit=\{\(next\) => set\('search', next\)\}/)
})

// ── O que abre por cima da lista é um diálogo, e há um só jeito de sê-lo ──────────────────────

test('the client record is a dialog, and the sheet beside it uses the same four behaviours', () => {
  const modal = read('components/admin/clients/ClientEditorModal.tsx')
  const rail = read('components/admin/clients/DirectoryFilterRail.tsx')
  const shell = read('lib/hooks/use-dialog-shell.ts')

  // The record covers the list. Until 2026-09-09 it carried none of this: a screen reader read
  // the board behind it as part of the same document, and `Escape` did nothing.
  assert.match(modal, /role="dialog"/)
  assert.match(modal, /aria-modal="true"/)
  // Named by the header's own `h2` rather than by a second copy of the partner's name.
  assert.match(modal, /aria-labelledby=\{titleId\}/)
  assert.match(modal, /id=\{titleId\}/)

  // ONE implementation of the four behaviours, for both surfaces. The sheet had three of them
  // written inline and the record had none — which is how the screen ended up with the correct
  // pattern next to the missing one.
  for (const [name, source] of [['modal', modal], ['rail', rail]] as const) {
    assert.match(source, /useDialogShell\(/, `${name} has to go through the one hook`)
  }
  assert.equal(
    rail.indexOf("document.body.style.overflow = 'hidden'"),
    -1,
    'the inline copy is gone, or the two drift'
  )

  // And the hook owes all four, including the one neither surface had: focus goes back to
  // whatever opened the dialog, or the operator is returned to the top of the document.
  assert.match(shell, /document\.body\.style\.overflow = 'hidden'/)
  assert.match(shell, /event\.key === 'Escape'/)
  assert.match(shell, /initialFocusRef\.current\?\.focus\(\)/)
  assert.match(shell, /if \(opener\?\.isConnected\) opener\.focus\(\)/)

  // No hand-rolled Tab trap: `aria-modal` is what makes the outside inert, and a trap that gets
  // a corner wrong locks the keyboard in with no way out.
  assert.equal(shell.indexOf("'Tab'"), -1)
})

// ── O painel de filtros: campo de seleção, contagem na opção, fichas do lado de fora ─────────

test('every dimension is a native select, in four sections, work first', () => {
  const rail = read('components/admin/clients/DirectoryFilterRail.tsx')

  // Queixa 5 do operador em 2026-09-09. O custo do painel antigo era VERTICAL e crescia com o
  // número de VALORES: `cidade` sozinha imprimia quatro botões para uma cidade real.
  assert.match(rail, /<select/)
  assert.equal(rail.indexOf('FacetOptionButton'), -1, 'a pilha de botões saiu inteira')

  // Nativo, e não uma caixa de listagem própria: teclado, digitação por primeiras letras e o
  // seletor do sistema no telefone vêm de graça — e é por isso que `mais N` e a procura interna
  // do desenho anterior não existem.
  assert.equal(rail.indexOf('role="listbox"'), -1)

  // Quatro seções, e `Trabalho` primeiro. `Em andamento` era a primeira opção da ÚLTIMA seção.
  const sections = /const SECTIONS: PanelSection\[\] = \[([\s\S]*?)\n\]/.exec(rail)
  assert.ok(sections, 'as seções são declaradas em um lugar só')
  const ids = Array.from(sections![1].matchAll(/id: '(\w+)'/g)).map((match) => match[1])
  assert.deepEqual(ids, ['work', 'commercial', 'where', 'type'])

  // `Estado da parceria` separa recorte de etapa, ou `Em andamento` lê como uma décima primeira
  // etapa.
  assert.match(rail, /<optgroup label=\{t\('stateGroups\.cuts'\)\}>/)
  assert.match(rail, /<optgroup label=\{t\('stateGroups\.stage'\)\}>/)
})

test('the count is inside the option, including the one that does not filter', () => {
  const rail = read('components/admin/clients/DirectoryFilterRail.tsx')
  assert.match(rail, /return `\$\{label\} \(\$\{count\}\)`/)
  // `Todas as cidades (36)` — a resposta de "quanto tem no total" tem de existir ANTES da
  // escolha, que é o que o controle fechado esconderia.
  assert.match(rail, /withCount\(t\(`allOf\.\$\{key\}`\), totalOf\(view\.facets\[key\]\)\)/)

  const directory = messages('pt').Clients.directory
  for (const key of ['country', 'region', 'city', 'clientType', 'status', 'contract', 'plan']) {
    assert.equal(typeof directory.allOf[key], 'string', `\`${key}\` não tem opção neutra`)
  }
  for (const id of ['work', 'commercial', 'where', 'type']) {
    assert.equal(typeof directory.sections[id], 'string', `a seção \`${id}\` não tem nome`)
  }
})

test('what is applied stays visible without opening anything', () => {
  // A única perda real do controle fechado: no painel antigo a opção ligada ficava sublinhada e
  // em negrito, e o operador via tudo de relance. Por isso a linha de fichas é obrigatória.
  const chips = read('components/admin/clients/ActiveFilterChips.tsx')

  // Dimensão E valor: `Minas` sozinho não diz se é o estado do cadastro ou o da parceria.
  assert.match(chips, /\$\{t\(`filters\.\$\{key\}`\)\}: \$\{valueLabel\(key, String\(value\)\)\}/)
  // A busca conta como ficha, pela mesma razão que conta em `activeFilterCount`.
  assert.match(chips, /activeFilters\.searchLabel/)
  // Remover devolve o campo a "todas" — e `state` é a única dimensão cujo "sem filtro" é um valor.
  assert.match(chips, /key === 'state' \? 'all' : null/)

  // As duas vistas mostram a linha, e ela leva a contagem do resultado.
  for (const view of ['ClientBoard', 'ClientDirectory']) {
    const source = read(`components/admin/clients/${view}.tsx`)
    assert.match(source, /<ActiveFilterChips/, `${view} tem de mostrar o que está aplicado`)
    assert.match(source, /result=\{[cp]?t?\(?'?results'?/, `${view} leva a contagem para a linha`)
  }
})

test('the board has no rail, which is what gives it back its columns', () => {
  const board = read('components/admin/clients/ClientBoard.tsx')
  // `cms-width` limita a página a 1600px e o trilho tomava 18% dela, então a área de raias ficava
  // presa em ~1280px em QUALQUER monitor — 4 das 8 colunas. Bancada que rola de lado não quer
  // medida de leitura.
  assert.equal(board.indexOf('<DirectoryFilterRail'), -1)
  assert.match(board, /<DirectoryFilterSheet[\s\S]*?everyWidth/)
  assert.equal(board.indexOf('lg:w-[82%]'), -1)

  // Na tabela o trilho fica, como na `/pois`.
  assert.match(read('components/admin/clients/ClientDirectory.tsx'), /<DirectoryFilterRail/)
})
