/**
 * The board — which column a row is in, and what a drag from one column to the next is allowed
 * to do. #409.
 *
 * WHAT THIS SUITE IS DEFENDING. The column is derived and never stored, so the board can only be
 * wrong in two ways: by losing a row, or by firing an act whose obligations are not met. The
 * first is the totality proof below; the second is the transition matrix. Both are pure — no
 * database, no browser, no React.
 *
 * Mutations that turn this suite red:
 *  · giving `refusal_not_communicated` a column, which files an act owed to somebody outside
 *    the company away as progress (DS-COPY-020, point 5);
 *  · adding a pipeline state without a column, which makes rows disappear from the board;
 *  · letting a drag FIRE the promotion or the publication instead of opening the panel that
 *    asks (BR-B2B-018 — that last one starts the monthly fee);
 *  · letting a card into curation or publication with the BR-B2B-057 gate closed;
 *  · publishing with a blocking pendency on the least advanced place (BR-B2B-011);
 *  · letting the board filter on its own, which makes the facet rail count one set and the
 *    columns render another.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { whatIsMissing } from '@/components/admin/clients/board/row-text'
import {
  ALERT_STATE,
  BOARD_COLUMNS,
  COLUMN_STATES,
  TERMINAL_COLUMNS,
  TERMINAL_PAGE,
  buildBoardView,
  columnOf,
  nextAct,
  nextPlan,
  planTransition,
  unmappedStates,
  type BoardColumnId,
} from '@/lib/clients/board-transitions'
import { EMPTY_FILTERS, buildDirectoryView, type DirectoryFilters } from '@/lib/clients/directory-filter'
import { PIPELINE_STATES, TERMINAL_STATES, type PipelineState } from '@/lib/partnerships/pipeline'
import type { ClientDirectoryRow } from '@/lib/services/partnership-service'
import type { GateItem } from '@/lib/partnerships/acceptance-gate'

const PLACES = { total: 0, published: 0, blocking: 0, silencing: 0, improving: 0, allReady: false }

function row(overrides: Partial<ClientDirectoryRow> = {}): ClientDirectoryRow {
  return {
    submissionId: 'sub-1',
    clientId: 'client-1',
    state: 'awaiting_acceptance',
    target: { kind: 'client', clientId: 'client-1', tab: 'partnership' },
    name: 'Cantina do Zé',
    taxId: null,
    city: null,
    region: null,
    country: null,
    clientType: 'venue',
    status: 'approved',
    contract: 'none',
    fee: { monthlyFeeCents: null, isCourtesy: false, courtesyReason: null },
    contractTier: null,
    planChoice: null,
    duplicateCount: 0,
    since: '2026-08-10T12:00:00.000Z',
    places: { ...PLACES },
    triage: { approvedAt: null, places: [] },
    discardReason: null,
    gateMissing: [],
    ...overrides,
  }
}

const filters = (overrides: Partial<DirectoryFilters> = {}): DirectoryFilters => ({
  ...EMPTY_FILTERS,
  ...overrides,
})

// ── The mapping — DS-COPY-020 ────────────────────────────────────────────────────────────────

test('#872 · BR-B2B-057 item 1: four columns, in this order', () => {
  assert.deepEqual(BOARD_COLUMNS, ['conference', 'awaiting_acceptance', 'curation', 'published'])
})

test('#409 · BR-B2B-057 item 6: every non-terminal state has exactly one home — a column, or the alert band', () => {
  assert.deepEqual(unmappedStates(), [], 'a state with no column is a row that vanishes')

  const seen = new Map<PipelineState, BoardColumnId>()
  for (const column of BOARD_COLUMNS) {
    for (const state of COLUMN_STATES[column]) {
      assert.equal(seen.has(state), false, `${state} is in two columns`)
      seen.set(state, column)
    }
  }

  // Total: every state is either mapped, the alert, or closed (outside the board).
  for (const state of PIPELINE_STATES) {
    if (state === ALERT_STATE) continue
    if (TERMINAL_STATES.includes(state)) {
      assert.equal(columnOf(state), null, `${state} is closed and must not be a column`)
      continue
    }
    assert.equal(typeof columnOf(state), 'string', `${state} has no column`)
  }
})

test('#872 · BR-B2B-057 item 6: the closed rows leave the board and are counted for the table link', () => {
  const view = buildBoardView(
    [row({ state: 'discarded' }), row({ clientId: 'c2', state: 'portal_refused' }), row({ clientId: 'c3' })],
    filters()
  )
  assert.equal(view.closedCount, 2)
  assert.equal(view.columns.reduce((sum, column) => sum + column.total, 0), 1)
  const closed = buildDirectoryView([row({ state: 'discarded' }), row({ clientId: 'c3' })], filters({ state: 'closed' }))
  assert.deepEqual(closed.rows.map((item) => item.state), ['discarded'])
})

test('#409 · DS-COPY-020 point 5: a refusal nobody communicated gets no column', () => {
  assert.equal(columnOf(ALERT_STATE), null)

  const owed = row({ state: ALERT_STATE, places: { ...PLACES, total: 2, published: 1 } })
  const view = buildBoardView([owed], filters())

  assert.deepEqual(view.alert.map((item) => item.clientId), ['client-1'])
  for (const column of view.columns) {
    assert.equal(column.total, 0, `${column.id} swallowed the alert row`)
  }

  // And its act is the one it owes, not the act of whatever column it looks closest to.
  assert.equal(nextAct(owed, 'published'), 'communicate_refusal')
})

// ── The ordering — a pipeline runs one way ───────────────────────────────────────────────────

test('#409 · dragging backwards is refused everywhere, and fires nothing', () => {
  for (let index = 1; index < BOARD_COLUMNS.length; index += 1) {
    const from = BOARD_COLUMNS[index]
    for (let earlier = 0; earlier < index; earlier += 1) {
      const plan = planTransition(row(), from, BOARD_COLUMNS[earlier])
      assert.equal(plan.kind, 'backwards', `${from} → ${BOARD_COLUMNS[earlier]}`)
    }
  }
})

test('#409 · skipping a column names the obligation of the FIRST edge, never a chain', () => {
  const plan = planTransition(row({ state: 'proposal_received', clientId: null }), 'conference', 'curation')
  assert.deepEqual(plan, { kind: 'not_adjacent', nextColumn: 'awaiting_acceptance' })

  assert.deepEqual(planTransition(row(), 'awaiting_acceptance', 'awaiting_acceptance'), { kind: 'noop' })
})

// ── The acts, edge by edge ───────────────────────────────────────────────────────────────────

test('#409 · conference → awaiting: the conference of a proposal, then the promotion — never of a promoted one', () => {
  const fresh = row({ state: 'proposal_received', clientId: null })
  assert.deepEqual(planTransition(fresh, 'conference', 'awaiting_acceptance'), {
    kind: 'act',
    act: 'record_conference',
  })
  // DS-COMPONENTE-018: the promotion is OPENED, not fired.
  const ready = row({ state: 'in_conference', clientId: null })
  assert.deepEqual(planTransition(ready, 'conference', 'awaiting_acceptance'), {
    kind: 'act',
    act: 'open_promotion',
  })

  const promoted = row({ state: 'in_conference' })
  assert.deepEqual(planTransition(promoted, 'conference', 'awaiting_acceptance'), {
    kind: 'blocked',
    reason: 'already_promoted',
  })

  const orphan = row({ state: 'proposal_received', clientId: null, submissionId: null })
  assert.deepEqual(planTransition(orphan, 'conference', 'awaiting_acceptance'), {
    kind: 'blocked',
    reason: 'no_submission',
  })
})

test('#872 · BR-B2B-057 item 3: awaiting → curation creates the place only with the gate open', () => {
  assert.deepEqual(planTransition(row(), 'awaiting_acceptance', 'curation'), { kind: 'act', act: 'create_place' })

  // The gate closed: blocked with the list, and the act it holds so the card keeps the button.
  const manual = row({ gateMissing: ['acceptance'] })
  assert.deepEqual(planTransition(manual, 'awaiting_acceptance', 'curation'), {
    kind: 'blocked',
    reason: 'gate_missing',
    missing: ['acceptance'],
    act: 'create_place',
  })
  assert.equal(nextAct(manual, 'awaiting_acceptance'), null)
  assert.deepEqual(nextPlan(manual, 'awaiting_acceptance'), planTransition(manual, 'awaiting_acceptance', 'curation'))

  // The place exists and only the gate is missing: no act to hold (spec #872 §2).
  const placed = row({ gateMissing: ['acceptance', 'partner_code'], places: { ...PLACES, total: 1 } })
  assert.deepEqual(planTransition(placed, 'awaiting_acceptance', 'curation'), {
    kind: 'blocked',
    reason: 'gate_missing',
    missing: ['acceptance', 'partner_code'],
  })

  assert.deepEqual(planTransition(row({ clientId: null }), 'awaiting_acceptance', 'curation'), {
    kind: 'blocked',
    reason: 'no_client',
  })
})

test('#409 · BR-B2B-011: curation → published opens the publication, and a blocking pendency stops it', () => {
  const ready = row({ state: 'place_in_curation', places: { ...PLACES, total: 1 } })
  assert.deepEqual(planTransition(ready, 'curation', 'published'), {
    kind: 'act',
    act: 'open_publish',
  })

  // `blocking` is the count of the LEAST ADVANCED place (`summarizePlaces`), never a sum.
  const stuck = row({ places: { ...PLACES, total: 3, published: 1, blocking: 2 } })
  assert.deepEqual(planTransition(stuck, 'curation', 'published'), {
    kind: 'blocked',
    reason: 'blocking_pendencies',
  })

  const empty = row({ places: { ...PLACES } })
  assert.deepEqual(planTransition(empty, 'curation', 'published'), {
    kind: 'blocked',
    reason: 'no_place',
  })

  // BR-B2B-057 item 3: `Publicado` needs the gate too, and the gate is read first.
  assert.deepEqual(planTransition(row({ ...ready, gateMissing: ['slug'] }), 'curation', 'published'), {
    kind: 'blocked',
    reason: 'gate_missing',
    missing: ['slug'],
    act: 'open_publish',
  })
})

test('#409 · BR-B2B-018: the acts a GESTURE can fire are a closed list, and it is the safe one', () => {
  // Every act any edge can produce, over rows covering every shape the board has.
  const produced = new Set<string>()
  const rows = [
    row({ clientId: null, submissionId: 's1', state: 'proposal_received' }),
    row({ clientId: null, submissionId: 's1', state: 'in_conference' }),
    row({ gateMissing: ['acceptance'] }),
    row(),
    row({ places: { ...PLACES, total: 1 } }),
    row({ places: { ...PLACES, total: 3, published: 1, blocking: 2 } }),
    row({ origin: 'portal', state: 'in_validation', clientId: null }),
  ]
  for (const candidate of rows) {
    for (const from of BOARD_COLUMNS) {
      for (const to of BOARD_COLUMNS) {
        const plan = planTransition(candidate, from, to)
        if (plan.kind === 'act') produced.add(plan.act)
      }
    }
  }

  // The acts that cost money or cannot be taken back reach the operator ONLY as a panel: the
  // promotion's per-column ticks and the publication that starts the monthly fee (BR-B2B-018).
  const firedDirectly = ['record_conference', 'create_place']
  const openedAsPanel = ['open_promotion', 'open_publish', 'open_validation']

  assert.deepEqual(
    Array.from(produced).sort(),
    firedDirectly.concat(openedAsPanel).sort(),
    'an act appeared that is neither a safe request nor a panel'
  )
})

// ── What the row says it owes — the column and the card read the same line ───────────────────

/**
 * A translator that returns its key, so the assertion names the MESSAGE and not a sentence that
 * `design` may reword tomorrow.
 */
