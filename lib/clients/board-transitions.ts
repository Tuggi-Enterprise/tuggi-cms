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
 * TWO ACTS ARE DELIBERATELY NOT FIRED BY THE GESTURE, and they are the ones that cost money or
 * cannot be taken back: promoting a proposal and publishing a place. Each needs a choice the
 * operator has to make with their eyes open — the promotion's per-column ticks, the sentence that
 * starts the monthly fee (BR-B2B-018). A drag is an ambiguous gesture; `open_*` acts open the
 * panel that asks.
 *
 * THE GATE OF BR-B2B-057 is read here from `row.gateMissing` and enforced again by the server in
 * the routes that create and publish a place (`checkAcceptanceGate`); the screen only mirrors it.
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
import { PIPELINE_STATES, TERMINAL_STATES, type PipelineState } from '@/lib/partnerships/pipeline'
import type { GateItem } from '@/lib/partnerships/acceptance-gate'
import type { ClientDirectoryRow } from '@/lib/services/partnership-service'

/**
 * The four columns of BR-B2B-057, in pipeline order. Ids are English (CLAUDE.md §6); the labels
 * an operator reads live in `messages/pt.json` under `Clients.board.columns`.
 */
export type BoardColumnId = 'conference' | 'awaiting_acceptance' | 'curation' | 'published'

export const BOARD_COLUMNS: BoardColumnId[] = ['conference', 'awaiting_acceptance', 'curation', 'published']

/**
 * Which pipeline states each column holds — the ONE mapping, and the reason this module exists
 * rather than a `switch` inside the component.
 *
 * It has to be TOTAL and DISJOINT over `PIPELINE_STATES` minus `ALERT_STATE` and the terminal
 * states, and a test proves both. A state with no column is a row that silently vanishes from the
 * board; a state in two columns is a row that is counted twice.
 *
 * THE TERMINAL STATES ARE NOT A COLUMN (BR-B2B-057, item 6): closing is not a stage, and the
 * board reaches them by a link to the table already filtered on them (`CLOSED_STATES`).
 */
export const COLUMN_STATES: Record<BoardColumnId, PipelineState[]> = {
  // "Proposta recebida" is the same person doing the same conference (spec #872 §1), and the
  // portal's validation is this column's work too (#812).
  conference: ['proposal_received', 'in_conference', 'in_validation', 'changes_requested'],
  awaiting_acceptance: ['awaiting_acceptance'],
  curation: ['place_in_curation', 'approved_awaiting_narration'],
  published: ['published'],
}

/** The states outside the board, reached by `Ver os encerrados na tabela`. */
export const CLOSED_STATES: readonly PipelineState[] = TERMINAL_STATES

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
export const TERMINAL_COLUMNS: BoardColumnId[] = ['published']

/**
 * How many rows a terminal column shows at a time, and how many `Ver mais` adds.
 *
 * IT REPLACED A COLLAPSE, and the reason the collapse existed was right while being wrong about
 * what to do with it: `Publicado` and `Encerrados` are outcomes, they grow without bound, and a
 * board whose two widest columns are things nobody has to do again stops being read. Coming shut
 * solved that by making the work of the last month INVISIBLE — an operator who had just
 * published a place could not see it on the board at all, and the only way to it was a link out
 * to the table.
 *
 * A WINDOW SOLVES THE SAME PROBLEM WITHOUT HIDING ANYTHING. Five is small enough that the column
 * cannot swamp the seven beside it and large enough to answer `o que entrou no ar esta semana?`
 * without a click. What is past the window is stated as a number and reachable by a button that
 * grows the column in place — never a link to a different screen.
 *
 * FIVE AND NOT TEN, which is what the collapse revealed when opened: ten cards is roughly three
 * phone screens of scrolling in a column the operator did not navigate to on purpose.
 */
export const TERMINAL_PAGE = 5

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
  /** The proposal's conference band: tick the documents seen in person. */
  | 'record_conference'
  /** Opens the proposal's promotion panel — the per-column ticks are a person's decision. */
  | 'open_promotion'
  /** `POST …/places` — provisions the place from the promoted proposal. Gated (BR-B2B-057). */
  | 'create_place'
  /** Opens the publication panel. Starts the monthly fee, so never fired by a gesture. Gated. */
  | 'open_publish'
  /** `POST …/triage-refusal/communicate` — closes the 72-hour clock. */
  | 'communicate_refusal'
  // A portal row (#812): approve, ask for changes and refuse all happen in the validation
  // screen — approving creates a POI and spends TTS, so no drag does it.
  | 'open_validation'

