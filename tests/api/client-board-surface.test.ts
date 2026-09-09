/**
 * The board's wiring — #409. What the pure suite proves about the RULE, this proves about the
 * SCREEN: which module decides what, which one is allowed to fetch, and that the drag never
 * became the only way to do anything.
 *
 * Mutations that turn this suite red:
 *  · making `?view=board` a written value, which would put it in every clean URL and break
 *    `Limpar filtros` emptying the address bar;
 *  · giving the board its own fetch or its own filtering, which makes the rail count one set
 *    and the columns render another;
 *  · letting the board decide a transition inline instead of calling `planTransition`;
 *  · adding a `BoardAct` with no button in the card (WCAG 2.2 SC 2.5.7) or no message;
 *  · putting the pipeline vocabulary into en/es, which is pt-only by decision (#408).
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

import { BOARD_COLUMNS, TERMINAL_COLUMNS, COLUMN_STATES } from '@/lib/clients/board-transitions'
import { CLIENT_DIRECTORY_PATH } from '@/lib/clients/directory-filter'
import { IN_PROGRESS_STATES } from '@/lib/partnerships/pipeline'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const messages = (locale: string) => JSON.parse(read(`messages/${locale}.json`))

const BOARD = 'components/admin/clients/ClientBoard.tsx'
const CARD = 'components/admin/clients/board/BoardCard.tsx'
const SWITCH = 'components/admin/clients/ViewSwitch.tsx'
const HOST = 'components/admin/AdminClientsPageContent.tsx'
const ACTS = 'lib/hooks/use-board-acts.ts'
const RULE = 'lib/clients/board-transitions.ts'

/** The source without its comments — a ruler that reads prose measures the prose. */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

test('#409 · the board is the default, and only `view=table` is ever written', () => {
  const view = code(SWITCH)
  assert.match(view, /export const VIEW_PARAM = 'view'/)
  assert.match(view, /export const TABLE_VIEW = 'table'/)
  // Anything that is not `table` — including nothing at all — is the board.
  assert.match(view, /return param !== TABLE_VIEW/)

  const host = code(HOST)
  assert.match(host, /const board = isBoardView\(searchParams\.get\(VIEW_PARAM\)\)/)
  // Switching TO the board deletes the parameter rather than writing a default into the URL.
  assert.match(host, /if \(toBoard\) params\.delete\(VIEW_PARAM\)/)

  // `view` is deliberately NOT a filter: `applyFilters` copies the whole query and touches only
  // the keys it knows, so the view survives narrowing the rail without either module knowing
  // about the other.
  assert.equal(
    code('lib/clients/directory-filter.ts').indexOf("view: 'view'"),
    -1,
    'the view is not a filter and must not enter PARAM_KEYS'
  )
})

test('#409 · one read, one filter: the board owns neither', () => {
  const board = code(BOARD)
  assert.equal(board.indexOf('fetch('), -1, 'the board reads through the shared hook')
  assert.equal(
    board.indexOf('buildDirectoryView('),
    -1,
    'the board must not filter on its own — the rail would count a different set'
  )
  // `{ shown }` since 2026-08-24, when the terminal columns stopped collapsing and started
  // windowing. The assertion is the same one it always was — the board hands `buildBoardView`
  // the rows and the filters and adds only its own view state.
  assert.match(board, /buildBoardView\(rows, filters, \{ shown \}\)/)
  assert.match(board, /view=\{board\.directory\}/, 'the rail is handed the view the columns came from')
})