const keys = ((key: string) => key) as never

test('#409 · the pendencies of a place belong to the states whose work IS the place', () => {
  // THE DEFECT, measured on screen: a place is created when the client is APPROVED, before any
  // contract exists, and it carries its pendencies from that moment. Reading them
  // unconditionally put `1 impede, 2 ficam mudos` on a card sitting in `Contrato enviado` —
  // where the operator cannot touch the place, and what is actually owed is to chase the
  // signature. A true fact about the wrong step is still the wrong answer.
  const stuck = { ...PLACES, total: 3, published: 1, blocking: 1, silencing: 2 }

  for (const state of ['awaiting_acceptance'] as const) {
    assert.equal(
      whatIsMissing(row({ state, places: stuck }), keys),
      `nextSteps.${state}`,
      `${state} must name its own next step, not the place's pendencies`
    )
  }

  // And where the place IS the work, the counts come back — of the least advanced place, never
  // summed across places (DS-COMPONENTE-020, 2nd edge case).
  assert.equal(
    whatIsMissing(row({ state: 'place_in_curation', places: stuck }), keys),
    'queue.placesProgressqueue.missingSeparatorqueue.missingBlockingqueue.missingSeparatorqueue.missingSilencing'
  )

  // The act owed to somebody OUTSIDE the company still outranks everything (DS-COPY-020, p. 5).
  assert.equal(
    whatIsMissing(row({ state: ALERT_STATE, places: stuck }), keys),
    'nextSteps.refusal_not_communicated'
  )
})

