/**
 * Accounts and guests on the panel are two counts, never one (#1045, contract `banco-para-cms.md`
 * Part 19). BR-USUARIO-037, edge case on panel counts.
 *
 * What breaks in silence here:
 *
 * 1. a guest column read under the wrong name, so the card shows zero guests and nobody notices;
 * 2. the conversion rate dividing by zero on an empty base, or using the wrong denominator;
 * 3. the list sending a kind the RPC refuses (`22023`), which turns the whole list into an error;
 * 4. the dashboard summing guests into the users number.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  USER_KINDS,
  guestConversionRate,
  userAnalyticsCountsOf,
  userKindFilterOf,
} from '@/lib/users/app-user-access'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const LOCALES = ['pt', 'en', 'es'] as const

function source(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), 'utf8')
}

function lookup(tree: Record<string, any>, key: string): unknown {
  return key.split('.').reduce<any>((node, part) => (node == null ? undefined : node[part]), tree)
}

test('BR-USUARIO-037: the analytics row maps accounts and guests to separate fields', () => {
  // The production numbers of 2026-10-28 (660 accounts, 5 guests, 4 active, 1 converted).
  const counts = userAnalyticsCountsOf({
    total_users: 660,
    active_users_30d: 165,
    total_guests: 5,
    active_guests_30d: 4,
    guests_converted: 1,
  })
  assert.deepEqual(counts, {
    totalUsers: 660,
    activeUsers30d: 165,
    totalGuests: 5,
    activeGuests30d: 4,
    guestsConverted: 1,
    guestConversionRate: 17,
  })
  assert.equal(counts.totalUsers, 660, 'the users number is accounts only, guests are not added to it')
})

test('BR-USUARIO-037: a row from before the guest columns reads zero guests, never NaN', () => {
  const counts = userAnalyticsCountsOf({ total_users: '660', active_users_30d: '165' })
  assert.equal(counts.totalUsers, 660, 'a bigint sent as text still reads as a number')
  assert.equal(counts.totalGuests, 0)
  assert.equal(counts.activeGuests30d, 0)
  assert.equal(counts.guestsConverted, 0)
  assert.equal(counts.guestConversionRate, 0)
  assert.equal(userAnalyticsCountsOf(undefined).totalUsers, 0)
})

test('BR-USUARIO-037: the conversion rate is converted over converted plus guests, 0 on an empty base', () => {
  assert.equal(guestConversionRate({ guests_converted: 1, total_guests: 5 }), 17)
  assert.equal(guestConversionRate({ guests_converted: 3, total_guests: 1 }), 75)
  assert.equal(guestConversionRate({ guests_converted: 4, total_guests: 0 }), 100, 'every guest left converted')
  assert.equal(guestConversionRate({ guests_converted: 0, total_guests: 9 }), 0)
  assert.equal(guestConversionRate({ guests_converted: 0, total_guests: 0 }), 0, 'empty denominator is 0')
  assert.equal(guestConversionRate({ guests_converted: null, total_guests: undefined }), 0)
})

test('BR-USUARIO-037: the kind filter sends only what the RPC accepts, anything else is both kinds', () => {
  assert.deepEqual([...USER_KINDS], ['account', 'guest'])
  assert.equal(userKindFilterOf('account'), 'account')
  assert.equal(userKindFilterOf('guest'), 'guest')
  assert.equal(userKindFilterOf(''), null)
  assert.equal(userKindFilterOf('anonymous'), null, 'an unknown kind would come back as 22023')
})

test('BR-USUARIO-037: the users page asks for the kind and marks the guest row', () => {
  const page = source('app/[locale]/users/app/page.tsx')
  assert.match(page, /filter_kind: userKindFilterOf\(filterKind\)/)
  assert.match(page, /user\.is_anonymous &&/)
  assert.match(page, /value=\{stats\?\.total_guests \?\? 0\}/)
  assert.match(page, /guestConversionRate\(stats\)/)
})

test('BR-USUARIO-037: the dashboard reads the shared mapping, not its own sum', () => {
  const service = source('lib/services/dashboard-service.ts')
  assert.match(service, /\.\.\.userAnalyticsCountsOf\(userAnalytics\)/)
  assert.doesNotMatch(service, /total_users\) \+|\+ Number\(userAnalytics\.total_guests/)
  const dashboard = source('app/[locale]/dashboard/page.tsx')
  assert.match(dashboard, /labels\.users_detail', \{ guests: stats\.totalGuests, rate: stats\.guestConversionRate \}/)
  assert.match(dashboard, /labels\.active_30d_detail', \{ guests: stats\.activeGuests30d \}/)
})

test('BR-USUARIO-037: every new label exists in every locale, and none adds the two counts', () => {
  for (const locale of LOCALES) {
    const pages = JSON.parse(source(`messages/${locale}.json`)).Pages
    const keys: Array<[Record<string, any>, string]> = [
      [pages.AppUsers, 'stats.guests'], [pages.AppUsers, 'stats.guests_detail'],
      [pages.AppUsers, 'filters.kind'], [pages.AppUsers, 'filters.all_kinds'],
      [pages.AppUsers, 'filters.kind_account'], [pages.AppUsers, 'filters.kind_guest'],
      [pages.AppUsers, 'table.guest_badge'],
      [pages.Dashboard, 'labels.users_detail'], [pages.Dashboard, 'labels.active_30d_detail'],
    ]
    for (const [tree, key] of keys) {
      const value = lookup(tree, key)
      assert.equal(typeof value, 'string', `${locale}: ${key}`)
      assert.ok(String(value).length > 0, `${locale}: ${key}`)
    }
    for (const kind of USER_KINDS) assert.equal(typeof lookup(pages.AppUsers, `filters.kind_${kind}`), 'string')
    assert.match(pages.AppUsers.stats.guests_detail, /\{rate\}/)
    assert.match(pages.Dashboard.labels.users_detail, /\{guests\}[^\n]*\n[^\n]*\{rate\}/)
  }
})