test('#409 · every transition goes through the pure rule, and no route is called around it', () => {
  const board = code(BOARD)
  assert.match(board, /const plan = planTransition\(row, from, to\)/)
  assert.match(board, /if \(plan\.kind === 'act'\) \{\s*onAct\(row, plan\.act\)/)

  // No optimistic move: the column is derived, so the only thing that moves a card is the list
  // being read again.
  assert.equal(board.indexOf('setRows'), -1)

  // The board names no endpoint at all — every request lives in the act runner.
  assert.equal(board.indexOf('/api/'), -1, 'the board must not carry a route literal')
  assert.match(code(ACTS), /\/api\/admin\/clients\/\$\{row\.clientId\}\/contract/)
})

test('#409 · WCAG 2.2 SC 2.5.7 — every act is a button on the card, not only a gesture', () => {
  const card = code(CARD)
  assert.match(card, /const act = nextAct\(row, column\)/)
  assert.match(card, /t\(`acts\.\$\{act\}`\)/)
  // The card renders without the drag library: the gesture is layered on top, which is what
  // keeps the button the path that always exists.
  assert.equal(card.indexOf('@dnd-kit'), -1)

  // And the gesture never overwrites the card's own role — `attributes` carries `role="button"`,
  // which would turn every row of the board into a button with a name and no structure.
  assert.equal(code(BOARD).indexOf('...attributes'), -1)
})

test('#409 · every column, act and refusal reason has Portuguese copy', () => {
  const board = messages('pt').Clients.board

  for (const column of BOARD_COLUMNS) {
    assert.equal(typeof board.columns[column], 'string', `${column} has no label`)
    assert.equal(typeof board.columnHints[column], 'string', `${column} has no hint`)
  }

  // Every act the rule can produce, and every reason it can refuse with, read from the UNIONS
  // in the module itself rather than from a list here that would age separately.
  // Comments stripped first: the union's own docblocks quote route bodies like
  // `{action:'send'}`, and a ruler that reads prose would measure the prose.
  const rule = code(RULE).replace(/\n{2,}/g, '\n\n')
  const union = (name: string) => {
    const block = new RegExp(`export type ${name} =([\\s\\S]*?)\n\n`).exec(rule)
    assert.ok(block, `${name} has to be readable from the source`)
    const members = Array.from(block![1].matchAll(/'(\w+)'/g)).map((match) => match[1])
    assert.ok(members.length > 0, `${name} looks empty`)
    return members
  }

  for (const act of union('BoardAct')) {
    assert.equal(typeof board.acts[act], 'string', `\`${act}\` has no copy in Clients.board.acts`)
  }
  for (const reason of union('BlockReason')) {
    assert.equal(
      typeof board.blocked[reason],
      'string',
      `\`${reason}\` has no copy in Clients.board.blocked`
    )
  }

  for (const key of ['backwards', 'notAdjacent', 'alertTitle', 'alertBody', 'countTruncated']) {
    assert.equal(typeof board[key], 'string', `${key} is missing`)
  }
})

test('#409 · the money line names its source, and the rail filters what decides the money', () => {
  const board = messages('pt').Clients.board.plan
  const directory = messages('pt').Clients.directory

  // Every shape `planLine` can produce has copy, and each one that is not self-describing
  // carries where the answer came from.
  for (const key of ['paid', 'courtesy', 'undeclared', 'free', 'requestedMapOnly', 'requestedMapAndDescription', 'requestedNone']) {
    assert.equal(typeof board[key], 'string', `plan.${key} is missing`)
  }
  for (const key of ['fromContract', 'fromRegistration', 'courtesyReason', 'divergesFree', 'divergesUndeclared']) {
    assert.equal(typeof board[key], 'string', `plan.${key} is missing`)
  }

  // The rail offers the REGISTRATION's three states — the reading that decides whether
  // publishing may be offered (BR-B2B-017, item 6) — and not the contract's tier.
  assert.equal(typeof directory.filters.plan, 'string')
  for (const value of ['paid', 'courtesy', 'undeclared']) {
    assert.equal(typeof directory.planValues[value], 'string', `planValues.${value} is missing`)
  }

  // The card reads the pure rule; it does not re-derive who pays from the row's fields.
  const card = code(CARD)
  assert.match(card, /derivePartnerPlan\(row\)/)
  assert.equal(card.indexOf('isCourtesy'), -1, 'the card must not read the fee directly')
  assert.equal(card.indexOf('monthlyFeeCents'), -1)

  // And the currency comes from the one formatter the publication panel already uses: two of
  // them is how the same fee ends up printed two ways (BR-B2B-017, 1st edge case).
  const text = code('components/admin/clients/board/row-text.ts')
  assert.match(text, /formatMonthlyFee\(/)
  assert.equal(text.indexOf('toLocaleString'), -1, 'no second currency formatter')

  // THE SNAPSHOT STAYS OUT OF THE LIST. `partner_contracts.snapshot` carries the legal name,
  // the address and the representative of every partner; the directory reads `tier`, a column,
  // because that is all the label needs.
  const service = code('lib/services/partnership-service.ts')
  assert.match(service, /\.select\('id, client_id, status, tier, created_at'\)/)
  assert.equal(service.indexOf("'snapshot'"), -1, 'the list endpoint must not carry snapshots')
})

test('#409 · the whole esteira is Portuguese — the seam is between screens, not inside a card', () => {
  // THE DEFECT THIS REPLACES was measured on screen: with `Clients.directory` translated and
  // `Partnerships` overlaid, one card read `Proposta recebida` over `Proposal, not registered
  // yet` over `Open`. A locale boundary that falls in the middle of a card is not a
  // translation, it is a defect — so the three namespaces the esteira speaks are pt, and the
  // rest of `Clients` (the editor, the fiscal tab, the team) stays translated.
  for (const locale of ['en', 'es']) {
    const bundle = messages(locale)
    assert.equal(bundle.Partnerships, undefined, `${locale} must not carry the pipeline vocabulary`)
    for (const namespace of ['directory', 'board']) {
      assert.equal(
        bundle.Clients[namespace],
        undefined,
        `${locale} must not carry Clients.${namespace} — it never renders, and a namespace nobody reads is an orphan`
      )
    }
    // The client's own record IS translated: it is not the pipeline.
    for (const namespace of ['editor', 'profile', 'fiscal', 'team']) {
      assert.equal(typeof bundle.Clients[namespace], 'object', `${locale} must keep Clients.${namespace}`)
    }
  }

  // WHICH IS ONLY SAFE BECAUSE THE HOST OVERLAYS ALL THREE. Miss one and the operator on `en`
  // reads raw message keys across a whole screen.
  const host = code(HOST)
  assert.match(host, /Partnerships: ptMessages\.Partnerships,/)
  assert.match(host, /directory: ptMessages\.Clients\.directory,/)
  assert.match(host, /board: ptMessages\.Clients\.board,/)

  // And nothing outside the esteira reads those two namespaces, which is what makes the
  // overlay total rather than a fallback with holes in it.
  const readers = execSync(
    "grep -rl \"useTranslations('Clients.directory')\\|useTranslations('Clients.board')\" components app lib || true",
    { cwd: root, encoding: 'utf8' }
  )
    .split('\n')
    .filter(Boolean)
    .sort()
  assert.deepEqual(readers, [
    'components/admin/clients/ClientBoard.tsx',
    'components/admin/clients/ClientDirectory.tsx',
    'components/admin/clients/DirectoryFilterRail.tsx',
    'components/admin/clients/ViewSwitch.tsx',
    'components/admin/clients/board/BoardCard.tsx',
    'components/admin/clients/board/BoardColumn.tsx',
  ])

  // `contract_sent` is a state, so its label and its next step live with the rest of them.
  const partnerships = messages('pt').Partnerships
  assert.equal(typeof partnerships.states.contract_sent, 'string')
  assert.equal(typeof partnerships.nextSteps.contract_sent, 'string')
})

// ── The front door ───────────────────────────────────────────────────────────────────────────

/**
 * THE TEST THAT WAS MISSING, and the reason the one above it was not enough.
 *
 * On 2026-08-24 the terminal columns stopped collapsing and started windowing, and every test
 * written for it mounted the board with `EMPTY_FILTERS` — which is not how anybody arrives. The
 * nav link carried `?state=in_progress`, and `IN_PROGRESS_STATES` excludes `published`,
 * `discarded` and `refused_at_triage`: precisely the three states of the two columns the change
 * was about. The mechanism was correct and the screen was unchanged, because the way IN filtered
 * the rows out before the board ever saw them.
 *
 * So this asserts the relationship rather than the string: no link into the list may carry a
 * `state` filter that empties a board column. It fails whether somebody re-adds `in_progress` to
 * the nav, or moves a state out of `IN_PROGRESS_STATES` into a terminal column, or adds a third
 * terminal column that the working set happens to exclude.
 */
const ENTRY_POINTS = [
  // O catálogo do menu saiu de `components/ui/Header.tsx` em 2026-09-01: o componente passou a
  // desenhar uma árvore que `lib/navigation/menu.ts` monta. O href de `Parcerias` mora lá agora,
  // e é lá que esta invariante precisa olhar.
  'lib/navigation/menu.ts',
  'components/admin/partner-proposals/ProposalReview.tsx',
  'app/[locale]/admin/partnerships/clients/[clientId]/page.tsx',
]

test('#409 · no link into the list carries a filter that empties a board column', () => {
  // The premise: `in_progress` and the terminal columns are complements, so any link filtering
  // to the working set hides both of those columns entirely.
  const terminalStates = TERMINAL_COLUMNS.flatMap((id) => COLUMN_STATES[id])
  for (const state of terminalStates) {
    assert.equal(
      IN_PROGRESS_STATES.indexOf(state) >= 0,
      false,
      `${state} is both terminal and in-progress — the premise of this test no longer holds`
    )
  }

  for (const path of ENTRY_POINTS) {
    const source = code(path)
    assert.equal(
      /admin\/clients\?[^`'"]*state=/.test(source),
      false,
      `${path} links into the list with a state filter, which empties ${TERMINAL_COLUMNS.join(' and ')}`
    )
  }
})

test('#409 · the destination is one constant, not four strings that drift', () => {
  assert.equal(CLIENT_DIRECTORY_PATH, '/admin/clients')
  for (const path of ENTRY_POINTS) {
    assert.match(
      code(path),
      /CLIENT_DIRECTORY_PATH/,
      `${path} writes the path out by hand — three of the four already disagreed once`
    )
  }
})

// ── The act ANSWERS, and two acts that never worked ──────────────────────────────────────────
//
// Reported by the operator on 2026-09-09 as "a abertura de um cliente" and nothing else — the
// two broken acts were NOT reported, because a refused click painted nothing at all. `onAct` was
// typed `=> void` and the host called `void acts.run(...)`, so every `ActOutcome` was discarded
// and the nine sentences of `blocked` could only be reached by a refused DRAG.

const COMMUNICATE_ROUTE =
  'app/api/admin/partnerships/clients/[clientId]/places/[attractionId]/triage-refusal/communicate/route.ts'
const PLACES_ROUTE = 'app/api/admin/partnerships/clients/[clientId]/places/route.ts'
const PROVISIONING = 'lib/services/partner-place-provisioning.ts'

test('#409 · the outcome of an act reaches the screen — it is not thrown away', () => {
  // The host awaits instead of voiding, and the board's prop says so in its type.
  assert.equal(code(HOST).indexOf('void acts.run'), -1, 'the outcome may not be discarded')
  assert.match(code(BOARD), /onAct: \(row: ClientDirectoryRow, act: BoardAct\) => Promise<ActOutcome>/)

  // And the card renders it. It lives in the CARD and not in the drag layer: the curation lane,
  // the drag overlay and the phone's stacked column all render `BoardCard` unwrapped, so a
  // notice in the wrapper is a notice the phone never sees.
  const card = code(CARD)
  assert.match(card, /notice\?: \{ message: string; tone: 'refused' \| 'done' \} \| null/)
  assert.match(card, /role=\{notice\.tone === 'refused' \? 'alert' : 'status'\}/)
  assert.match(card, /aria-describedby=\{notice \? noticeId : undefined\}/)
})

test('#409 · communicating a refusal names WHICH refusal, or the route answers 400 every time', () => {
  // The route refuses to derive the current round on purpose: deriving it there would stamp a
  // round the operator was not looking at when a second one arrived meanwhile.
  assert.match(code(COMMUNICATE_ROUTE), /body\.refusalId/)
  assert.match(code(ACTS), /refusalId: owed\.refusal\.id/)

  // Which only works because the row carries the id. It used to project two stamps and no
  // identity, and that is what made the act post `{}`.
  assert.match(code('lib/partnerships/triage.ts'), /'id' \| 'decidedAt' \| 'communicatedAt'/)
  assert.match(code('lib/services/partnership-service.ts'), /id: current\.id/)
})

test('#409 · a 200 that created nothing is a refusal, not a success', () => {
  // `provisionPartnerPlace` skips as often as it creates, and the route wraps both in `ok: true`.
  assert.match(code(PLACES_ROUTE), /NextResponse\.json\(\{ ok: true, place: outcome \}\)/)
  assert.match(code(ACTS), /place\?\.status === 'skipped'/)
})

test('#409 · every reason these three routes can answer with has a sentence', () => {
  const blocked = messages('pt').Clients.board.blocked

  // Read from the ROUTES rather than from a list here, so a new refusal code cannot ship
  // without its copy. `unknown` is the deliberate floor and is asserted separately.
  const codes = new Set<string>()
  for (const route of [COMMUNICATE_ROUTE, PLACES_ROUTE, 'app/api/admin/clients/[clientId]/contract/route.ts']) {
    for (const match of code(route).matchAll(/error: '(\w+)'/g)) codes.add(match[1])
  }
  // Plus the three the provisioning skips with, which never become an `error:` — they arrive
  // inside a successful body, which is exactly what made them invisible.
  for (const match of code(PROVISIONING).matchAll(/status: 'skipped', reason: '(\w+)'/g)) {
    codes.add(match[1])
  }

  assert.ok(codes.size >= 12, `only ${codes.size} reason codes found — the ruler stopped reading`)
  for (const reason of codes) {
    // `unknown_action` and `invalid_body` of the contract route are unreachable from a card, but
    // a sentence for a code the board cannot show costs one line and removes a whole class of
    // "which of these can actually happen" from the next reader.
    assert.equal(typeof blocked[reason], 'string', `\`${reason}\` has no copy in Clients.board.blocked`)
  }

  // The floor, the dismissal, and a sentence for each act that fires a request.
  assert.equal(typeof blocked.unknown, 'string', 'the generic failure has no sentence')
  assert.equal(typeof messages('pt').Clients.board.dismissRefusal, 'string')
  for (const act of ['send_contract', 'create_place', 'communicate_refusal']) {
    assert.equal(
      typeof messages('pt').Clients.board.acted[act],
      'string',
      `\`${act}\` succeeds without saying so`
    )
  }
})