// ── The view ─────────────────────────────────────────────────────────────────────────────────

const SPREAD: ClientDirectoryRow[] = [
  row({ clientId: null, submissionId: 's1', state: 'proposal_received' }),
  row({ clientId: null, submissionId: 's2', state: 'in_conference' }),
  row({ clientId: 'c3', state: 'awaiting_acceptance', gateMissing: ['acceptance'] }),
  row({ clientId: 'c6', state: 'place_in_curation', contract: 'signed' }),
  row({ clientId: 'c7', state: 'published', contract: 'signed' }),
  row({ clientId: 'c8', state: 'discarded' }),
  row({ clientId: 'c9', state: 'refused_at_triage' }),
  row({ clientId: 'c10', state: ALERT_STATE }),
]

/** A run of published rows, oldest first, so the last one built is the most recent. */
function publishedRun(count: number) {
  return Array.from({ length: count }, (_, index) =>
    row({
      clientId: `pub-${index}`,
      state: 'published',
      since: `2026-0${1 + Math.floor(index / 28)}-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    })
  )
}

function publishedIn(view: ReturnType<typeof buildBoardView>) {
  return view.columns.find((candidate) => candidate.id === 'published')!
}

test('#409 · no row is lost: the columns plus the alert plus the closed are exactly what the rail counted', () => {
  for (const applied of [filters(), filters({ state: 'in_progress' }), filters({ search: 'zé' })]) {
    const view = buildBoardView(SPREAD, applied)
    const carried =
      view.columns.reduce((sum, column) => sum + column.total, 0) + view.alert.length + view.closedCount
    assert.equal(carried, buildDirectoryView(SPREAD, applied).rows.length)
  }
})

/**
 * WHAT THIS TEST REPLACED, and why the replacement is not a relaxation.
 *
 * Until 2026-08-24 the assertion here was that a terminal column comes COLLAPSED — `rows: []`
 * and `overflow === total`. That was a true description of a screen with a real defect: the last
 * month of delivered work was invisible, and an operator who had just published a place had no
 * way to see it on the board. The reason for the collapse survives (an unbounded `Publicado`
 * swamps the seven columns beside it); what changed is the answer to it, from a shut drawer to a
 * window that grows.
 *
 * So the invariant is now the WINDOW, and it is stricter than the collapse was: a terminal column
 * always shows something, always says how much it is not showing, and never shows more than it
 * was asked for.
 */
test('#409 · a terminal column shows its first page by default, and counts the rest', () => {
  const many = publishedRun(TERMINAL_PAGE + 5)
  const column = publishedIn(buildBoardView(many, filters()))

  assert.equal(column.total, TERMINAL_PAGE + 5)
  assert.equal(column.rows.length, TERMINAL_PAGE)
  assert.equal(column.overflow, 5)
})

/**
 * THE WINDOW IS A PROPERTY OF BEING TERMINAL, not of being named `published`; every working column
 * is the queue, and a queue that hid part of itself would be a board that under-reports the work.
 */
test('#409 · every terminal column windows, and no working column does', () => {
  const many = BOARD_COLUMNS.flatMap((id) =>
    Array.from({ length: TERMINAL_PAGE + 3 }, (_, index) =>
      row({
        clientId: `${id}-${index}`,
        state: COLUMN_STATES[id][0],
        since: `2026-02-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      })
    )
  )
  const view = buildBoardView(many, filters())

  for (const column of view.columns) {
    const terminal = TERMINAL_COLUMNS.indexOf(column.id) >= 0
    assert.equal(column.total, TERMINAL_PAGE + 3, column.id)
    assert.equal(column.rows.length, terminal ? TERMINAL_PAGE : TERMINAL_PAGE + 3, column.id)
    assert.equal(column.overflow, terminal ? 3 : 0, column.id)
  }
})