/**
 * Why a drag did not happen. Each reason is rendered from `messages/pt.json`.
 *
 * `gate_missing` is BR-B2B-057, item 3: the same sentence the card prints, the drag answers and
 * the server's refusal carries (`missing`, in copy order).
 */
export type BlockReason =
  | 'no_submission'
  | 'already_promoted'
  | 'no_client'
  | 'place_exists'
  | 'no_place'
  | 'blocking_pendencies'
  | 'not_closable'
  | 'gate_missing'

export type TransitionPlan =
  | { kind: 'act'; act: BoardAct }
  /**
   * `missing` travels with `gate_missing`; `act` is the act the gate is holding back, so the card
   * can keep the button in place with `aria-disabled` (spec #872 §2). Absent when there is no act
   * to hold — a portal row whose place exists and only the code is missing.
   */
  | { kind: 'blocked'; reason: BlockReason; missing?: GateItem[]; act?: BoardAct }
  /** The card was dropped where it already is. */
  | { kind: 'noop' }
  /** A pipeline runs one way. Undoing an act is done in the record, never by a gesture. */
  | { kind: 'backwards' }
  /** Two columns at once. The reason names the obligation of the FIRST edge, never a chain. */
  | { kind: 'not_adjacent'; nextColumn: BoardColumnId }

function indexOfColumn(column: BoardColumnId): number {
  return BOARD_COLUMNS.indexOf(column)
}

function gateBlock(row: ClientDirectoryRow, act?: BoardAct): TransitionPlan | null {
  if (row.gateMissing.length === 0) return null
  return act
    ? { kind: 'blocked', reason: 'gate_missing', missing: row.gateMissing, act }
    : { kind: 'blocked', reason: 'gate_missing', missing: row.gateMissing }
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

  if (row.origin === 'portal') return planPortalTransition(row, from, to)

  const fromIndex = indexOfColumn(from)
  const toIndex = indexOfColumn(to)
  if (toIndex < fromIndex) return { kind: 'backwards' }
  if (toIndex > fromIndex + 1) {
    return { kind: 'not_adjacent', nextColumn: BOARD_COLUMNS[fromIndex + 1] }
  }

  switch (from) {
    case 'conference':
      // Leaving the conference is the promotion, which creates the client — and the client is
      // born with its slug and its partner code (BR-B2B-057, item 3, first step).
      if (!row.submissionId) return { kind: 'blocked', reason: 'no_submission' }
      if (row.clientId) return { kind: 'blocked', reason: 'already_promoted' }
      return { kind: 'act', act: row.state === 'proposal_received' ? 'record_conference' : 'open_promotion' }

    case 'awaiting_acceptance': {
      if (!row.clientId) return { kind: 'blocked', reason: 'no_client' }
      const act: BoardAct | undefined = row.places.total === 0 ? 'create_place' : undefined
      const gated = gateBlock(row, act)
      if (gated) return gated
      if (!act) return { kind: 'blocked', reason: 'place_exists' }
      return { kind: 'act', act }
    }

    case 'curation': {
      const gated = gateBlock(row, 'open_publish')
      if (gated) return gated
      if (row.places.total === 0) return { kind: 'blocked', reason: 'no_place' }
      // `blocking` is the count OF THE LEAST ADVANCED PLACE (`summarizePlaces`), which is the
      // one the publication panel opens on. Summing across places would hide which is stuck.
      if (row.places.blocking > 0) return { kind: 'blocked', reason: 'blocking_pendencies' }
      return { kind: 'act', act: 'open_publish' }
    }

    default:
      return { kind: 'blocked', reason: 'not_closable' }
  }
}

/**
 * A portal row is decided in the validation screen: from the conference, the drop opens it
 * (approving lands in curation, passing through `Aguardando aceite` when the gate is open).
 * After the approval the gate is the only thing the board can say about it.
 */
