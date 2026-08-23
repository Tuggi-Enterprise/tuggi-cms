/**
 * The link of a push notification has ONE resolution rule, and the three inbox
 * mirrors of `firebase-push-notification` must all obey it.
 *
 * Why this file exists: the rule was written by hand three times in that
 * function and the three copies disagreed. The direct push (`type === 'user'`)
 * never read `data.url` — the spelling the CMS composer emits — so a link typed
 * by the operator reached the device payload and was dropped on the way to
 * `drive.user_notifications.deeplink`. Measured 2026-08-23: 222 rows in the
 * table, exactly 1 with a deeplink, and rows carrying `data->>'url'` with a NULL
 * column. Manual testing is almost always a direct push to oneself, which is
 * precisely the path that was broken, so nothing caught it.
 *
 * Two halves, and both are needed:
 *  1. the resolver itself (`_shared/notification-deeplink.ts`), exercised
 *     directly — including the argument shape of each of the three call sites,
 *     which is what proves they agree for the same input;
 *  2. a source ruler over `firebase-push-notification/index.ts`, because that
 *     file CANNOT be loaded here: it imports `https://esm.sh/@supabase/supabase-js@2`
 *     at the top, which Node cannot resolve and `mock.module` does not intercept
 *     (measured 2026-08-23). Without the ruler, half 1 would keep passing while
 *     someone re-inlined a fourth spelling into a call site.
 *
 * The module is Deno source (`.ts` specifier), so it is loaded through a path
 * built at run time — a static import ending in `.ts` fails `npm run type-check`
 * for the whole repo.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MODULE_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/_shared/notification-deeplink.ts'
)
const FUNCTION_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/firebase-push-notification/index.ts'
)

type DataBag = Record<string, unknown> | null | undefined
type ResolveDeeplink = (...sources: DataBag[]) => string | null

let resolveDeeplink: ResolveDeeplink

before(async () => {
  const mod = await import(pathToFileURL(MODULE_PATH).href)
  resolveDeeplink = mod.resolveDeeplink
  assert.equal(typeof resolveDeeplink, 'function', 'resolveDeeplink is not exported')
})

// --- The regression: the CMS composer emits `data.url` ------------------------

test('direct push composed in the CMS resolves the link it typed (data.url)', () => {
  // Exactly what NotificationManager.handleSend sends for a direct push:
  // notification.data = { ...data, url: deepLink }, no top-level data.
  const notificationData = { url: 'tuggi://map' }
  assert.equal(resolveDeeplink(notificationData, undefined), 'tuggi://map')
})

test('a link in data.url never resolves to null', () => {
  assert.notEqual(resolveDeeplink({ url: 'tuggi://partner-status' }, undefined), null)
})

// --- The three call sites agree ----------------------------------------------

/**
 * The argument shape of each inbox mirror in
 * `supabase/functions/firebase-push-notification/index.ts`. Keep in sync with
 * the call sites — the source ruler below asserts they still call the resolver.
 */
const callSites: { name: string; call: (bag: Record<string, unknown>) => string | null }[] = [
  {
    name: "immediate direct push (type === 'user')",
    call: (bag) => resolveDeeplink(bag, undefined),
  },
  {
    name: "immediate broadcast (type === 'broadcast')",
    call: (bag) => resolveDeeplink(bag, undefined),
  },
  {
    name: 'scheduled broadcast (/process-scheduled, item.data)',
    call: (bag) => resolveDeeplink(bag),
  },
]

const sameForEverySite: { label: string; bag: Record<string, unknown>; expected: string | null }[] =
  [
    { label: 'url only (CMS composer)', bag: { url: 'tuggi://map' }, expected: 'tuggi://map' },
    {
      label: 'deeplink only (platform caller)',
      bag: { deeplink: 'tuggi://map' },
      expected: 'tuggi://map',
    },
    {
      label: 'both spellings, deeplink wins',
      bag: { deeplink: 'tuggi://wins', url: 'tuggi://loses' },
      expected: 'tuggi://wins',
    },
    { label: 'no link at all', bag: { type: 'generic' }, expected: null },
  ]

for (const { label, bag, expected } of sameForEverySite) {
  test(`the three inbox mirrors resolve the same link — ${label}`, () => {
    for (const site of callSites) {
      assert.equal(site.call(bag), expected, `${site.name} disagrees with the others`)
    }
  })
}

// --- Absence is NULL, not an empty string ------------------------------------

test('deeplink is null when no source carries a link in any spelling', () => {
  assert.equal(resolveDeeplink({}, {}), null)
  assert.equal(resolveDeeplink(undefined, undefined), null)
  assert.equal(resolveDeeplink(null), null)
  assert.equal(resolveDeeplink(), null)
})

test('a blank or whitespace-only link counts as absent', () => {
  // A '' in the column would render the inbox row as tappable and go nowhere.
  assert.equal(resolveDeeplink({ url: '' }, undefined), null)
  assert.equal(resolveDeeplink({ deeplink: '   ' }, undefined), null)
  assert.equal(resolveDeeplink({ deeplink: '', url: 'tuggi://map' }, undefined), 'tuggi://map')
})

test('a non-string link is ignored instead of being written as-is', () => {
  assert.equal(resolveDeeplink({ url: 42 }, undefined), null)
  assert.equal(resolveDeeplink({ deeplink: { href: 'tuggi://map' } }, undefined), null)
})

test('the resolved link is trimmed', () => {
  assert.equal(resolveDeeplink({ url: '  tuggi://map  ' }, undefined), 'tuggi://map')
})

// --- Later sources are a fallback, never an override -------------------------

test('notification.data wins over the top-level data bag', () => {
  assert.equal(
    resolveDeeplink({ url: 'tuggi://from-notification' }, { deeplink: 'tuggi://from-body' }),
    'tuggi://from-notification'
  )
})

test('the top-level data bag is read when notification.data has no link', () => {
  assert.equal(resolveDeeplink({ type: 'generic' }, { url: 'tuggi://from-body' }), 'tuggi://from-body')
})

// --- Source ruler: no call site may spell the rule by hand again --------------

test('every inbox mirror delegates the link to resolveDeeplink', () => {
  const source = readFileSync(FUNCTION_PATH, 'utf8')

  const declarations = source.match(/const deeplink\s*=[^;]*/g) ?? []
  assert.equal(
    declarations.length,
    3,
    `expected the 3 known inbox mirrors, found ${declarations.length} — a new one must call resolveDeeplink too`
  )
  for (const declaration of declarations) {
    assert.match(
      declaration,
      /resolveDeeplink\(/,
      `an inbox mirror spells the link rule by hand: ${declaration.replace(/\s+/g, ' ')}`
    )
  }

  assert.doesNotMatch(
    source,
    /\?\?\s*\w[\w?.]*\.url\b/,
    'a `?? …url` cascade came back into the function — the rule lives in _shared/notification-deeplink.ts'
  )
})
