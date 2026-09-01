/**
 * The balance bands of #656, and the boundary they must never cross.
 *
 * Critical 1–59, attention 60–299, comfortable 300+ — the Tech Lead's decision, with the
 * reason in the catalogue: the smallest pass on sale is 600 minutes (**BR-MONETIZACAO-048**),
 * so less than one hour left is less than 10% of the smallest package.
 *
 * The last test is the one that matters in six months: **BR-MONETIZACAO-046** says
 * `drive.get_entitlement` is the single implementation of the state resolution. A screen
 * that compares `ends_at` against the clock to decide who is paid creates the second one —
 * and it arrives silently, because it is right most of the time.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  BALANCE_BANDS,
  BALANCE_BAND_FLOOR,
  ENTITLEMENT_STATES,
  GRANT_SOURCES,
  LOW_BALANCE_CEILING_MINUTES,
  balanceBand,
  balanceBandCeiling,
  grantOrigin,
} from '@/lib/credit/entitlement'
import { formatDuration } from '@/lib/format/duration'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

test('BR-MONETIZACAO-048: the three bands, and the exact edge of each one', () => {
  assert.equal(balanceBand(1), 'critical')
  assert.equal(balanceBand(59), 'critical')
  assert.equal(balanceBand(60), 'attention')
  assert.equal(balanceBand(299), 'attention')
  assert.equal(balanceBand(300), 'comfortable')
  assert.equal(balanceBand(600), 'comfortable')
})

test('BR-MONETIZACAO-046: a zero balance is no band at all — it is the free state', () => {
  // Zero does not belong on the metered list. Negative does not exist (the floor lives in
  // `drive.get_entitlement`), but if one arrives it must not read as "critical".
  assert.equal(balanceBand(0), null)
  assert.equal(balanceBand(-30), null)
  assert.equal(balanceBand(null), null)
  assert.equal(balanceBand(undefined), null)
  assert.equal(balanceBand(Number.NaN), null)
})

test("a band's ceiling is the next floor minus one, and comfortable has no ceiling", () => {
  assert.equal(balanceBandCeiling('critical'), BALANCE_BAND_FLOOR.attention - 1)
  assert.equal(balanceBandCeiling('attention'), BALANCE_BAND_FLOOR.comfortable - 1)
  assert.equal(balanceBandCeiling('comfortable'), null)

  // The "running out" widget asks the RPC for exactly what is not yet comfortable.
  assert.equal(LOW_BALANCE_CEILING_MINUTES, BALANCE_BAND_FLOOR.comfortable - 1)
  assert.equal(balanceBand(LOW_BALANCE_CEILING_MINUTES), 'attention')
  assert.equal(balanceBand(LOW_BALANCE_CEILING_MINUTES + 1), 'comfortable')
})

test('minutes stay minutes: the hour split belongs to lib/format/duration', () => {
  // The report reuses the owner of the `5 h 20 min` shape instead of minting a second
  // one — no fractional hour ever reaches the operator.
  assert.equal(formatDuration(59), '59 min')
  assert.equal(formatDuration(60), '1 h')
  assert.equal(formatDuration(90), '1 h 30 min')
  assert.equal(formatDuration(600), '10 h')
  assert.equal(formatDuration(0), '0 min')
})

test('the badge origin is the last grant, and only `purchase` is a purchase', () => {
  assert.equal(grantOrigin('purchase'), 'purchase')
  for (const source of ['welcome', 'coupon', 'cms', 'partner', 'transfer', null, undefined]) {
    assert.equal(grantOrigin(source as any), 'grant', `${source} is a grant, not a purchase`)
  }
})

test('the bands are in ascending order of comfort — the order of the filter on screen', () => {
  assert.deepEqual([...BALANCE_BANDS], ['critical', 'attention', 'comfortable'])
})

// ---------------------------------------------------------------------------
// Static: the second resolution of state must not be born.
// ---------------------------------------------------------------------------

/** `grep -rl`, scoped, with no dependency on the shell finding `rg`. */
function grepFiles(pattern: string, paths: string[]): string[] {
  try {
    const out = execFileSync('grep', ['-rlE', '--include=*.ts', '--include=*.tsx', pattern, ...paths], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    return out.split('\n').filter(Boolean)
  } catch {
    // grep exits 1 when it matches nothing, which is the passing case here.
    return []
  }
}

/** Source with comments removed, so prose explaining the rule is not read as code. */
function codeOf(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
}

test('BR-MONETIZACAO-046: no paid-access surface infers the state from `ends_at`', () => {
  // Rendering `ends_at` as a date is display. COMPARING it against the clock is the second
  // implementation of `drive.get_entitlement`, and it would disagree with the database the
  // day the rule changes. Only the comparison is refused here.
  const offenders = grepFiles('ends_at', ['app', 'components', 'lib']).filter((file) => {
    const code = codeOf(file)
    return (
      /ends_at[^\n]{0,80}\)\s*(>|<|>=|<=)/.test(code) ||
      /ends_at[^\n]{0,80}getTime\(\)/.test(code) ||
      /ends_at[^\n]{0,80}Date\.now\(\)/.test(code)
    )
  })

  assert.deepEqual(
    offenders,
    [],
    'these files compare ends_at against the clock to decide a right — that decision is drive.get_entitlement'
  )
})

test('BR-MONETIZACAO-046: the state vocabulary has one owner, and no fourth value', () => {
  assert.deepEqual([...ENTITLEMENT_STATES], ['unlimited', 'metered', 'free'])
  assert.deepEqual([...GRANT_SOURCES], ['purchase', 'welcome', 'coupon', 'cms', 'partner', 'transfer'])

  // The credit panel used to keep its own copy of the six sources. One list, one meaning.
  const panel = codeOf('components/admin/credit/CreditPanel.tsx')
  assert.equal(
    /const\s+KNOWN_SOURCES\s*=/.test(panel),
    false,
    'CreditPanel must read GRANT_SOURCES from lib/credit/entitlement, not redeclare the list'
  )
})