function planPortalTransition(
  row: ClientDirectoryRow,
  from: BoardColumnId,
  to: BoardColumnId
): TransitionPlan {
  if (indexOfColumn(to) < indexOfColumn(from)) return { kind: 'backwards' }
  if (from === 'conference' && (to === 'awaiting_acceptance' || to === 'curation')) {
    if (!row.submissionId) return { kind: 'blocked', reason: 'no_submission' }
    return { kind: 'act', act: 'open_validation' }
  }
  return gateBlock(row) ?? { kind: 'blocked', reason: 'not_closable' }
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
  const plan = nextPlan(row, column)
  return plan?.kind === 'act' ? plan.act : null
}

/**
 * The plan to the next column — what the card's button reads, so a gate-blocked act stays on
 * screen with `aria-disabled` and the same sentence the drag would answer.
 */
export function nextPlan(row: ClientDirectoryRow, column: BoardColumnId): TransitionPlan | null {
  const next = BOARD_COLUMNS[indexOfColumn(column) + 1]
  return next ? planTransition(row, column, next) : null
}

export interface BoardColumnView {
  id: BoardColumnId
  /** Every row of the column, after the filters. What the header counts. */
  total: number
  /** The rows actually rendered — windowed for a terminal column. */
  rows: ClientDirectoryRow[]
  /**
   * How many the window left out. `0` for a column showing everything it has.
   *
   * `collapsed` USED TO LIVE HERE and is gone with the collapse it described. A boolean nothing
   * sets to `true` any more is the kind of flag that survives a redesign and then lies about
   * what the screen does — `overflow > 0` is the same question asked of a fact.
   */
  overflow: number
}

export interface BoardView {
  columns: BoardColumnView[]
  /** The rows owed to somebody outside the company. Above the board, never inside it. */
  alert: ClientDirectoryRow[]
  /** How many rows are closed (BR-B2B-057, item 6) — outside the board, behind a link. */
  closedCount: number
  /** Handed through from `buildDirectoryView` so the rail and the board agree. */
  directory: DirectoryView
}

export interface BoardOptions {
  /**
   * How many rows each terminal column has been asked to reveal — what `Ver mais` grows.
   *
   * A MAP AND NOT A LIST OF OPEN COLUMNS, because the question changed from `is it open?` to
   * `how far down is it?`. Absent, and anything below `TERMINAL_PAGE`, reads as one page: the
   * floor is applied here rather than at the caller, so a board mounted with `{}` and one whose
   * state was never touched render identically.
   *
   * Working columns ignore this entirely. They are the queue, and a queue that hid part of
   * itself would be a board that under-reports the work.
   */
  shown?: Partial<Record<BoardColumnId, number>>
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
  const shown = options.shown ?? {}

  const buckets = new Map<BoardColumnId, ClientDirectoryRow[]>(
    BOARD_COLUMNS.map((column) => [column, [] as ClientDirectoryRow[]])
  )
  const alert: ClientDirectoryRow[] = []
  let closedCount = 0

  for (const row of directory.rows) {
    if (row.state === ALERT_STATE) {
      alert.push(row)
      continue
    }
    const column = columnOf(row.state)
    if (column === null) closedCount += 1
    else buckets.get(column)!.push(row)
  }

  const columns = BOARD_COLUMNS.map((id) => {
    const all = buckets.get(id)!
    if (!isTerminalColumn(id)) {
      return { id, total: all.length, rows: all, overflow: 0 }
    }

    const recent = all.slice().sort((a, b) => (b.since ?? '').localeCompare(a.since ?? ''))
    // The floor lives here, not at the caller: `{}` and `{ published: 0 }` and a state nobody
    // touched all have to render the same first page.
    const window = Math.max(TERMINAL_PAGE, shown[id] ?? 0)
    const visible = recent.slice(0, window)
    return { id, total: all.length, rows: visible, overflow: all.length - visible.length }
  })

  return { columns, alert, closedCount, directory }
}

/**
 * Every pipeline state, checked against the mapping — exported so the test asserts on the same
 * list the board is built from, and not on a copy of it that would age separately.
 */
export function unmappedStates(): PipelineState[] {
  return PIPELINE_STATES.filter(
    (state) => state !== ALERT_STATE && !CLOSED_STATES.includes(state) && columnOf(state) === null
  )
}
