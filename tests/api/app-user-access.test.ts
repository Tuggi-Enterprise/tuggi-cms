/**
 * The access level on the app users list and its big numbers (#979, contract `banco-para-cms.md`
 * Part 13).
 *
 * The level is decided in the database and only read here. What breaks in silence on this screen:
 *
 * 1. an unknown level painted as "free", which claims the tourist never paid;
 * 2. the store shown on an account that is not at the purchased level, reading as the reason for it;
 * 3. the filter keeping rows of another level, so the count under the search stops matching the cards;
 * 4. the page going back to the subscription stats, whose cards are all zero under the hours model
 *    (BR-MONETIZACAO-047).
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  ACCESS_LEVELS,
  accessBadge,
  accessLevelOf,
  matchesAccessFilter,
  purchasedShare,
  storeDetailKey,
} from '@/lib/users/app-user-access'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const PAGE = 'app/[locale]/users/app/page.tsx'
const LOCALES = ['pt', 'en', 'es'] as const

function source(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), 'utf8')
}

function messages(locale: string): Record<string, any> {
  return JSON.parse(source(`messages/${locale}.json`)).Pages.AppUsers
}

function lookup(tree: Record<string, any>, key: string): unknown {
  return key.split('.').reduce<any>((node, part) => (node == null ? undefined : node[part]), tree)
}

test('the three levels map to three distinct badges, each with a label in every locale', () => {
  const classes = new Set<string>()
  for (const level of ACCESS_LEVELS) {
    const badge = accessBadge(level)
    assert.equal(badge.labelKey, `level.${level}`)
    classes.add(badge.className)
    for (const locale of LOCALES) {
      const label = lookup(messages(locale).access, badge.labelKey)
      assert.equal(typeof label, 'string', `${locale}: access.${badge.labelKey}`)
      assert.ok(String(label).length > 0)
    }
  }
  assert.equal(classes.size, ACCESS_LEVELS.length, 'two levels would look the same on the list')
})

test('a value outside the three is no level, never free', () => {
  assert.equal(accessLevelOf('free'), 'free')
  assert.equal(accessLevelOf('purchased'), 'purchased')
  assert.equal(accessLevelOf('until'), 'until')
  for (const raw of [null, undefined, '', 'premium', 'FREE', 1]) {
    assert.equal(accessLevelOf(raw), null, String(raw))
  }
})

test('the store is a detail of a purchase only', () => {
  assert.equal(storeDetailKey('purchased', 'app_store'), 'store.app_store')
  assert.equal(storeDetailKey('purchased', 'play_store'), 'store.play_store')
  assert.equal(storeDetailKey('purchased', null), null, 'store not recorded')
  assert.equal(storeDetailKey('purchased', 'stripe'), null)
  assert.equal(storeDetailKey('until', 'app_store'), null, 'bought and has a period: the badge says period')
  assert.equal(storeDetailKey('free', 'app_store'), null)
  assert.equal(storeDetailKey(null, 'app_store'), null)
})

test('the access filter keeps exactly one level, and empty keeps all', () => {
  const rows = [
    { id: 'a', access_level: 'free' },
    { id: 'b', access_level: 'purchased' },
    { id: 'c', access_level: 'until' },
    { id: 'd', access_level: null },
  ]
  const kept = (filter: string) => rows.filter((row) => matchesAccessFilter(row.access_level, filter)).map((row) => row.id)

  assert.deepEqual(kept(''), ['a', 'b', 'c', 'd'])
  assert.deepEqual(kept('free'), ['a'])
  assert.deepEqual(kept('purchased'), ['b'])
  assert.deepEqual(kept('until'), ['c'])
  assert.deepEqual(kept('premium'), [], 'the old subscription filter value matches nothing')
})

test('the purchased share is a whole percent of the counted base, and zero on an empty base', () => {
  assert.equal(purchasedShare({ purchased_users: 13, total_users: 628 }), 2)
  assert.equal(purchasedShare({ purchased_users: 1, total_users: 2 }), 50)
  assert.equal(purchasedShare({ purchased_users: 0, total_users: 0 }), 0)
})

test('BR-MONETIZACAO-047: the page reads the access stats and the level, not the subscription stats', () => {
  const page = source(PAGE)
  assert.match(page, /rpc\('dashboard_app_user_stats'\)/)
  assert.doesNotMatch(page, /dashboard_subscription_stats/)
  assert.doesNotMatch(page, /dashboard_user_sessions/, 'a fallback list has no access level')
  assert.doesNotMatch(page, /SubscriptionBadge|is_premium/)
  assert.match(page, /matchesAccessFilter\(user\.access_level, filterAccess\)/)
})

test('every card label and the filter exist in every locale, and the old subscription keys are gone', () => {
  const keys = [
    'stats.total', 'stats.total_detail', 'stats.new_7d', 'stats.active_7d', 'stats.free_only',
    'stats.purchased', 'stats.purchased_detail', 'stats.until', 'stats.consumed',
    'filters.access', 'filters.all_access', 'table.access', 'access.unknown',
    'access.store.app_store', 'access.store.play_store',
  ]
  for (const locale of LOCALES) {
    const tree = messages(locale)
    for (const key of keys) assert.equal(typeof lookup(tree, key), 'string', `${locale}: ${key}`)
    for (const gone of ['stats.premium', 'stats.stripe', 'stats.churn_7d', 'filters.subscription', 'table.subscription']) {
      assert.equal(lookup(tree, gone), undefined, `${locale}: ${gone}`)
    }
    assert.doesNotMatch(JSON.stringify(tree.stats), /—|–/, `${locale}: no dash in the cards`)
  }
})