test('#409 · the window keeps the NEWEST rows, and grows by a page at a time', () => {
  const many = publishedRun(TERMINAL_PAGE * 3)

  const first = publishedIn(buildBoardView(many, filters()))
  // Newest first — the opposite of `compareRows`, which puts the most idle row on top because
  // that is what work looks like. In an archive it would surface the oldest fossils.
  assert.equal(first.rows[0].clientId, `pub-${TERMINAL_PAGE * 3 - 1}`)

  const second = publishedIn(
    buildBoardView(many, filters(), { shown: { published: TERMINAL_PAGE * 2 } })
  )
  assert.equal(second.rows.length, TERMINAL_PAGE * 2)
  assert.equal(second.overflow, TERMINAL_PAGE)
  // Growing REVEALS, never reshuffles: page one is still page one, in the same order.
  assert.deepEqual(
    second.rows.slice(0, TERMINAL_PAGE).map((item) => item.clientId),
    first.rows.map((item) => item.clientId)
  )
})

/**
 * THE FLOOR IS THE MODULE'S, not the caller's — so a board mounted with `{}`, one whose state
 * nobody has touched, and one carrying a number below a page all render the same first page.
 * Without it, `Math.max` living only in `revealMore` would let a `0` from anywhere paint an
 * empty `Publicado` that says `14` in its heading.
 */
