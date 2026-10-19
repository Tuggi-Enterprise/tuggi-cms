/**
 * The address of a tourist's record (#976): `/users/app?user=<id>&tab=<tab>`, the drawer over the
 * app users list. The old Passaporte page `/admin/users/<id>` redirects there, on the Passaporte
 * tab, so the links already out there keep landing somewhere.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appUserHref, appUserListHref, appUserTab } from '@/lib/users/app-user-href'

const ROOT = join(__dirname, '..', '..')
const USER_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

test('the record opens on the requested tab, and a missing or unknown tab opens the overview', () => {
  assert.equal(appUserTab('passport'), 'passport')
  assert.equal(appUserTab('credit'), 'credit')
  assert.equal(appUserTab('client'), 'client')
  assert.equal(appUserTab(null), 'overview')
  assert.equal(appUserTab('history'), 'overview')
  assert.equal(appUserTab('PASSPORT'), 'overview')
})

test('the address keeps the list filters and owns only user and tab', () => {
  assert.equal(appUserHref(USER_ID, 'passport'), `/users/app?user=${USER_ID}&tab=passport`)
  assert.equal(appUserHref(USER_ID, 'passport', { locale: 'pt' }), `/pt/users/app?user=${USER_ID}&tab=passport`)
  assert.equal(
    appUserHref(USER_ID, 'credit', { current: new URLSearchParams('country=BR&tab=client') }),
    `/users/app?country=BR&tab=credit&user=${USER_ID}`
  )
})

test('closing takes the drawer parameters off and leaves the rest', () => {
  assert.equal(appUserListHref(new URLSearchParams(`user=${USER_ID}&tab=passport`), 'es'), '/es/users/app')
  assert.equal(appUserListHref(new URLSearchParams(`country=BR&user=${USER_ID}&tab=credit`)), '/users/app?country=BR')
})

test('both Passaporte pages redirect to the drawer on the Passaporte tab, and render nothing of their own', () => {
  for (const file of ['app/admin/users/[userId]/page.tsx', 'app/[locale]/admin/users/[userId]/page.tsx']) {
    const code = readFileSync(join(ROOT, file), 'utf8')
    assert.match(code, /redirect\(appUserHref\(userId, 'passport'/, `${file} must redirect to the drawer`)
    // The page read `drive.profiles.*` (name and e-mail among it) to print a header. BR-USUARIO-042.
    assert.doesNotMatch(code, /full_name|email|\.from\(/, `${file} must not read the profile any more`)
  }
})
