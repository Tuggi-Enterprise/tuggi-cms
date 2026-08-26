/**
 * The material queue — `/admin/materials`. What the rule promises, and what the screen wires.
 *
 * Mutations that turn this suite red:
 *  · letting an order go back a column, in the plan or in the write;
 *  · letting an order skip `in_preparation`, or cancelling one the carrier already has;
 *  · counting a cancelled order's quantities into what has to be printed;
 *  · counting a dispatched order into the print run — it was already printed;
 *  · rounding an order with no address into a town instead of naming it as a pendency;
 *  · giving the board a second fetch or a write of its own, which is a second place for
 *    `an order does not go back` to be forgotten;
 *  · a second copy of the transition graph anywhere — the buttons and the `WHERE` both read it;
 *  · deciding on the card who pays, instead of reading the answer `derivePartnerPlan` gave;
 *  · a card that cannot reach the contract, or a link out of the queue with no way back;
 *  · the screen falling out of the grid the rest of the CMS draws;
 *  · a column, a refusal or a destination origin with no message behind it.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { MATERIAL_KINDS } from '@/lib/partner-form/fields'
import {
  MATERIAL_COLUMNS,
  MATERIAL_TRANSITIONS,
  filterQueue,
  groupByColumn,
  planMaterialMove,
  statusesThatMayBecome,
  summarizeMaterialQueue,
  type MaterialQueueOrder,
} from '@/lib/materials/order-queue'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const pt = JSON.parse(read('messages/pt.json'))

/** The source without its comments — a ruler that reads prose measures the prose. */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function order(over: Partial<MaterialQueueOrder> = {}): MaterialQueueOrder {
  return {
    id: over.id ?? 'order-1',
    clientId: over.clientId ?? 'client-1',
    clientName: over.clientName ?? 'Baires Bistrô',
    status: over.status ?? 'requested',
    source: over.source ?? 'proposal',
    notes: over.notes ?? null,
    createdAt: over.createdAt ?? '2026-08-20T12:00:00Z',
    stance: over.stance ?? 'paying',
    items: over.items ?? [
      { kind: 'sticker', quantity: 3 },
      { kind: 'table_display', quantity: 10 },
    ],
    destination: over.destination ?? {
      attractionId: 'poi-1',
      name: 'Baires Bistrô',
      city: 'Búzios',
      region: 'RJ',
      country: 'Brazil',
      origin: 'linked_place',
    },
  }
}

test('the esteira runs forward, and `in_preparation` is the only fork', () => {
  assert.deepEqual(planMaterialMove(order(), 'in_preparation'), {
    kind: 'act',
    status: 'in_preparation',
  })
  assert.deepEqual(planMaterialMove(order(), 'cancelled'), { kind: 'act', status: 'cancelled' })

  // The fork the operator asked for on 2026-08-26: material handed over at the counter never
  // rides a carrier, so `fulfilled` is reachable from preparation without passing `dispatched`.
  const prep = order({ status: 'in_preparation' })
  assert.deepEqual(planMaterialMove(prep, 'dispatched'), { kind: 'act', status: 'dispatched' })
  assert.deepEqual(planMaterialMove(prep, 'fulfilled'), { kind: 'act', status: 'fulfilled' })
  assert.deepEqual(planMaterialMove(prep, 'cancelled'), { kind: 'act', status: 'cancelled' })

  assert.deepEqual(planMaterialMove(order({ status: 'dispatched' }), 'fulfilled'), {
    kind: 'act',
    status: 'fulfilled',
  })

  // Dropped back where it came from: nothing was asked.
  assert.deepEqual(planMaterialMove(order(), 'requested'), { kind: 'noop' })
})

test('the four refusals are different, and each says its own thing', () => {
  // Reopening is refused BEFORE the closed check, so dragging a delivered order to `Pedido`
  // says orders do not come back rather than saying this one is over.
  assert.deepEqual(planMaterialMove(order({ status: 'fulfilled' }), 'requested'), {
    kind: 'refused',
    reason: 'reopen',
  })
  // Backwards inside the esteira is the same refusal.
  assert.deepEqual(planMaterialMove(order({ status: 'dispatched' }), 'in_preparation'), {
    kind: 'refused',
    reason: 'reopen',
  })

  // An order that already ended does not move to the other ending.
  assert.deepEqual(planMaterialMove(order({ status: 'fulfilled' }), 'cancelled'), {
    kind: 'refused',
    reason: 'closed',
  })
  assert.deepEqual(planMaterialMove(order({ status: 'cancelled' }), 'fulfilled'), {
    kind: 'refused',
    reason: 'closed',
  })

  // Skipping preparation: nothing is printed by dragging a card two columns.
  assert.deepEqual(planMaterialMove(order(), 'dispatched'), { kind: 'refused', reason: 'skip' })
  assert.deepEqual(planMaterialMove(order(), 'fulfilled'), { kind: 'refused', reason: 'skip' })

  // The box is with the carrier: cancelling it would say nothing was produced.
  assert.deepEqual(planMaterialMove(order({ status: 'dispatched' }), 'cancelled'), {
    kind: 'refused',
    reason: 'shipped',
  })
})

