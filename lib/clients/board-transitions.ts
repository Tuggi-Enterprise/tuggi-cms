/**
 * The board: which column a row belongs to, and what a drag from one column to the next means.
 *
 * THE COLUMN IS DERIVED AND NEVER STORED, and that is the whole design. `partner.clients` has no
 * `pipeline_stage` and is not getting one: the state comes from `derivePipelineState` over facts
 * that live in five tables, so a card cannot sit in `Contrato enviado` while the database says
 * the contract was signed an hour ago. Every alternative has two owners for one fact, and the
 * one that loses is always the one on screen.
 *
 * WHAT A DRAG IS, THEN. Not a write — an ACT. Dragging a card to the next column fires (or
 * opens) the act that PRODUCES the fact that column derives from; the card lands there because
 * the fact changed, on the next read. `planTransition` decides which act that is and whether the
 * obligations for it are met; it does not fetch, it does not write, and it does not choose copy.
 * The component fires the act and the messages file names it.
 *
 * THREE ACTS ARE DELIBERATELY NOT FIRED BY THE GESTURE, and they are the ones that cost money or
 * cannot be taken back: promoting a proposal, generating the first contract and publishing a
 * place. Each needs a choice the operator has to make with their eyes open — the promotion's
 * per-column ticks, the contract's tier and payment method, the sentence that starts the monthly
 * fee (BR-B2B-018). A drag is an ambiguous gesture; `open_*` acts open the panel that asks.
 *
 * Nothing here is React and nothing here fetches: it is proven by
 * `tests/api/client-board-transitions.test.ts` without a database or a browser, the same way
 * `lib/clients/directory-filter` is.
 */

import {
  buildDirectoryView,
  type DirectoryFilters,
  type DirectoryView,
} from '@/lib/clients/directory-filter'
import { PIPELINE_STATES, type PipelineState } from '@/lib/partnerships/pipeline'
import type { ClientDirectoryRow } from '@/lib/services/partnership-service'

/**
 * The eight columns, in pipeline order. Ids are English (CLAUDE.md §6); the labels an operator
 * reads live in `messages/pt.json` under `Clients.board.columns`.
 */
export type BoardColumnId =
  | 'proposal'
  | 'conference'
  | 'client'
  | 'contract_sent'
  | 'contract_signed'
  | 'curation'
  | 'published'
  | 'closed'

export const BOARD_COLUMNS: BoardColumnId[] = [
  'proposal',
  'conference',
  'client',
  'contract_sent',
  'contract_signed',
  'curation',
  'published',
  'closed',
]

/**
 * Which pipeline states each column holds — the ONE mapping, and the reason this module exists
 * rather than a `switch` inside the component.
 *
 * It has to be TOTAL and DISJOINT over `PIPELINE_STATES` minus `ALERT_STATE`, and a test proves
 * both. A state with no column is a row that silently vanishes from the board, which is the one
 * failure mode a work queue may not have; a state in two columns is a row that is counted twice.
 */
export const COLUMN_STATES: Record<BoardColumnId, PipelineState[]> = {
  proposal: ['proposal_received'],
  conference: ['in_conference'],
  client: ['client_created'],
  contract_sent: ['contract_sent'],
  contract_signed: ['contract_signed'],
  curation: ['place_in_curation'],
  published: ['published'],
  closed: ['discarded', 'refused_at_triage'],
}

/**
 * The one state that gets no column.
 *
 * DS-COPY-020, point 5: a refusal decided and not communicated is an act owed to somebody
 * OUTSIDE the company, and it outranks everything the pipeline knows about itself — including
 * `published`. Giving it a column would file it away as progress; it goes in a band above the
 * board instead, where it is the first thing read and the last thing to close.
 */
export const ALERT_STATE: PipelineState = 'refusal_not_communicated'

/**
 * The columns that are outcomes rather than work. Collapsed by default and windowed when open:
 * a board is what is still owed, and a column that accumulates every partnership ever delivered
 * stops being read at all.
 */
export const TERMINAL_COLUMNS: BoardColumnId[] = ['published', 'closed']

/** How many rows an expanded terminal column shows before deferring to the table. */
export const TERMINAL_WINDOW = 10

/**
 * Which column a state is shown in, or `null` for the alert band.
 *
 * Built once from `COLUMN_STATES` so the lookup cannot drift from the declaration above.
 */
const COLUMN_OF: Map<PipelineState, BoardColumnId> = new Map(
  BOARD_COLUMNS.flatMap((column) =>
    COLUMN_STATES[column].map((state) => [state, column] as [PipelineState, BoardColumnId])
  )
)

export function columnOf(state: PipelineState): BoardColumnId | null {
  return COLUMN_OF.get(state) ?? null
}

export function isTerminalColumn(column: BoardColumnId): boolean {
  return TERMINAL_COLUMNS.indexOf(column) >= 0
}

