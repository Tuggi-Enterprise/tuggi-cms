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
 *  · letting a drag FIRE the promotion, the first contract or the publication instead of
 *    opening the panel that asks (BR-B2B-018 — that last one starts the monthly fee);
 *  · letting a drag onto `Contrato assinado` do anything at all (BR-B2B-026, item 5: the
 *    partner signs, not us);
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
  TERMINAL_WINDOW,
  buildBoardView,
  columnOf,
  nextAct,
  planTransition,
  unmappedStates,
  type BoardColumnId,
} from '@/lib/clients/board-transitions'
import { EMPTY_FILTERS, buildDirectoryView, type DirectoryFilters } from '@/lib/clients/directory-filter'
import { PIPELINE_STATES, type PipelineState } from '@/lib/partnerships/pipeline'
import type { ClientDirectoryRow } from '@/lib/services/partnership-service'

const PLACES = { total: 0, published: 0, blocking: 0, silencing: 0, improving: 0, allReady: false }

function row(overrides: Partial<ClientDirectoryRow> = {}): ClientDirectoryRow {
  return {
    submissionId: 'sub-1',
    clientId: 'client-1',
    state: 'client_created',
    href: '/admin/clients?clientId=client-1',
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
    ...overrides,
  }
}

const filters = (overrides: Partial<DirectoryFilters> = {}): DirectoryFilters => ({
  ...EMPTY_FILTERS,
  ...overrides,
})

// ── The mapping — DS-COPY-020 ────────────────────────────────────────────────────────────────

test('#409 · every pipeline state has exactly one home: a column, or the alert band', () => {
  assert.deepEqual(unmappedStates(), [], 'a state with no column is a row that vanishes')

  const seen = new Map<PipelineState, BoardColumnId>()
  for (const column of BOARD_COLUMNS) {
    for (const state of COLUMN_STATES[column]) {
      assert.equal(seen.has(state), false, `${state} is in two columns`)
      seen.set(state, column)
    }
  }

  // Total: every state is either mapped or the alert.
  for (const state of PIPELINE_STATES) {
    if (state === ALERT_STATE) continue
    assert.equal(typeof columnOf(state), 'string', `${state} has no column`)
  }
})

test('#409 · DS-COPY-020 point 5: a refusal nobody communicated gets no column', () => {
  assert.equal(columnOf(ALERT_STATE), null)

  const owed = row({ state: ALERT_STATE, places: { ...PLACES, total: 2, published: 1 } })
  const view = buildBoardView([owed], filters(), { expanded: TERMINAL_COLUMNS })

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
  const plan = planTransition(row({ state: 'proposal_received', clientId: null }), 'proposal', 'client')
  assert.deepEqual(plan, { kind: 'not_adjacent', nextColumn: 'conference' })

  assert.deepEqual(planTransition(row(), 'client', 'client'), { kind: 'noop' })
})

// ── The acts, edge by edge ───────────────────────────────────────────────────────────────────

test('#409 · 1 → 2: the conference of a proposal, and never of a promoted one', () => {
  const fresh = row({ state: 'proposal_received', clientId: null })
  assert.deepEqual(planTransition(fresh, 'proposal', 'conference'), {
    kind: 'act',
    act: 'record_conference',
  })

  const promoted = row({ state: 'proposal_received' })
  assert.deepEqual(planTransition(promoted, 'proposal', 'conference'), {
    kind: 'blocked',
    reason: 'already_promoted',
  })

  const orphan = row({ state: 'proposal_received', clientId: null, submissionId: null })
  assert.deepEqual(planTransition(orphan, 'proposal', 'conference'), {
    kind: 'blocked',
    reason: 'no_submission',
  })
})

test('#409 · DS-COMPONENTE-018: 2 → 3 OPENS the promotion, it does not fire it', () => {
  const ready = row({ state: 'in_conference', clientId: null })
  assert.deepEqual(planTransition(ready, 'conference', 'client'), {
    kind: 'act',
    act: 'open_promotion',
  })
})