test('the graph read backwards is what the write puts in its WHERE', () => {
  assert.deepEqual(statusesThatMayBecome('in_preparation'), ['requested'])
  assert.deepEqual(statusesThatMayBecome('dispatched'), ['in_preparation'])
  assert.deepEqual(statusesThatMayBecome('fulfilled'), ['in_preparation', 'dispatched'])
  assert.deepEqual(statusesThatMayBecome('cancelled'), ['requested', 'in_preparation'])
  // Nothing may become `requested`, so the update could never match a row — and the type
  // refuses the call before that.
  assert.deepEqual(statusesThatMayBecome('requested'), [])
})

test('the write refuses the illegal move too — the screen is not the guarantee', () => {
  const service = code('lib/services/material-order-service.ts')
  // The `WHERE` IS the graph, not a constant: `.in('status', statusesThatMayBecome(status))`.
  assert.match(service, /\.in\('status', statusesThatMayBecome\(status\)\)/)
  assert.equal(service.includes(".eq('status', 'requested')"), false)
  assert.match(service, /status: MaterialMoveStatus/)
  // And the vocabulary is not re-declared beside the graph.
  assert.match(service, /MATERIAL_ORDER_STATUSES = MATERIAL_COLUMNS/)
})

test('the transition graph has exactly one copy, and both surfaces read it', () => {
  // The buttons are derived from it (WCAG 2.2 SC 2.5.7 without a second list of arrows)…
  assert.match(
    code('components/admin/materials/MaterialMoveButtons.tsx'),
    /MATERIAL_TRANSITIONS\[status\]/
  )
  // …and the two screens that offer the moves both render that component.
  for (const path of [
    'components/admin/materials/MaterialCard.tsx',
    'components/admin/clients/shared/MaterialOrders.tsx',
  ]) {
    assert.match(code(path), /<MaterialMoveButtons/, `${path} não usa os botões da esteira`)
  }
  // A terminal status offers nothing.
  assert.deepEqual([...MATERIAL_TRANSITIONS.fulfilled], [])
  assert.deepEqual([...MATERIAL_TRANSITIONS.cancelled], [])
})

test('the dashboard counts what will be printed, and nothing else', () => {
  const summary = summarizeMaterialQueue([
    order({ id: 'a' }),
    order({
      id: 'b',
      status: 'in_preparation',
      items: [{ kind: 'counter_display', quantity: 5 }],
      destination: {
        attractionId: null,
        name: 'Tucas',
        city: 'Búzios',
        region: 'RJ',
        country: 'Brazil',
        origin: 'client_address',
      },
    }),
    order({ id: 'c', status: 'fulfilled', items: [{ kind: 'sticker', quantity: 100 }] }),
    // Cancelled: counted as an order, and its quantities count nowhere.
    order({ id: 'd', status: 'cancelled', items: [{ kind: 'sticker', quantity: 999 }] }),
    // Dispatched: already printed. Counting it into `A produzir` prints it twice.
    order({ id: 'e', status: 'dispatched', items: [{ kind: 'table_display', quantity: 7 }] }),
  ])

  // `requested` and `in_preparation` are what has not left; both count into the print run.
  assert.equal(summary.pendingOrders, 2)
  assert.equal(summary.pendingUnits, 18)
  assert.deepEqual(summary.pendingByKind, { sticker: 3, table_display: 10, counter_display: 5 })
  assert.equal(summary.dispatchedOrders, 1)
  assert.equal(summary.dispatchedUnits, 7)
  assert.equal(summary.fulfilledOrders, 1)
  assert.equal(summary.fulfilledUnits, 100)
  assert.equal(summary.cancelledOrders, 1)

  // Two orders, one town: the shipping list is by destination and not by partner.
  assert.equal(summary.destinations.length, 1)
  assert.equal(summary.destinations[0].city, 'Búzios')
  assert.equal(summary.destinations[0].orders, 2)
  assert.equal(summary.destinations[0].units, 18)
  assert.equal(summary.pendingWithoutDestination, 0)
})