/**
 * The acts a card can carry, and the two shapes are a distinction with consequences.
 *
 * `*_open` opens a panel and waits for a person; everything else is a single request the card
 * can fire on its own. Anything irreversible or priced is in the first group — see the module's
 * header.
 */
export type BoardAct =
  /** Band 2 of the proposal: tick the documents seen in person. */
  | 'record_conference'
  /** Opens the proposal's promotion panel — the per-column ticks are a person's decision. */
  | 'open_promotion'
  /** `POST …/contract {action:'send'}`, for a contract already generated. */
  | 'send_contract'
  /** Opens the contract page — `generate` needs tier, payment method and QR delivery. */
  | 'open_contract'
  /** `POST …/places` — provisions the place from the promoted proposal. */
  | 'create_place'
  /** Opens the publication panel. Starts the monthly fee, so never fired by a gesture. */
  | 'open_publish'
  /** Opens the discard panel — the reason is mandatory. */
  | 'open_discard'
  /** `POST …/triage-refusal/communicate` — closes the 72-hour clock. */
  | 'communicate_refusal'

/**
 * Why a drag did not happen. Each reason is rendered from `messages/pt.json`; `missing` carries
 * the obligations the operator can act on, when the row already knows them.
 *
 * `partner_acts` is not a failure and not a block — it is the one edge whose act belongs to
 * somebody else, and saying "you cannot" without saying "because they have not signed yet"
 * reads as a broken screen.
 */
export type BlockReason =
  | 'no_submission'
  | 'already_promoted'
  | 'no_client'
  | 'partner_acts'
  | 'place_exists'
  | 'no_place'
  | 'blocking_pendencies'
  | 'places_unresolved'
  | 'not_closable'

export type TransitionPlan =
  | { kind: 'act'; act: BoardAct }
  | { kind: 'blocked'; reason: BlockReason }
  /** The card was dropped where it already is. */
  | { kind: 'noop' }
  /** A pipeline runs one way. Undoing an act is done in the record, never by a gesture. */
  | { kind: 'backwards' }
  /** Two columns at once. The reason names the obligation of the FIRST edge, never a chain. */
  | { kind: 'not_adjacent'; nextColumn: BoardColumnId }

function indexOfColumn(column: BoardColumnId): number {
  return BOARD_COLUMNS.indexOf(column)
}

/**
 * What dropping `row` from `from` onto `to` should do.
 *
 * `from` is passed rather than derived so the caller can prove the card it dragged is the card
 * the plan answered for: a board left open while somebody else worked the same row would
 * otherwise fire the act of a column this row already left.
 */
export function planTransition(
  row: ClientDirectoryRow,
  from: BoardColumnId,
  to: BoardColumnId
): TransitionPlan {
  if (from === to) return { kind: 'noop' }

  // `closed` is the one column reachable from several places, so it is decided before the
  // ordering: dragging a proposal there is a discard, and dragging a place there is a refusal.
  // Neither is "moving one step forward".
  if (to === 'closed') return planClosing(row, from)

  const fromIndex = indexOfColumn(from)
  const toIndex = indexOfColumn(to)
  if (toIndex < fromIndex) return { kind: 'backwards' }
  if (toIndex > fromIndex + 1) {
    return { kind: 'not_adjacent', nextColumn: BOARD_COLUMNS[fromIndex + 1] }
  }

  switch (from) {
    case 'proposal':
      // The conference of a promoted proposal is the CLIENT's, and it is registered on the
      // contract page. Sending the operator to the proposal's band would open a screen that
      // cannot answer.
      if (row.clientId) return { kind: 'blocked', reason: 'already_promoted' }
      if (!row.submissionId) return { kind: 'blocked', reason: 'no_submission' }
      return { kind: 'act', act: 'record_conference' }

    case 'conference':
      if (!row.submissionId) return { kind: 'blocked', reason: 'no_submission' }
      if (row.clientId) return { kind: 'blocked', reason: 'already_promoted' }
      return { kind: 'act', act: 'open_promotion' }

    case 'client':
      if (!row.clientId) return { kind: 'blocked', reason: 'no_client' }
      // A contract already generated only has to leave; one that does not exist has to be
      // priced first, and no gesture chooses a tier.
      return { kind: 'act', act: row.contract === 'draft' ? 'send_contract' : 'open_contract' }

    case 'contract_sent':
      // BR-B2B-026, item 5. The only edge whose act is the partner's: the card comes back, and
      // the column offers re-sending the link instead of pretending there is nothing to do.
      return { kind: 'blocked', reason: 'partner_acts' }

    case 'contract_signed':
      if (!row.clientId) return { kind: 'blocked', reason: 'no_client' }
      if (row.places.total > 0) return { kind: 'blocked', reason: 'place_exists' }
      return { kind: 'act', act: 'create_place' }

    case 'curation':
      if (row.places.total === 0) return { kind: 'blocked', reason: 'no_place' }
      // `blocking` is the count OF THE LEAST ADVANCED PLACE (`summarizePlaces`), which is the
      // one the publication panel opens on. Summing across places would hide which is stuck.
      if (row.places.blocking > 0) return { kind: 'blocked', reason: 'blocking_pendencies' }
      return { kind: 'act', act: 'open_publish' }

    default:
      // `published` has nothing after it but `closed`, handled above.
      return { kind: 'blocked', reason: 'not_closable' }
  }
}

