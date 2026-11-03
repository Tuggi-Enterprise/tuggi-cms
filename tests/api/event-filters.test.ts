/**
 * The filters of the events screen (#1078): what the URL says is what the RPCs receive.
 *
 * Mutations that turn this suite red:
 *  · dropping a filter from scopeArgs (list and facets would disagree with the sidebar);
 *  · sending an empty category list instead of null (the RPC would still match all, but a
 *    stale "[]" in the URL would be written back);
 *  · letting the page or the view mode count as an active filter (the clear button would show
 *    on a clean screen);
 *  · grouping the 'manual' source away because its label is null.
 *
 * Run with: npm run test:api
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  EMPTY_EVENT_FILTERS,
  hasActiveEventFilters,
  readEventFilters,
  toEventFilters,
  writeEventFilters,
} from '@/lib/core/event-filter-params'
import { groupFilterOptions, scopeArgs } from '@/lib/core/event-service'

const SOURCE = '0b1d6c1e-5f3a-4c8e-9a51-2d6f0f2a7b11'

test('#1078: the URL of "Paris, exhibition, free, no image" reads back the same filters', () => {
  const url = new URLSearchParams(
    `country=France&state=%C3%8Ele-de-France&city=Paris&category=exhibition,music&source=${SOURCE}` +
      '&from=2026-11-01&to=2026-11-30&free=free&noImage=1&noTriggerPoints=1&status=approved&time=upcoming&page=3&view=map',
  )
  const f = readEventFilters(url)
  assert.equal(f.city, 'Paris')
  assert.equal(f.state, 'Île-de-France')
  assert.deepEqual(f.categories, ['exhibition', 'music'])
  assert.equal(f.source, SOURCE)
  assert.equal(f.free, 'free')
  assert.equal(f.missingImage, true)
  assert.equal(f.missingTriggerPoints, true)
  assert.equal(f.page, 3)
  assert.equal(f.view, 'map')
  const sorted = (p: URLSearchParams) => { p.sort(); return p.toString() }
  assert.equal(sorted(writeEventFilters(f)), sorted(new URLSearchParams(url)))
})

test('#1078: a clean screen has a clean URL, and junk in the URL falls back to the default', () => {
  assert.equal(writeEventFilters(EMPTY_EVENT_FILTERS).toString(), '')
  const f = readEventFilters(new URLSearchParams('free=maybe&status=x&from=1-2-3&page=-4&view=table'))
  assert.deepEqual(f, EMPTY_EVENT_FILTERS)
})

test('#1078: page and view mode are not filters; any sidebar choice is', () => {
  assert.equal(hasActiveEventFilters({ ...EMPTY_EVENT_FILTERS, page: 4, view: 'list' }), false)
  assert.equal(hasActiveEventFilters({ ...EMPTY_EVENT_FILTERS, missingTriggerPoints: true }), true)
  assert.equal(hasActiveEventFilters({ ...EMPTY_EVENT_FILTERS, source: 'manual' }), true)
  assert.equal(hasActiveEventFilters({ ...EMPTY_EVENT_FILTERS, categories: ['kids'] }), true)
})

test('#1078: every sidebar filter reaches cms_list_events and cms_event_facets', () => {
  const f = readEventFilters(
    new URLSearchParams(`country=France&state=X&city=Paris&category=exhibition&source=manual&free=paid&noImage=1&noTriggerPoints=1&search=expo`),
  )
  assert.deepEqual(scopeArgs(toEventFilters(f)), {
    search_term: 'expo',
    country_filter: 'France',
    state_filter: 'X',
    city_filter: 'Paris',
    category_filter: ['exhibition'],
    source_filter: 'manual',
    free_filter: 'paid',
    missing_image: true,
    missing_trigger_points: true,
  })
  assert.deepEqual(scopeArgs({}), {
    search_term: null,
    country_filter: null,
    state_filter: null,
    city_filter: null,
    category_filter: null,
    source_filter: null,
    free_filter: 'all',
    missing_image: false,
    missing_trigger_points: false,
  })
})

test('#1078: the period is the whole local day, from its first to its last instant', () => {
  const ef = toEventFilters({ ...EMPTY_EVENT_FILTERS, from: '2026-11-01', to: '2026-11-30' })
  const after = new Date(ef.startsAfter as string)
  const before = new Date(ef.startsBefore as string)
  assert.deepEqual([after.getFullYear(), after.getMonth(), after.getDate(), after.getHours()], [2026, 10, 1, 0])
  assert.deepEqual([before.getDate(), before.getHours(), before.getMinutes()], [30, 23, 59])
  assert.equal(toEventFilters(EMPTY_EVENT_FILTERS).startsAfter, null)
})

test('#1078: filter options group by kind and keep the manual source, whose label is null', () => {
  const g = groupFilterOptions([
    { kind: 'country', value: 'France', label: 'France', count: '12' },
    { kind: 'category', value: 'exhibition', label: 'exhibition', count: 4 },
    { kind: 'source', value: SOURCE, label: 'Que faire à Paris (Ville de Paris)', count: 0 },
    { kind: 'source', value: 'manual', label: null, count: 3 },
    { kind: 'planet', value: 'Mars', label: 'Mars', count: 1 },
  ])
  assert.deepEqual(g.country, [{ value: 'France', label: 'France', count: 12 }])
  assert.deepEqual(g.source.map((o) => o.value), [SOURCE, 'manual'])
  assert.equal(g.source[1].label, null)
  assert.equal(g.state.length, 0)
})
