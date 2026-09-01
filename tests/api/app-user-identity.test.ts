/**
 * **BR-USUARIO-042** — on a CMS screen the tourist is a `nickname`, and nothing else.
 *
 * Two things break here in silence, and neither has a symptom on screen:
 *
 * 1. **a fallback.** `full_name || email.split('@')[0]` only shows itself on the rare row
 *    where the name is missing — the screen looks right for months and leaks on the one
 *    account nobody was looking at. The chain has two links and ends at the second;
 * 2. **a re-add.** Someone puts the e-mail back as a subtitle because the row "looks empty".
 *    The static tests below refuse it per surface, so the diff has to argue with the rule
 *    instead of slipping past it.
 *
 * What is NOT asserted here, on purpose: that the fields leave the payload. That is phase 2
 * and it belongs to `data` — today the old RPCs still return `full_name` and `email`, the
 * screens simply stop reading them. And **filtering is not showing** (item 3): a search that
 * matches on an e-mail is allowed, and is the reason the fields stay in the types.
 *
 * This is not anonymisation and must not be called that anywhere — BR-USUARIO-017 owns that
 * word and it means the link becomes null, which is not what happens here.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { USER_ID_LABEL_CHARS, appUserInitial, appUserLabel } from '@/lib/format/user-identity'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

/**
 * The tourist surfaces of the CMS — the list is the rule's boundary, not a sample.
 *
 * B2B is deliberately absent (item 4): client, partner, contract, commercial pipeline and
 * CMS users go on being identified by name, because there is a contract there and the name
 * is a working tool. The same person may appear on both sides; the screen decides, never
 * the `user_id`.
 */
const TOURIST_SURFACES = [
  'app/[locale]/dashboard/page.tsx',
  'app/[locale]/users/app/page.tsx',
  'components/dashboard/UpcomingExpirationsCard.tsx',
  'components/dashboard/LowBalanceCard.tsx',
  'components/dashboard/PaidAccessCard.tsx',
  'components/dashboard/UserDetailModal.tsx',
  'components/dashboard/reports/MeteredBalances.tsx',
  'components/dashboard/reports/UsersPremium.tsx',
  'components/dashboard/reports/UsersAll.tsx',
]

/**
 * The one exception, and it is named so it cannot spread.
 *
 * `GrantCreditDialog.personLabel` prints `name · e-mail` on the confirmation of a manual
 * grant, because granting on the wrong account is the expensive irreversible error of that
 * screen. Whether the tie-break becomes the `nickname` is the founder's call and is still
 * open, so the two lines that FEED that dialog stay as they are. They pass a value on; they
 * do not render one.
 */
const GRANT_TARGET_LINES = [
  'name={user.full_name}',
  'email={user.email}',
  'return { userId: id, name: user?.full_name ?? null, email: user?.email ?? null }',
]

/** Source with comments removed, so prose about the rule is not read as code. */
function codeOf(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
}

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

// ---------------------------------------------------------------------------
// The chain: two links, and it ends at the second.
// ---------------------------------------------------------------------------

test('BR-USUARIO-042: the nickname identifies, and the truncated user_id is the only fallback', () => {
  const userId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

  assert.equal(appUserLabel({ user_id: userId, nickname: 'hoppy-otter' }), 'hoppy-otter')
  assert.equal(appUserLabel({ user_id: userId, nickname: null }), 'a1b2c3d4')
  assert.equal(appUserLabel({ user_id: userId }), 'a1b2c3d4')

  // A blank nickname is an absent one: every profile is filled by `tr_assign_default_nickname`,
  // so whitespace is dirt, not an identifier.
  assert.equal(appUserLabel({ user_id: userId, nickname: '   ' }), 'a1b2c3d4')

  assert.equal(USER_ID_LABEL_CHARS, 8)
  assert.equal(appUserLabel({ user_id: userId, nickname: null }).length, USER_ID_LABEL_CHARS)
})

test('BR-USUARIO-042: with neither link the label is a dash, never an empty row', () => {
  assert.equal(appUserLabel({ user_id: null, nickname: null }), '—')
  assert.equal(appUserLabel(null), '—')
  assert.equal(appUserLabel(undefined), '—')
})

test('BR-USUARIO-042: the avatar initial comes from the label, so the name cannot return one character at a time', () => {
  assert.equal(appUserInitial({ user_id: 'a1b2c3d4-e5f6', nickname: 'hoppy-otter' }), 'H')
  assert.equal(appUserInitial({ user_id: 'a1b2c3d4-e5f6', nickname: null }), 'A')

  // The helper takes no name and no e-mail: there is nothing to pass it. The compiler says so
  // too, but the assertion is what a reader sees.
  assert.equal(appUserInitial({ user_id: 'a1b2c3d4', nickname: 'zoe-condor' }), 'Z')
})

// ---------------------------------------------------------------------------
// Static: no tourist surface renders a name or an e-mail.
// ---------------------------------------------------------------------------

test('BR-USUARIO-042: no tourist surface reads full_name or email except to filter', () => {
  const offenders: string[] = []

  for (const surface of TOURIST_SURFACES) {
    const lines = codeOf(surface).split('\n')
    lines.forEach((line, index) => {
      if (!/\bfull_name\b|\bemail\b/.test(line)) return

      // Filtering is not showing (item 3): the operator types the address the tourist gave
      // him, the match happens, and the row still comes back identified by `nickname`.
      if (line.includes('.includes(')) return

      // A field of a type or of a payload mapping is data in transit, not a screen. The
      // fields only leave the payload in phase 2, which is `data`'s.
      if (/^\s*\w+\??\s*:\s/.test(line)) return

      if (GRANT_TARGET_LINES.some((allowed) => line.includes(allowed))) return

      offenders.push(`${surface}:${index + 1} ${line.trim()}`)
    })
  }

  assert.deepEqual(
    offenders,
    [],
    'these lines put a tourist name or e-mail on a CMS screen — the identifier is the nickname'
  )
})

test('BR-USUARIO-042: nothing in the CMS derives a label from the local part of an e-mail', () => {
  // The defect the rule names by example. It is repo-wide and not surface by surface: the
  // cut is the same personal datum wherever it happens, and `email.split('@')[0]` is only
  // ever done to have something that reads like a name.
  const offenders = grepFiles("email[^\\n]{0,20}\\.split\\('@'\\)", ['app', 'components', 'lib'])

  assert.deepEqual(offenders, [], 'these files build an identifier out of an e-mail address')
})

test('BR-USUARIO-042: the tourist surfaces identify through the single owner of the chain', () => {
  // A screen that prints `nickname || user_id.slice(0, 8)` inline is a second declaration of
  // the same two-link chain, and the day the fallback changes one of them keeps the old one
  // (CLAUDE.md §6). Surfaces that show a person import the helper; the ones that show only
  // aggregates show no person at all.
  const withPeople = TOURIST_SURFACES.filter((surface) => /\bnickname\b/.test(codeOf(surface)))
  const withoutHelper = withPeople.filter((surface) => !codeOf(surface).includes('@/lib/format/user-identity'))

  assert.deepEqual(
    withoutHelper,
    [],
    'these surfaces name a tourist without going through lib/format/user-identity'
  )
})