/**
 * Dropping onto `Encerrados`, which has two doors and no third.
 *
 * A CLIENT IS NOT CLOSABLE HERE, and the omission is deliberate rather than forgotten:
 * `partner.clients.status = 'rejected'` is not read by `derivePipelineState` at all, so a
 * rejected client would keep deriving `client_created` and reappear in column 3 the moment the
 * board reloaded — a gesture that looks like it worked and did not. Registered as an open
 * question; until it has a state, this refuses.
 */
function planClosing(row: ClientDirectoryRow, from: BoardColumnId): TransitionPlan {
  if (from === 'proposal' || from === 'conference') {
    if (!row.submissionId) return { kind: 'blocked', reason: 'no_submission' }
    if (row.clientId) return { kind: 'blocked', reason: 'already_promoted' }
    return { kind: 'act', act: 'open_discard' }
  }
  return { kind: 'blocked', reason: 'not_closable' }
}

/**
 * The act a card offers WITHOUT being dragged — the same acts, reachable by keyboard and by
 * click. WCAG 2.2 SC 2.5.7: a drag may be a shortcut, never the only path.
 *
 * It is `planTransition` to the next column, so the button and the gesture cannot disagree; the
 * alert band is the exception, because its act is not a move to the next column at all.
 */
export function nextAct(row: ClientDirectoryRow, column: BoardColumnId): BoardAct | null {
  if (row.state === ALERT_STATE) return 'communicate_refusal'
  const next = BOARD_COLUMNS[indexOfColumn(column) + 1]
  if (!next) return null
  const plan = planTransition(row, column, next)
  return plan.kind === 'act' ? plan.act : null
}

export interface BoardColumnView {
  id: BoardColumnId
  /** Every row of the column, after the filters. What the header counts. */
  total: number
  /** The rows actually rendered — windowed for a collapsed or terminal column. */
  rows: ClientDirectoryRow[]
  /** How many the window left out. `0` for a column showing everything it has. */
  overflow: number
  collapsed: boolean
}

export interface BoardView {
  columns: BoardColumnView[]
  /** The rows owed to somebody outside the company. Above the board, never inside it. */
  alert: ClientDirectoryRow[]
  /** Handed through from `buildDirectoryView` so the rail and the board agree. */
  directory: DirectoryView
}

export interface BoardOptions {
  /** Which terminal columns the operator opened. Working columns are never collapsed. */
  expanded?: BoardColumnId[]
}

/**
 * The board over one set of rows.
 *
 * IT DELEGATES THE FILTERING, and that is not laziness. The facet rail counts what
 * `buildDirectoryView` returns; a board that filtered on its own would answer `3` in the rail
 * and show 2 cards, which is the defect `directory-filter`'s own header was written about.
 *
 * Terminal columns sort NEWEST FIRST, against the rest of the board. `compareRows` puts the most
 * idle row on top, which is what an operator wants from work and exactly wrong for an outcome:
 * there it surfaces the oldest fossils in the archive instead of what just landed.
 */
export function buildBoardView(
  rows: ClientDirectoryRow[],
  filters: DirectoryFilters,
  options: BoardOptions = {}
): BoardView {
  const directory = buildDirectoryView(rows, filters)
  const expanded = options.expanded ?? []

  const buckets = new Map<BoardColumnId, ClientDirectoryRow[]>(
    BOARD_COLUMNS.map((column) => [column, [] as ClientDirectoryRow[]])
  )
  const alert: ClientDirectoryRow[] = []

  for (const row of directory.rows) {
    const column = columnOf(row.state)
    if (column === null) alert.push(row)
    else buckets.get(column)!.push(row)
  }

  const columns = BOARD_COLUMNS.map((id) => {
    const all = buckets.get(id)!
    const terminal = isTerminalColumn(id)
    if (!terminal) {
      return { id, total: all.length, rows: all, overflow: 0, collapsed: false }
    }

    const recent = all.slice().sort((a, b) => (b.since ?? '').localeCompare(a.since ?? ''))
    const collapsed = expanded.indexOf(id) < 0
    const shown = collapsed ? [] : recent.slice(0, TERMINAL_WINDOW)
    return { id, total: all.length, rows: shown, overflow: all.length - shown.length, collapsed }
  })

  return { columns, alert, directory }
}

/**
 * Every pipeline state, checked against the mapping — exported so the test asserts on the same
 * list the board is built from, and not on a copy of it that would age separately.
 */
export function unmappedStates(): PipelineState[] {
  return PIPELINE_STATES.filter((state) => state !== ALERT_STATE && columnOf(state) === null)
}
