/**
 * The material queue — `/admin/materials`. What the rule promises, and what the screen wires.
 *
 * Mutations that turn this suite red:
 *  · letting a closed order reopen, in the plan or in the write;
 *  · counting a cancelled order's quantities into what has to be printed;
 *  · rounding an order with no address into a town instead of naming it as a pendency;
 *  · giving the board a second fetch or a write of its own, which is a second place for
 *    `an order does not reopen` to be forgotten;
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
  filterQueue,
  groupByColumn,
  planMaterialMove,
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

test('an order goes forward only, and the two refusals are different', () => {
  assert.deepEqual(planMaterialMove(order(), 'fulfilled'), { kind: 'act', status: 'fulfilled' })
  assert.deepEqual(planMaterialMove(order(), 'cancelled'), { kind: 'act', status: 'cancelled' })

  // Dropped back where it came from: nothing was asked.
  assert.deepEqual(planMaterialMove(order(), 'requested'), { kind: 'noop' })

  // Reopening is refused BEFORE the closed check, so dragging a fulfilled order to `Pedido`
  // says orders do not come back rather than saying this one is over.
  assert.deepEqual(planMaterialMove(order({ status: 'fulfilled' }), 'requested'), {
    kind: 'refused',
    reason: 'reopen',
  })
  assert.deepEqual(planMaterialMove(order({ status: 'fulfilled' }), 'cancelled'), {
    kind: 'refused',
    reason: 'closed',
  })
  assert.deepEqual(planMaterialMove(order({ status: 'cancelled' }), 'fulfilled'), {
    kind: 'refused',
    reason: 'closed',
  })
})

test('the write refuses the reopen too — the screen is not the guarantee', () => {
  const service = code('lib/services/material-order-service.ts')
  // The update touches only rows still `requested`; a closed order matches nothing.
  assert.match(service, /\.eq\('status', 'requested'\)/)
  assert.match(service, /status: Exclude<MaterialOrderStatus, 'requested'>/)
})

test('the dashboard counts what will be printed, and nothing else', () => {
  const summary = summarizeMaterialQueue([
    order({ id: 'a' }),
    order({
      id: 'b',
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
  ])

  assert.equal(summary.openOrders, 2)
  assert.equal(summary.openUnits, 18)
  assert.deepEqual(summary.openByKind, { sticker: 3, table_display: 10, counter_display: 5 })
  assert.equal(summary.fulfilledOrders, 1)
  assert.equal(summary.fulfilledUnits, 100)
  assert.equal(summary.cancelledOrders, 1)

  // Two orders, one town: the shipping list is by destination and not by partner.
  assert.equal(summary.destinations.length, 1)
  assert.equal(summary.destinations[0].city, 'Búzios')
  assert.equal(summary.destinations[0].orders, 2)
  assert.equal(summary.destinations[0].units, 18)
  assert.equal(summary.openWithoutDestination, 0)
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

  assert.equal(summary.openOrders, 1)
  assert.equal(summary.openWithoutDestination, 1)
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
  ])
  assert.deepEqual(columns.requested.map((row) => row.id), ['a', 'c'])
  assert.deepEqual(columns.fulfilled.map((row) => row.id), ['b'])
  assert.deepEqual(columns.cancelled, [])
})

test('the column vocabulary is the status vocabulary — three, and the same three', () => {
  assert.deepEqual([...MATERIAL_COLUMNS], ['requested', 'fulfilled', 'cancelled'])
  for (const column of MATERIAL_COLUMNS) {
    assert.ok(pt.Clients.profile.material.statuses[column], `sem rótulo para ${column}`)
    assert.ok(pt.Materials.columnHints[column], `sem dica para ${column}`)
  }
  for (const reason of ['reopen', 'closed']) {
    assert.ok(pt.Materials.refused[reason], `sem mensagem para ${reason}`)
  }
  for (const origin of ['linked_place', 'welcome_poi', 'client_address', 'none']) {
    assert.ok(pt.Materials.card.origin[origin], `sem rótulo para ${origin}`)
  }
  for (const kind of MATERIAL_KINDS) {
    assert.ok(pt.Clients.profile.material.kinds[kind], `sem rótulo para ${kind}`)
  }
})

test('the esteira stays pt-only — #408', () => {
  for (const locale of ['en', 'es']) {
    const messages = JSON.parse(read(`messages/${locale}.json`))
    assert.equal(messages.Materials, undefined, `${locale} não deve carregar Materials`)
  }
  // And the screen overlays it, so the operator reads Portuguese on any locale.
  assert.match(code('components/admin/AdminMaterialsPageContent.tsx'), /Materials: ptMessages\.Materials/)
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

  // The drag is never the only way (WCAG 2.2 SC 2.5.7): the card carries both acts as buttons.
  const card = code('components/admin/materials/MaterialCard.tsx')
  assert.match(card, /onClose\(order, 'fulfilled'\)/)
  assert.match(card, /onClose\(order, 'cancelled'\)/)
})

test('the read route is admin-only, read-only, and says when it cut the list', () => {
  const route = code('app/api/admin/materials/route.ts')
  assert.match(route, /withAuth\(\{ roles: \['admin'\] \}/)
  assert.match(route, /withRateLimit\(/)
  assert.match(route, /truncated: orders\.length >= QUEUE_CAP/)
  // No write here — closing an order has one route, and it is not this one.
  assert.equal(/export const (POST|PATCH|PUT|DELETE)/.test(route), false)
})