test('#409 · BR-B2B-022: 3 → 4 sends a draft, and opens the page when there is no contract', () => {
  const drafted = row({ contract: 'draft' })
  assert.deepEqual(planTransition(drafted, 'client', 'contract_sent'), {
    kind: 'act',
    act: 'send_contract',
  })

  // No contract yet: `generate` needs tier, payment method and QR delivery, and a gesture
  // chooses none of them. BR-B2B-017 — the price is not a side effect of a drag.
  for (const state of ['none', 'superseded', 'terminated'] as const) {
    assert.deepEqual(planTransition(row({ contract: state }), 'client', 'contract_sent'), {
      kind: 'act',
      act: 'open_contract',
    })
  }

  const proposalOnly = row({ clientId: null })
  assert.deepEqual(planTransition(proposalOnly, 'client', 'contract_sent'), {
    kind: 'blocked',
    reason: 'no_client',
  })
})

test('#409 · BR-B2B-026 item 5: 4 → 5 is the partner’s act, and produces none of ours', () => {
  const sent = row({ state: 'contract_sent', contract: 'sent' })
  assert.deepEqual(planTransition(sent, 'contract_sent', 'contract_signed'), {
    kind: 'blocked',
    reason: 'partner_acts',
  })
  assert.equal(nextAct(sent, 'contract_sent'), null)
})

test('#409 · 5 → 6 provisions the place, once', () => {
  const signed = row({ state: 'contract_signed', contract: 'signed' })
  assert.deepEqual(planTransition(signed, 'contract_signed', 'curation'), {
    kind: 'act',
    act: 'create_place',
  })

  const provisioned = row({ contract: 'signed', places: { ...PLACES, total: 1 } })
  assert.deepEqual(planTransition(provisioned, 'contract_signed', 'curation'), {
    kind: 'blocked',
    reason: 'place_exists',
  })
})

test('#409 · BR-B2B-011: 6 → 7 opens the publication, and a blocking pendency stops it', () => {
  const ready = row({ state: 'place_in_curation', contract: 'signed', places: { ...PLACES, total: 1 } })
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
})

test('#409 · BR-B2B-018: the acts a GESTURE can fire are a closed list, and it is the safe one', () => {
  // Every act any edge can produce, over rows covering every shape the board has.
  const produced = new Set<string>()
  const rows = [
    row({ clientId: null, submissionId: 's1' }),
    row({ contract: 'none' }),
    row({ contract: 'draft' }),
    row({ contract: 'sent' }),
    row({ contract: 'signed' }),
    row({ contract: 'signed', places: { ...PLACES, total: 1 } }),
    row({ contract: 'signed', places: { ...PLACES, total: 3, published: 1, blocking: 2 } }),
  ]
  for (const candidate of rows) {
    for (const from of BOARD_COLUMNS) {
      for (const to of BOARD_COLUMNS) {
        const plan = planTransition(candidate, from, to)
        if (plan.kind === 'act') produced.add(plan.act)
      }
    }
  }

  // The three acts that cost money or cannot be taken back reach the operator ONLY as a panel:
  // the promotion's per-column ticks, the contract's tier and price (BR-B2B-017), and the
  // publication that starts the monthly fee (BR-B2B-018). No `promote_*`, `publish_*` or
  // `discard_*` variant that writes on its own may exist in the union at all.
  const firedDirectly = ['record_conference', 'send_contract', 'create_place']
  const openedAsPanel = ['open_promotion', 'open_contract', 'open_publish', 'open_discard']

  assert.deepEqual(
    Array.from(produced).sort(),
    firedDirectly.concat(openedAsPanel).sort(),
    'an act appeared that is neither a safe request nor a panel'
  )
})

// ── Closing ──────────────────────────────────────────────────────────────────────────────────