test('#409 · a window below one page is still one page', () => {
  const many = publishedRun(TERMINAL_PAGE + 5)
  for (const asked of [0, 1, TERMINAL_PAGE - 1]) {
    const column = publishedIn(buildBoardView(many, filters(), { shown: { published: asked } }))
    assert.equal(column.rows.length, TERMINAL_PAGE, `asked for ${asked}`)
  }
})

test('#409 · asking for more than the column holds shows all of it and claims no overflow', () => {
  const many = publishedRun(3)
  const column = publishedIn(buildBoardView(many, filters(), { shown: { published: 100 } }))
  assert.equal(column.rows.length, 3)
  assert.equal(column.overflow, 0)
})

test('#409 · the board never filters on its own: it hands the rail its own view back', () => {
  const applied = filters({ state: 'published' })
  const view = buildBoardView(SPREAD, applied)
  assert.deepEqual(
    view.directory.rows.map((item) => item.clientId),
    buildDirectoryView(SPREAD, applied).rows.map((item) => item.clientId)
  )
})

// ── The Portal Locais on the same board (#812, BR-B2B-049, BR-B2B-047) ────────────────────────

import {
  PORTAL_BOARD_STATUSES,
  derivePipelineState,
  isPortalBoardStatus,
  portalDetailTarget,
} from '@/lib/partnerships/pipeline'
import { recordHref, boardPath } from '@/lib/clients/record-href'

const NO_CONF = { documentsSeen: [], reviewedAt: null, reviewedBy: null } as unknown as Parameters<
  typeof derivePipelineState
>[0]['conference']

function portalState(
  status: (typeof PORTAL_BOARD_STATUSES)[number],
  clientId: string | null = null,
  gateMissing: GateItem[] = []
) {
  return derivePipelineState({
    origin: 'portal',
    portalStatus: status,
    proposalStatus: 'submitted',
    conference: NO_CONF,
    clientId,
    gateMissing,
    placeCount: 0,
    publishedPlaceCount: 0,
  })
}

test('BR-B2B-049: each board status of the portal maps to one state and one column', () => {
  assert.equal(columnOf(portalState('in_review')), 'conference')
  assert.equal(columnOf(portalState('changes_requested')), 'conference')
  assert.equal(columnOf(portalState('approved')), 'curation')
  assert.equal(columnOf(portalState('live')), 'published')
  assert.equal(columnOf(portalState('rejected')), null, 'closed rows are not a column (BR-B2B-057 item 6)')
  assert.deepEqual(unmappedStates(), [])
})

test('BR-B2B-049: draft and awaiting_payment never reach the board', () => {
  assert.equal(isPortalBoardStatus('draft'), false)
  assert.equal(isPortalBoardStatus('awaiting_payment'), false)
  assert.equal(isPortalBoardStatus('in_review'), true)
})

