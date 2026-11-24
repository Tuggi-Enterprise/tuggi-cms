/**
 * A FREE PARTNER'S SAVED PHOTO AND STORY REACH ITS ROW. #1000.
 *
 * Operator decision of 2026-10-22: the free tier can save a photo and the story on `/status`
 * without publishing (`place_change_requests.status = 'held'`, #998), and the operator wants to
 * see on the partner's card who already did, as the sign of being close to subscribing.
 *
 * `loadClientDirectory` runs whole here with the service client stood in, because the fact has
 * two hops: the held read keys it by submission, and the legacy mirror that carries it folds into
 * its client's row (#991). Proving either hop alone would let the other drop the badge.
 *
 * Mutations that turn this suite red:
 *  · reading the change requests by any status other than `held` (the queue's `pending` leaks in);
 *  · a read per submission instead of one;
 *  · `fold` not carrying the two flags (the badge never reaches the client's row);
 *  · mapping `text` to the photo flag, or the other way round;
 *  · a failed held read failing the board instead of only the badges.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'

import ptMessages from '@/messages/pt.json'
import type { ClientDirectoryRow } from '@/lib/services/partnership-service'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const MIRROR = '22222222-2222-4222-8222-222222222222'

interface Read {
  table: string
  filters: [string, unknown][]
}

const w = {
  reads: [] as Read[],
  held: [] as { submission_id: string; kind: string }[],
  heldError: null as { code: string } | null,
}

function reset(overrides: Partial<typeof w> = {}) {
  w.reads = []
  w.held = []
  w.heldError = null
  Object.assign(w, overrides)
}

const TABLES: Record<string, () => { data: unknown; error: unknown }> = {
  place_submissions: () => ({
    data: [
      {
        id: MIRROR,
        status: 'live',
        answers: { trade_name: 'Bar do Zé', city: 'Cabo Frio', state: 'RJ' },
        attraction_id: null,
        client_id: null,
        legacy_client_id: CLIENT,
        submitted_at: '2026-10-01T12:00:00.000Z',
        status_changed_at: '2026-10-01T12:00:00.000Z',
      },
    ],
    error: null,
  }),
  place_change_requests: () => ({ data: w.heldError ? null : w.held, error: w.heldError }),
}

function table(name: string) {
  const read: Read = { table: name, filters: [] }
  w.reads.push(read)
  const q = {
    select: () => q,
    eq: (column: string, value: unknown) => (read.filters.push([column, value]), q),
    in: (column: string, value: unknown) => (read.filters.push([column, value]), q),
    order: () => q,
    limit: () => q,
    then: (resolve: (value: unknown) => unknown) => resolve((TABLES[name] ?? (() => ({ data: [], error: null })))()),
  }
  return q
}

const service = {
  schema: () => ({
    rpc: async (name: string) => {
      if (name === 'cms_client_directory') {
        return {
          data: {
            submissions: [],
            clients: [
              { id: CLIENT, name: 'Bar do Zé', city: 'Cabo Frio', state: 'Rio de Janeiro', country: 'Brazil', status: 'approved' },
            ],
            contracts: [],
            conferences: [],
            refusals: [],
            truncated: false,
          },
          error: null,
        }
      }
      return { data: [], error: null }
    },
    from: (name: string) => table(name),
  }),
}

// The operator's client only answers the places read, and a place read that throws is the
// documented degradation to "no places": this suite is about the held changes.
const operator = {} as never

let directory: typeof import('@/lib/services/partnership-service')

before(async () => {
  mock.module('@/lib/core/supabase-client', { namedExports: { getSupabaseService: () => service } })
  directory = await import('@/lib/services/partnership-service')
})

beforeEach(() => reset())

async function clientRow(): Promise<ClientDirectoryRow> {
  const { rows } = await directory.loadClientDirectory(operator)
  // The mirror folds into its client's record (#991): one row, the client's.
  assert.equal(rows.length, 1)
  assert.equal(rows[0].clientId, CLIENT)
  return rows[0]
}

function heldReads(): Read[] {
  return w.reads.filter((read) => read.table === 'place_change_requests')
}

test('#1000: no held change, no badge and no error (zero rows is the state until #998 writes one)', async () => {
  const row = await clientRow()
  assert.equal(row.hasHeldPhoto, false)
  assert.equal(row.hasHeldStory, false)
  // One read, by status and never by a list of ids (the URL ceiling of `.in`).
  assert.deepEqual(heldReads().map((read) => read.filters), [[['status', 'held']]])
})

test('#1000: a held photo marks the client row with `foto salva` only', async () => {
  reset({
    held: [
      { submission_id: MIRROR, kind: 'photo' },
      { submission_id: MIRROR, kind: 'photo' },
    ],
  })
  const row = await clientRow()
  assert.equal(row.hasHeldPhoto, true)
  assert.equal(row.hasHeldStory, false)
  assert.equal(heldReads().length, 1)
})

test('#1000: a held text marks the client row with `história salva` only', async () => {
  reset({ held: [{ submission_id: MIRROR, kind: 'text' }] })
  const row = await clientRow()
  assert.equal(row.hasHeldPhoto, false)
  assert.equal(row.hasHeldStory, true)
})

test('#1000: a held change of another submission marks nothing here', async () => {
  reset({ held: [{ submission_id: '33333333-3333-4333-8333-333333333333', kind: 'photo' }] })
  const row = await clientRow()
  assert.equal(row.hasHeldPhoto, false)
  assert.equal(row.hasHeldStory, false)
})

test('#1000: a failed held read loses the badges, never the board', async () => {
  reset({ held: [{ submission_id: MIRROR, kind: 'photo' }], heldError: { code: '42P01' } })
  const row = await clientRow()
  assert.equal(row.hasHeldPhoto, false)
  assert.equal(row.hasHeldStory, false)
})

test('#1000: the badges read `Foto salva` and `História salva`, and nothing when nothing is held', async () => {
  const { HeldBadges } = await import('@/components/admin/clients/shared/HeldBadges')
  const render = (hasHeldPhoto: boolean, hasHeldStory: boolean) =>
    renderToStaticMarkup(
      // eslint-disable-next-line react/no-children-prop
      createElement(NextIntlClientProvider, {
        locale: 'pt',
        messages: { Clients: ptMessages.Clients },
        timeZone: 'America/Sao_Paulo',
        children: createElement(HeldBadges, { row: { hasHeldPhoto, hasHeldStory } }),
      })
    )
  assert.equal(render(false, false), '')
  assert.match(render(true, false), />Foto salva</)
  assert.doesNotMatch(render(true, false), /História salva/)
  assert.match(render(false, true), />História salva</)
  const both = render(true, true)
  assert.ok(both.indexOf('Foto salva') < both.indexOf('História salva'))
})