test('an order with no address is a pendency, never a town', () => {
  const summary = summarizeMaterialQueue([
    order({
      id: 'x',
      destination: {
        attractionId: null,
        name: null,
        city: null,
        region: null,
        country: null,
        origin: 'none',
      },
    }),
  ])

  assert.equal(summary.pendingOrders, 1)
  assert.equal(summary.pendingWithoutDestination, 1)
  assert.deepEqual(summary.destinations, [])
})

test('the towns come heaviest first, and the tie is broken by name', () => {
  const at = (city: string, quantity: number, id: string) =>
    order({
      id,
      items: [{ kind: 'sticker', quantity }],
      destination: {
        attractionId: null,
        name: city,
        city,
        region: 'RJ',
        country: 'Brazil',
        origin: 'linked_place',
      },
    })

  const summary = summarizeMaterialQueue([at('Angra', 5, '1'), at('Búzios', 40, '2'), at('Arraial', 5, '3')])
  assert.deepEqual(
    summary.destinations.map((line) => line.city),
    ['Búzios', 'Angra', 'Arraial']
  )
})

test('the filter is accent-insensitive and reads partner, place and town', () => {
  const rows = [order({ id: 'a' }), order({ id: 'b', clientName: 'Café Central', destination: {
    attractionId: null, name: 'Café Central', city: 'Petrópolis', region: 'RJ', country: 'Brazil',
    origin: 'linked_place' } })]

  assert.deepEqual(filterQueue(rows, 'buzios').map((row) => row.id), ['a'])
  assert.deepEqual(filterQueue(rows, 'PETROPOLIS').map((row) => row.id), ['b'])
  assert.deepEqual(filterQueue(rows, '  ').map((row) => row.id), ['a', 'b'])
})

test('every card sits under its own status, in the order it was loaded', () => {
  const columns = groupByColumn([
    order({ id: 'a' }),
    order({ id: 'b', status: 'fulfilled' }),
    order({ id: 'c' }),
    order({ id: 'd', status: 'in_preparation' }),
    order({ id: 'e', status: 'dispatched' }),
  ])
  assert.deepEqual(columns.requested.map((row) => row.id), ['a', 'c'])
  assert.deepEqual(columns.in_preparation.map((row) => row.id), ['d'])
  assert.deepEqual(columns.dispatched.map((row) => row.id), ['e'])
  assert.deepEqual(columns.fulfilled.map((row) => row.id), ['b'])
  assert.deepEqual(columns.cancelled, [])
})

test('the column vocabulary is the status vocabulary — five, and the same five', () => {
  assert.deepEqual(
    [...MATERIAL_COLUMNS],
    ['requested', 'in_preparation', 'dispatched', 'fulfilled', 'cancelled']
  )
  for (const column of MATERIAL_COLUMNS) {
    assert.ok(pt.Clients.profile.material.statuses[column], `sem rótulo para ${column}`)
    assert.ok(pt.Materials.columnHints[column], `sem dica para ${column}`)
  }
  // Every move the graph allows has a verb the operator can click.
  for (const targets of Object.values(MATERIAL_TRANSITIONS)) {
    for (const target of targets) {
      const key = { in_preparation: 'prepare', dispatched: 'dispatch', fulfilled: 'fulfil', cancelled: 'cancel' }[
        target as 'in_preparation' | 'dispatched' | 'fulfilled' | 'cancelled'
      ]
      assert.ok(pt.Clients.profile.material.actions[key], `sem verbo para ${target}`)
    }
  }
  for (const reason of ['reopen', 'closed', 'skip', 'shipped']) {
    assert.ok(pt.Materials.refused[reason], `sem mensagem para ${reason}`)
  }
  for (const origin of ['linked_place', 'welcome_poi', 'client_address', 'none']) {
    assert.ok(pt.Materials.card.origin[origin], `sem rótulo para ${origin}`)
  }
  for (const kind of MATERIAL_KINDS) {
    assert.ok(pt.Clients.profile.material.kinds[kind], `sem rótulo para ${kind}`)
  }
})