test('BR-B2B-057 item 2: an approved portal row passes through `Aguardando aceite` without stopping', () => {
  assert.equal(portalState('approved', 'client-9'), 'approved_awaiting_narration')
  // …unless the gate is not open — a code still missing keeps it there, with no act to fire.
  assert.equal(portalState('approved', 'client-9', ['partner_code']), 'awaiting_acceptance')
  const portal = row({ origin: 'portal', state: 'awaiting_acceptance', gateMissing: ['partner_code'] })
  assert.deepEqual(planTransition(portal, 'awaiting_acceptance', 'curation'), {
    kind: 'blocked',
    reason: 'gate_missing',
    missing: ['partner_code'],
  })
  assert.equal(nextAct(portal, 'awaiting_acceptance'), null)
})

test('#812: approving a portal card opens the validation screen, never acts on the drop', () => {
  const portal = row({ origin: 'portal', state: 'in_validation', clientId: null })
  assert.deepEqual(planTransition(portal, 'conference', 'awaiting_acceptance'), { kind: 'act', act: 'open_validation' })
  assert.deepEqual(planTransition(portal, 'conference', 'curation'), { kind: 'act', act: 'open_validation' })
  assert.equal(nextAct(portal, 'conference'), 'open_validation')
})

test('#812: a portal row opens the validation screen until it is live', () => {
  const ids = { submissionId: 'sub-7', clientId: 'client-7' }
  assert.deepEqual(portalDetailTarget('in_validation', ids), { kind: 'validation', submissionId: 'sub-7' })
  assert.deepEqual(portalDetailTarget('published', ids), {
    kind: 'client',
    clientId: 'client-7',
    tab: 'partnership',
  })
  assert.equal(
    recordHref('pt', new URLSearchParams(), { kind: 'validation', submissionId: 'sub-7' }),
    // #870 (2026-10-06): the validation opens in the drawer over the board, like the record.
    '/pt/admin/clients?validation=sub-7'
  )
})

test('#870: the validation drawer opens over the board it came from, so closing it keeps the filters', () => {
  const href = recordHref('pt', new URLSearchParams('view=table&state=in_validation&clientId=x'), {
    kind: 'validation',
    submissionId: 'sub-7',
  })
  assert.equal(href, '/pt/admin/clients?view=table&state=in_validation&validation=sub-7')
  // And closing it is the board's address without the drawer.
  assert.equal(boardPath(new URL(href, 'https://cms.test').searchParams), '/admin/clients?view=table&state=in_validation')
})

test('#870 (BR-B2B-049 item 8): after approving, the record opens on the places tab', () => {
  assert.equal(
    recordHref('pt', new URLSearchParams('view=table'), { kind: 'client', clientId: 'client-7', tab: 'places' }),
    '/pt/admin/clients?view=table&clientId=client-7&tab=places'
  )
})

test('BR-B2B-049 item 8 (#906): `Publicado` on an approved portal card fires the publication itself', () => {
  const portal = row({
    origin: 'portal',
    state: 'approved_awaiting_narration',
    clientId: 'client-9',
    attractionId: '88eb7d4f-0000-4000-8000-000000000001',
  })
  assert.deepEqual(planTransition(portal, 'curation', 'published'), { kind: 'act', act: 'publish_portal_place' })
  // The card's button and the drop cannot disagree (WCAG 2.2 SC 2.5.7).
  assert.equal(nextAct(portal, 'curation'), 'publish_portal_place')
  // A submission that names no POI has nothing to publish.
  assert.deepEqual(planTransition({ ...portal, attractionId: null }, 'curation', 'published'), {
    kind: 'blocked',
    reason: 'no_place',
  })
})

test('BR-B2B-049 item 8 (#906): any other portal state dropped on `Publicado` keeps refusing', () => {
  for (const [state, from] of [
    ['in_validation', 'conference'],
    ['changes_requested', 'conference'],
    ['awaiting_acceptance', 'awaiting_acceptance'],
  ] as [PipelineState, BoardColumnId][]) {
    const portal = row({ origin: 'portal', state, clientId: 'client-9', attractionId: 'poi-9' })
    const plan = planTransition(portal, from, 'published')
    assert.ok(plan.kind !== 'act', state)
  }
  const portal = row({ origin: 'portal', state: 'place_in_curation', clientId: 'client-9', attractionId: 'poi-9' })
  assert.deepEqual(planTransition(portal, 'curation', 'published'), { kind: 'blocked', reason: 'not_closable' })
})
