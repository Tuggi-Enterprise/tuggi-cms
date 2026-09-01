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

import {
  USER_ID_LABEL_CHARS,
  appUserInitial,
  appUserLabel,
  grantTargetLabel,
} from '@/lib/format/user-identity'

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
 * The founder decided on 2026-09-01 that the manual grant confirmation identifies by
 * **`nickname` and e-mail**, in that order: granting on the wrong account is the expensive
 * irreversible error of that screen, so it keeps a second signal. The exception is nominal —
 * it is the e-mail, and only there. **The full name is not part of it and is gone.**
 *
 * These are the two lines that FEED that dialog. They pass an address on; they do not render
 * one, and neither of them may mention a name again.
 */
const GRANT_TARGET_LINES = [
  'email={user.email}',
  'return { userId: id, nickname: user?.nickname ?? null, email: user?.email ?? null }',
]

/**
 * The dialog itself, and everything between it and the screen.
 *
 * `TOURIST_SURFACES` cannot cover these: they are where the exception legitimately lives, so
 * a blanket "no e-mail" assertion would be a lie there. What they get instead is the tighter
 * claim — no full name, at all, in any form.
 */
const GRANT_SURFACES = [
  'components/admin/credit/GrantCreditDialog.tsx',
  'components/admin/credit/CreditPanel.tsx',
  'components/admin/credit/types.ts',
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

// ---------------------------------------------------------------------------
// The named exception: the manual grant confirmation, and nothing else.
// ---------------------------------------------------------------------------

test('BR-USUARIO-042: the manual grant names a tourist by nickname and e-mail, in that order', () => {
  const userId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

  assert.equal(
    grantTargetLabel({ user_id: userId, nickname: 'hoppy-otter' }, 'tourist@example.com'),
    'hoppy-otter · tourist@example.com'
  )

  // No nickname: the identity half is the same chain every other screen uses, not a second
  // one written here. Eight characters from the front, never six from the back.
  assert.equal(
    grantTargetLabel({ user_id: userId, nickname: null }, 'tourist@example.com'),
    'a1b2c3d4 · tourist@example.com'
  )
})

test('BR-USUARIO-042: with no e-mail there is no tail, because the nickname is already unique', () => {
  const userId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

  // `profiles_nickname_unique` is what makes this safe: the tie-breaker the full name needed
  // is a guarantee the nickname carries by itself (the rule's 3rd edge case).
  assert.equal(grantTargetLabel({ user_id: userId, nickname: 'hoppy-otter' }, null), 'hoppy-otter')
  assert.equal(grantTargetLabel({ user_id: userId, nickname: 'hoppy-otter' }, '   '), 'hoppy-otter')

  // Neither half available: the uuid appears ONCE. The old line printed it twice in two
  // different cuts — `a1b2c3d4 · …567890` — which offered a second signal carrying no
  // second fact (CLAUDE.md §6, and the rule's 6th edge case).
  const label = grantTargetLabel({ user_id: userId, nickname: null }, null)
  assert.equal(label, 'a1b2c3d4')
  assert.equal(label.includes('·'), false)
  assert.equal(label.includes('…'), false)
  assert.equal(userId.slice(-6), '567890')
  assert.equal(label.includes('567890'), false)
})

test('BR-USUARIO-042: the grant dialog and everything feeding it hold no full name', () => {
  const offenders: string[] = []

  for (const surface of GRANT_SURFACES) {
    codeOf(surface)
      .split('\n')
      .forEach((line, index) => {
        // `full_name` is the payload field; a bare `name` is how it comes back wearing a
        // different hat — the prop, the field of `GrantTarget`, the local in `personLabel`.
        // `display_name` and `name` of a subscription tier are a licence, not a person.
        if (/\bfull_name\b/.test(line)) {
          offenders.push(`${surface}:${index + 1} ${line.trim()}`)
          return
        }
        if (/\btarget\.name\b|\bname:\s*string\s*\|\s*null|\bname={/.test(line)) {
          offenders.push(`${surface}:${index + 1} ${line.trim()}`)
        }
      })
  }

  assert.deepEqual(
    offenders,
    [],
    'the exception the founder opened is the e-mail; the full name is not part of it'
  )
})

test('BR-USUARIO-042: the grant label is composed by the owner of the chain, not by the dialog', () => {
  // Six places in the dialog name a person and all six call `personLabel`. If `personLabel`
  // ever builds the string itself again, the day the chain changes this screen keeps the old
  // one — which is exactly how the name came back the first time.
  const dialog = codeOf('components/admin/credit/GrantCreditDialog.tsx')

  assert.ok(
    dialog.includes("from '@/lib/format/user-identity'"),
    'GrantCreditDialog must get the identity half from lib/format/user-identity'
  )
  assert.ok(dialog.includes('grantTargetLabel('), 'personLabel must delegate to grantTargetLabel')

  // No second composition: the separator and the uuid slice belong to the helper alone. The
  // check is scoped to `personLabel` — a `·` between state and balance elsewhere in the
  // dialog separates two numbers, not two halves of a person.
  const declaration = dialog.slice(dialog.indexOf('const personLabel'))
  const body = declaration.slice(0, declaration.indexOf('const stateLabel'))

  assert.ok(body.includes('grantTargetLabel('), 'personLabel must delegate, and only delegate')
  assert.equal(/·/.test(body), false, 'personLabel composes no label of its own')
  assert.equal(/\.slice\(/.test(body), false, 'personLabel truncates no uuid of its own')
  assert.equal(/\bt\(/.test(body), false, 'the label has no translated fallback to hide a name in')
})
