/**
 * The push composer's contract with things outside the browser: the campaign key that makes a
 * send measurable, the language catalogue it fans out over, and the three locales the CMS is
 * published in.
 *
 * These are static facts, so they are asserted here rather than in a browser: a component test
 * would have to render a screen to find out that `messages/es.json` has no block.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PUSH_LANGUAGES, toCampaignType } from '@/lib/services/notification-service'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const readMessages = (locale: string) =>
  JSON.parse(readFileSync(resolve(REPO_ROOT, `messages/${locale}.json`), 'utf8'))

/**
 * `docs/contracts/notificacoes.md` §2.3 — the value is free `snake_case`. The Edge Function
 * writes it into `drive.user_notifications.type` and the app reports the same literal as the
 * GA4 `push_type`, so a value that is not `snake_case` becomes two names for one campaign.
 */
test('contract §2.3: toCampaignType always yields snake_case, and never an empty stub', () => {
  assert.equal(toCampaignType('Promo Verão 2026'), 'promo_verao_2026')
  assert.equal(toCampaignType('  --Black Friday!!  '), 'black_friday')
  assert.equal(toCampaignType('já_ok'), 'ja_ok')
  // The composer treats an empty result as "no key", which is what blocks the send.
  assert.equal(toCampaignType('!!!'), '')
  assert.equal(toCampaignType(''), '')

  for (const raw of ['Promo Verão 2026', 'Réveillon — Búzios', 'a'.repeat(200)]) {
    const key = toCampaignType(raw)
    assert.match(key, /^[a-z0-9_]+$/, `not snake_case: ${key}`)
    assert.ok(key.length <= 40, `longer than 40: ${key.length}`)
  }
})

/**
 * BR-IDIOMA-001 item 3 — the APP's interface catalogue is five: en, es, fr, it, pt. A push
 * lands in the phone's notification tray, which is app-interface surface, so this list is the
 * app's and NOT the newsletter's four (no `fr`) nor the twelve of the content catalogue.
 */
test('BR-IDIOMA-001 item 3: the push composes in the five app-interface languages', () => {
  assert.deepEqual([...PUSH_LANGUAGES].sort(), ['en', 'es', 'fr', 'it', 'pt'])
})

/**
 * Every language the composer can fan out over needs a name the operator reads. The names live
 * with the audience filter, which is where the same list is offered as a segment.
 */
test('every push language has a label in all three CMS locales', () => {
  for (const locale of ['pt', 'en', 'es']) {
    const audience = readMessages(locale).Pages.Marketing.Audience
    for (const lang of PUSH_LANGUAGES) {
      assert.ok(audience.language?.[lang], `${locale}: missing Audience.language.${lang}`)
    }
  }
})

/**
 * `messages/es.json` had NO `Pages.Notifications` block at all: an operator working in Spanish
 * read raw key paths (`Pages.Notifications.actions.send_now`) where the buttons should be. The
 * parity is checked against `pt`, which is the block that gets written first.
 */
test('the three locales carry the same Pages.Notifications key tree', () => {
  const paths = (node: any, prefix = ''): string[] =>
    typeof node === 'object' && node !== null
      ? Object.entries(node).flatMap(([k, v]) => paths(v, prefix ? `${prefix}.${k}` : k))
      : [prefix]

  const pt = paths(readMessages('pt').Pages.Notifications).sort()
  assert.ok(pt.length > 0, 'pt has no Pages.Notifications')

  for (const locale of ['en', 'es']) {
    const block = readMessages(locale).Pages?.Notifications
    assert.ok(block, `${locale}: Pages.Notifications is missing`)
    const missing = pt.filter((p) => !paths(block).includes(p))
    assert.deepEqual(missing, [], `${locale}: keys missing from Pages.Notifications`)
  }
})

/**
 * CLAUDE.md §3 — no screen issues a destructive statement. Cancelling a scheduled campaign is a
 * status write; the row is the only record that the campaign was ever planned, and
 * `/process-scheduled` selects `status = 'pending'`, so flipping the column is what stops it.
 */
test('§3: the notification service names no delete of a scheduled row', () => {
  const source = readFileSync(resolve(REPO_ROOT, 'lib/services/notification-service.ts'), 'utf8')
  assert.match(source, /cancel_scheduled_notification/)
  assert.doesNotMatch(source, /\.from\(['"]scheduled_notifications['"]\)[\s\S]{0,80}\.delete\(/)
})
