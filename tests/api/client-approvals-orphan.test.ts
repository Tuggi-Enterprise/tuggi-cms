/**
 * The orphan screen of the client approval is gone — #382, épico #356.
 *
 * WHAT WAS WRONG WITH IT, and it was not just being unreachable:
 * `/[locale]/dashboard/client-approvals` had no link, no `href` and no i18n key anywhere, its two
 * callbacks were `console.log` — handlers that LOOK like the effect and are not (CLAUDE.md §6,
 * "nome que mente") — and it was a SECOND door to the act that starts a commercial relationship.
 * The esteira of #359 absorbed that act: approving the partner happens at
 * `/[locale]/admin/partnerships/clients/[clientId]`.
 *
 * WHAT THIS SUITE ASSERTS IS BOTH HALVES, because a deletion test that only proves absence is how
 * the next commit takes the live path with it: the screen and its only consumer are gone, AND the
 * route and the effects the esteira depends on are still there, still wired.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

function read(relative: string): string {
  return readFileSync(resolve(REPO_ROOT, relative), 'utf8')
}

/** Every source file under the CMS that mentions `needle`, as repo-relative paths. */
function mentions(needle: string): string[] {
  const roots = ['app', 'components', 'lib', 'messages', 'constants', 'types']
  const found: string[] = []

  function walk(dir: string) {
    for (const entry of readdirSync(join(REPO_ROOT, dir))) {
      const relative = join(dir, entry)
      const full = join(REPO_ROOT, relative)
      if (statSync(full).isDirectory()) {
        walk(relative)
        continue
      }
      if (!/\.(ts|tsx|json)$/.test(entry)) continue
      if (readFileSync(full, 'utf8').indexOf(needle) >= 0) found.push(relative)
    }
  }

  for (const root of roots) {
    try {
      walk(root)
    } catch {
      // A root this repo does not have is not a failure of this assertion.
    }
  }
  return found.sort()
}

test('#382 · CLAUDE.md §6: the orphan screen is gone, and so is its only consumer', () => {
  assert.equal(
    existsSync(resolve(REPO_ROOT, 'app/[locale]/dashboard/client-approvals')),
    false,
    'a screen with no route, no link and no i18n key is an orphan'
  )
  assert.equal(
    existsSync(resolve(REPO_ROOT, 'components/clients/ClientApprovalPanel.tsx')),
    false,
    'the panel had exactly one consumer, and it was that screen'
  )

  assert.deepEqual(mentions('client-approvals'), [])
  // Including the props interface in `types/clients.ts`, which described a component that no
  // longer exists — and which the component never imported anyway (it declared its own).
  assert.deepEqual(mentions('ClientApprovalPanel'), [])
})

test('#382: the act it duplicated is still there, and still wired to the esteira', () => {
  // NOT a target of this card: the route is the live one, called by the client screen's
  // `ApprovalHeaderControls`.
  const route = 'app/api/admin/clients/[clientId]/approve/route.ts'
  assert.equal(existsSync(resolve(REPO_ROOT, route)), true)

  // AND IT NO LONGER CREATES A PLACE. Since #360 approving the client created one by itself,
  // and it produced a duplicate every time: the establishment was already in the catalogue,
  // published and pinned, and approval put an empty row beside it. An automatic act cannot
  // search the catalogue first, and searching first is what stops the duplicate.
  // The comment in the route still NAMES the function, and that is the point — it says where
  // the act went. What must be absent is the import and the call.
  assert.equal(read(route).indexOf("from '@/lib/services/partner-place-provisioning'"), -1)
  assert.doesNotMatch(read(route), /await\s+provisionPartnerPlace\(/)

  assert.equal(existsSync(resolve(REPO_ROOT, 'lib/services/partner-approval-effects.ts')), false)
  assert.match(
    read('lib/services/partner-place-provisioning.ts'),
    /export async function provisionPartnerPlace/
  )

  // The screen that has the act now, and it is the ONLY caller: the operator sees the catalogue
  // search above the button before deciding (#359, `Criar o local a partir da proposta`).
  assert.match(
    read('app/api/admin/partnerships/clients/[clientId]/places/route.ts'),
    /provisionPartnerPlace/
  )

  // And the caller that keeps the approve route from being an orphan in its turn.
  assert.match(
    read('components/admin/clients/shared/ApprovalHeaderControls.tsx'),
    /\/api\/admin\/clients\/\$\{clientId\}\/approve/
  )
})