test('the card carries who pays, and does not decide it', () => {
  const card = code('components/admin/materials/MaterialCard.tsx')
  // The same symbol every other surface draws, fed by the order and not by a comparison here.
  assert.match(card, /<PaymentStanceBadge stance=\{order\.stance\} \/>/)
  assert.equal(/monthlyFeeCents|is_courtesy|=== 'paid'/.test(card), false)

  // The decision is `derivePartnerPlan` + `paymentStance`, in the service — never a fourth copy.
  const service = code('lib/services/material-order-service.ts')
  assert.match(service, /derivePartnerPlan\(/)
  assert.match(service, /return paymentStance\(plan\.kind\)/)
})

test('the card reaches the contract and the QR, and both know the way back', () => {
  const card = code('components/admin/materials/MaterialCard.tsx')
  // The contract page of the partner — its own route, not a tab of the modal.
  assert.match(card, /\/admin\/clients\/\$\{order\.clientId\}\/contract\?\$\{back\}/)
  // And the record on `tab=profile`, which is where `ClientQrCode` draws the QR.
  assert.match(card, /clientId=\$\{order\.clientId\}&tab=profile&\$\{back\}/)
  // DS-LAYOUT-006, point 2: the way back is a composed sentence, from the shared module.
  assert.match(card, /returnParams\(`\/\$\{locale\}\/admin\/materials`/)
  assert.ok(pt.Materials.card.backToQueue, 'sem frase de volta')
  assert.ok(pt.Materials.card.contract, 'sem rótulo do contrato')
})

test('the screen sits in the same grid as the rest of the CMS', () => {
  const board = code('components/admin/materials/MaterialBoard.tsx')
  // The rail and the content column, the same split `/admin/clients` and `/places` draw…
  assert.match(board, /w-\[18%\]/)
  assert.match(board, /lg:w-\[82%\]/)
  // …and the sticky rounded title bar over the content.
  assert.match(board, /sticky top-0 z-30 mb-4 rounded-3xl/)
  // Below `lg` the rail is not a rail: the same panel rides above the board.
  assert.match(board, /lg:hidden/)
  assert.ok(pt.Materials.subtitle, 'sem subtítulo na barra')
})

test('the esteira stays pt-only — #408', () => {
  for (const locale of ['en', 'es']) {
    const messages = JSON.parse(read(`messages/${locale}.json`))
    assert.equal(messages.Materials, undefined, `${locale} não deve carregar Materials`)
  }
  // And the screen overlays it, so the operator reads Portuguese on any locale — including the
  // accessible name of the payment symbol, which is the only text that badge has.
  const host = code('components/admin/AdminMaterialsPageContent.tsx')
  assert.match(host, /Materials: ptMessages\.Materials/)
  assert.match(host, /stance: ptMessages\.Clients\.stance/)
})

test('one read feeds the board, and the write is the route that already existed', () => {
  const host = code('components/admin/AdminMaterialsPageContent.tsx')
  const board = code('components/admin/materials/MaterialBoard.tsx')

  // The read.
  assert.match(host, /fetch\('\/api\/admin\/materials'\)/)
  // The write — the per-client route, keyed by the partner on the card.
  assert.match(host, /\/api\/admin\/clients\/\$\{order\.clientId\}\/material-orders/)
  assert.match(host, /method: 'PATCH'/)

  // The board fetches nothing and decides no transition inline.
  assert.equal(board.includes('fetch('), false)
  assert.match(board, /planMaterialMove\(order, String\(event\.over\.id\)/)
  // The dashboard is computed from the same array the columns render.
  assert.match(board, /summarizeMaterialQueue\(visible\)/)
  assert.match(board, /groupByColumn\(visible\)/)

  // The drag is never the only way (WCAG 2.2 SC 2.5.7): the card carries the moves as buttons.
  const card = code('components/admin/materials/MaterialCard.tsx')
  assert.match(card, /onMove=\{\(status\) => onMove\(order, status\)\}/)
})

test('the read route is admin-only, read-only, and says when it cut the list', () => {
  const route = code('app/api/admin/materials/route.ts')
  assert.match(route, /withAuth\(\{ roles: \['admin'\] \}/)
  assert.match(route, /withRateLimit\(/)
  assert.match(route, /truncated: orders\.length >= QUEUE_CAP/)
  // No write here — closing an order has one route, and it is not this one.
  assert.equal(/export const (POST|PATCH|PUT|DELETE)/.test(route), false)
})