test('#409 · Encerrados has two doors: discarding a proposal, and nothing else yet', () => {
  const fresh = row({ state: 'proposal_received', clientId: null })
  assert.deepEqual(planTransition(fresh, 'proposal', 'closed'), {
    kind: 'act',
    act: 'open_discard',
  })
  assert.deepEqual(planTransition(row({ state: 'in_conference', clientId: null }), 'conference', 'closed'), {
    kind: 'act',
    act: 'open_discard',
  })

  // A CLIENT is not closable here: `clients.status = 'rejected'` is not read by
  // `derivePipelineState`, so a rejected client re-derives `client_created` and the card would
  // come back to column 3 on the next read — a gesture that looks like it worked and did not.
  for (const from of ['client', 'contract_sent', 'contract_signed', 'curation', 'published'] as BoardColumnId[]) {
    assert.deepEqual(planTransition(row(), from, 'closed'), {
      kind: 'blocked',
      reason: 'not_closable',
    })
  }
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

  for (const state of ['client_created', 'contract_sent', 'contract_signed'] as const) {
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
  row({ clientId: 'c3', state: 'client_created' }),
  row({ clientId: 'c4', state: 'contract_sent', contract: 'sent' }),
  row({ clientId: 'c5', state: 'contract_signed', contract: 'signed' }),
  row({ clientId: 'c6', state: 'place_in_curation', contract: 'signed' }),
  row({ clientId: 'c7', state: 'published', contract: 'signed' }),
  row({ clientId: 'c8', state: 'discarded' }),
  row({ clientId: 'c9', state: 'refused_at_triage' }),
  row({ clientId: 'c10', state: ALERT_STATE }),
]

test('#409 · no row is lost: the columns plus the alert are exactly what the rail counted', () => {
  for (const applied of [filters(), filters({ state: 'in_progress' }), filters({ search: 'zé' })]) {
    const view = buildBoardView(SPREAD, applied, { expanded: TERMINAL_COLUMNS })
    const carried = view.columns.reduce((sum, column) => sum + column.total, 0) + view.alert.length
    assert.equal(carried, buildDirectoryView(SPREAD, applied).rows.length)
  }
})

test('#409 · a terminal column is collapsed by default, and counts what it does not show', () => {
  const view = buildBoardView(SPREAD, filters())
  for (const id of TERMINAL_COLUMNS) {
    const column = view.columns.find((candidate) => candidate.id === id)!
    assert.equal(column.collapsed, true)
    assert.deepEqual(column.rows, [])
    assert.equal(column.overflow, column.total, `${id} must not claim to be showing rows`)
  }

  // A working column is never collapsed and never windowed.
  const client = view.columns.find((candidate) => candidate.id === 'client')!
  assert.equal(client.collapsed, false)
  assert.equal(client.overflow, 0)
  assert.equal(client.rows.length, client.total)
})

test('#409 · an expanded terminal column windows to the NEWEST rows, and says what it left out', () => {
  const many = Array.from({ length: TERMINAL_WINDOW + 5 }, (_, index) =>
    row({
      clientId: `pub-${index}`,
      state: 'published',
      // Ascending: the last one built is the most recent.
      since: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    })
  )

  const column = buildBoardView(many, filters(), { expanded: ['published'] }).columns.find(
    (candidate) => candidate.id === 'published'
  )!

  assert.equal(column.total, TERMINAL_WINDOW + 5)
  assert.equal(column.rows.length, TERMINAL_WINDOW)
  assert.equal(column.overflow, 5)
  // Newest first — the opposite of `compareRows`, which puts the most idle row on top because
  // that is what work looks like. In an archive it would surface the oldest fossils.
  assert.equal(column.rows[0].clientId, `pub-${TERMINAL_WINDOW + 4}`)
})

test('#409 · the board never filters on its own: it hands the rail its own view back', () => {
  const applied = filters({ state: 'published' })
  const view = buildBoardView(SPREAD, applied, { expanded: TERMINAL_COLUMNS })
  assert.deepEqual(
    view.directory.rows.map((item) => item.clientId),
    buildDirectoryView(SPREAD, applied).rows.map((item) => item.clientId)
  )
})
