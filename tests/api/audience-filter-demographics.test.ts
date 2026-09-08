/**
 * #720 — BR-USUARIO-043 item 5b: the demographic profile survey cannot target campaigns.
 *
 * The survey collected in `drive.profiles` has one declared purpose — decide what to
 * produce — and item 5b names campaign targeting (push, e-mail, ads, audiences,
 * broadcast lists) as a use that purpose does NOT authorize. `AudienceFilters` is the
 * CMS side of exactly that: the shape both the push sender and the newsletter sender
 * hand to `core.build_audience_filter`. It declared `country` and `driver_type`; the
 * #720 migration made the RPC raise `TGU43` (HTTP 400) for either key — loud refusal,
 * not silent drop — so every key that stays in this interface is an invitation to a 400.
 *
 * Two guarantees, and they are deliberately different animals:
 *
 *  1. STATIC, at runtime — the declared key set of `AudienceFilters` is exactly the
 *     allowlist below. This is a POSITIVE assertion on purpose: a negative one
 *     ("`country` is absent") would stay green while a seventh demographic column
 *     quietly joined the interface, and the contract is that no profile column leaks
 *     into the filter on its own. Comments are stripped before parsing — this file
 *     and the file it reads both explain the removal in prose, and an assertion that
 *     reads comments goes red at the sentence that documents it.
 *
 *  2. COMPILE-TIME — the `@ts-expect-error` pair at the bottom. `tsx` erases it, so
 *     that guarantee is cashed by `npm run type-check`, not by this run: if either key
 *     comes back to the interface the directive becomes unused and `tsc` goes red.
 *
 * Not proven here: that the database refuses the keys. That is the migration's test,
 * on the `data` side. What this file owns is the CMS never forming the request.
 *
 * Contract: `docs/contracts/banco-para-cms.md`, Part 5.
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AudienceFilters } from '@/lib/services/marketing/audience-types'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const TYPES_FILE = 'lib/services/marketing/audience-types.ts'

/** The two keys BR-USUARIO-043 item 5b removed, and that `TGU43` now refuses. */
const FORBIDDEN_KEYS = ['country', 'driver_type'] as const

/**
 * Every key `core.build_audience_filter` still accepts from the CMS. None of them is
 * survey data: `language` is the interface locale the app writes by itself
 * (BR-AUDIO-017), not the declared `spoken_languages`.
 */
const ALLOWED_KEYS = [
  'subscription_tier_id',
  'last_platform',
  'language',
  'onboarding_completed',
  'created_after',
  'created_before',
  'last_active_after',
  'app_version_lt',
]

/**
 * Files that build, forward or persist an audience filter. A key can only reach the
 * RPC through one of these.
 */
const AUDIENCE_SURFACE = [
  TYPES_FILE,
  'lib/services/notification-service.ts',
  'lib/services/newsletter-service.ts',
  'types/newsletter.ts',
  'components/marketing/shared/AudienceFilter.tsx',
  'components/marketing/notifications/NotificationManager.tsx',
  'components/marketing/newsletter/NewsletterManager.tsx',
  'app/api/admin/marketing/campaigns/route.ts',
  'app/api/admin/marketing/campaigns/[id]/route.ts',
]

/** Drops block comments and whole-line `//` comments. Prose must not be evidence. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

function read(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')
}

/** The property names declared inside `interface AudienceFilters { … }`. */
function declaredKeys(source: string): string[] {
  const body = /export interface AudienceFilters\s*\{([\s\S]*?)\n\}/.exec(stripComments(source))
  assert.ok(body, `${TYPES_FILE}: could not find the AudienceFilters interface body`)
  return [...body[1].matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:/gm)].map((m) => m[1])
}

test('BR-USUARIO-043 item 5b: AudienceFilters declares no demographic survey key', () => {
  const keys = declaredKeys(read(TYPES_FILE))

  // Anti-vacuity: a parser that finds nothing would pass every assertion below.
  assert.ok(keys.length > 0, 'parsed zero keys — the regex, not the interface, is broken')
  assert.ok(keys.includes('language'), 'parsed key set lost a key that is supposed to be there')

  for (const forbidden of FORBIDDEN_KEYS) {
    assert.ok(
      !keys.includes(forbidden),
      `\`${forbidden}\` is back in AudienceFilters. BR-USUARIO-043 item 5b forbids targeting ` +
        `campaigns by the profile survey, and core.build_audience_filter answers TGU43 (400) ` +
        `for it. Reach the partner driver through drive.profiles.client_id instead.`,
    )
  }

  assert.deepEqual(
    [...keys].sort(),
    [...ALLOWED_KEYS].sort(),
    'AudienceFilters changed shape. The filter is an explicit allowlist on both sides: a new ' +
      'key here is a new purpose for the data (BR-USUARIO-043 item 5), which is a human ' +
      'decision with ID and date in docs/business-rules/, not a card item.',
  )
})

test('BR-USUARIO-043 item 5b: no CMS audience surface names the refused keys', () => {
  for (const relativePath of AUDIENCE_SURFACE) {
    const code = stripComments(read(relativePath))
    for (const forbidden of FORBIDDEN_KEYS) {
      assert.ok(
        !new RegExp(`\\b${forbidden}\\b`).test(code),
        `${relativePath} names \`${forbidden}\` on the audience-filter path. Sending it to ` +
          `core.build_audience_filter is a 400 (TGU43) and a use BR-USUARIO-043 item 5b does ` +
          `not authorize. Showing the value to an operator is fine — that is UserDetailModal ` +
          `and the reports, not this path.`,
      )
    }
  }
})

test('BR-USUARIO-043 item 5b: the refused keys are a compile error, not a convention', () => {
  // Cashed by `npm run type-check`, not by this run: tsx strips the directives. If either
  // key returns to the interface, the `@ts-expect-error` becomes unused and tsc goes red.
  const byCountry: AudienceFilters = {
    // @ts-expect-error BR-USUARIO-043 item 5b — country cannot target a campaign (TGU43).
    country: 'BR',
  }
  const byDriverType: AudienceFilters = {
    // @ts-expect-error BR-USUARIO-043 item 5b — driver_type cannot target a campaign (TGU43).
    driver_type: 'professional',
  }

  // The literals survive to runtime so the test is not dead weight when tsc is not running.
  assert.deepEqual(byCountry, { country: 'BR' })
  assert.deepEqual(byDriverType, { driver_type: 'professional' })
})
