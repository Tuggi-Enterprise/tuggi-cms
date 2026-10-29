/**
 * #889, #1055 — the paid content follows the payment (BR-B2B-019, BR-B2B-060, BR-B2B-044).
 *
 * `reconcilePartnerStories` is import-free: it runs for real against a fake database that answers
 * the three RPCs the way `db-tuggiApp` migration `20261029120100` documents them (the database
 * decides; the module only calls, removes the voiced files and rebuilds the read model). Nothing
 * here touches a database, a bucket or an Edge Function.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  reconcilePartnerStories,
  type PaidContentPlace,
  type RestoreResult,
  type SuspendOutcome,
  type SuspensionDeps,
} from '../../supabase/functions/_shared/places-story-suspension'

const PORTAL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const LEGACY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const EXCEPTION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const BROKEN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

// A place as the database sees it: whether the paid right is on, the exception, and what is shown.
type Place = { paid: boolean; exception: boolean; shown: 'story' | 'name'; archived: boolean; fail?: string }

type World = {
  places: Record<string, Place>
  log: string[]
  alerts: { what: string; fields: Record<string, unknown> }[]
  filesError: Error | null
  alertError: Error | null
}

function world(places: Record<string, Place>, over: Partial<World> = {}): World {
  return { places, log: [], alerts: [], filesError: null, alertError: null, ...over }
}

// The fake follows the documented contract of the SQL functions, so a second run is a no-op.
function deps(w: World): SuspensionDeps {
  return {
    places: async (): Promise<PaidContentPlace[]> =>
      Object.entries(w.places).map(([id, p]) => ({ attractionId: id, state: p.paid ? 'paid' : 'ended', archived: p.archived })),
    suspend: async (id): Promise<SuspendOutcome> => {
      w.log.push(`suspend ${id}`)
      const p = w.places[id]
      if (p.fail) throw new Error(`suspend ${p.fail}`)
      if (p.exception) return 'exception'
      if (p.paid) return 'not_ended'
      if (p.archived) return 'already_suspended'
      p.archived = true
      p.shown = 'name'
      return 'suspended'
    },
    restore: async (id): Promise<RestoreResult> => {
      w.log.push(`restore ${id}`)
      const p = w.places[id]
      if (p.fail) throw new Error(`restore ${p.fail}`)
      if (p.exception) return { outcome: 'exception', textRestored: false, imagesRestored: 0 }
      if (!p.paid) return { outcome: 'not_paid', textRestored: false, imagesRestored: 0 }
      if (!p.archived) return { outcome: 'nothing_archived', textRestored: false, imagesRestored: 0 }
      p.archived = false
      p.shown = 'story'
      return { outcome: 'restored', textRestored: true, imagesRestored: 2 }
    },
    removeVoicedFiles: async (id) => {
      w.log.push(`files ${id}`)
      if (w.filesError) throw w.filesError
    },
    rebuildReadModel: async (id) => {
      w.log.push(`rebuild ${id}`)
    },
    alert: async (what, fields) => {
      if (w.alertError) throw w.alertError
      w.alerts.push({ what, fields })
    },
  }
}

const zero = { suspended: 0, restored: 0, exception: 0, waiting: 0, failed: 0 }

test('BR-B2B-019 items 1, 3, 7 · a portal place whose plan ended: suspended, then files, then read model', async () => {
  const w = world({ [PORTAL]: { paid: false, exception: false, shown: 'story', archived: false } })
  const s = await reconcilePartnerStories(deps(w))
  assert.deepEqual(s, { ...zero, suspended: 1 })
  assert.deepEqual(w.log, [`suspend ${PORTAL}`, `files ${PORTAL}`, `rebuild ${PORTAL}`])
  assert.equal(w.places[PORTAL].shown, 'name')
})

test('BR-B2B-060 / BR-B2B-044 · a pre-portal place whose paid month ended goes the same way', async () => {
  const w = world({ [LEGACY]: { paid: false, exception: false, shown: 'story', archived: false } })
  const s = await reconcilePartnerStories(deps(w))
  assert.deepEqual(s, { ...zero, suspended: 1 })
  assert.deepEqual(w.log, [`suspend ${LEGACY}`, `files ${LEGACY}`, `rebuild ${LEGACY}`])
})

test('BR-B2B-060 · a place still inside the period already paid is not suspended', async () => {
  const w = world({ [LEGACY]: { paid: true, exception: false, shown: 'story', archived: false } })
  const s = await reconcilePartnerStories(deps(w))
  assert.deepEqual(s, zero)
  assert.deepEqual(w.log, [`restore ${LEGACY}`], 'only the no-op restore, no files, no rebuild')
})

test('BR-B2B-019 item 6 · paying again brings story and photos back, then removes the name files', async () => {
  const w = world({ [PORTAL]: { paid: true, exception: false, shown: 'name', archived: true } })
  const s = await reconcilePartnerStories(deps(w))
  assert.deepEqual(s, { ...zero, restored: 1 })
  assert.deepEqual(w.log, [`restore ${PORTAL}`, `files ${PORTAL}`, `rebuild ${PORTAL}`])
  assert.equal(w.places[PORTAL].shown, 'story')
})

test('BR-B2B-019 item 6 · restored without the text (a text written in between wins): its files stay', async () => {
  const w = world({ [PORTAL]: { paid: true, exception: false, shown: 'name', archived: true } })
  const d = deps(w)
  d.restore = async (id) => {
    w.log.push(`restore ${id}`)
    return { outcome: 'restored', textRestored: false, imagesRestored: 2 }
  }
  const s = await reconcilePartnerStories(d)
  assert.deepEqual(s, { ...zero, restored: 1 })
  assert.deepEqual(w.log, [`restore ${PORTAL}`, `rebuild ${PORTAL}`])
})

test('BR-B2B-019 · the operator exception wins: counted, nothing removed, nothing rebuilt', async () => {
  const w = world({
    [EXCEPTION]: { paid: false, exception: true, shown: 'story', archived: false },
    [PORTAL]: { paid: true, exception: true, shown: 'story', archived: false },
  })
  const s = await reconcilePartnerStories(deps(w))
  assert.deepEqual(s, { ...zero, exception: 2 })
  assert.equal(w.log.some((l) => l.startsWith('files') || l.startsWith('rebuild')), false)
  assert.equal(w.places[EXCEPTION].shown, 'story')
})

test('BR-B2B-019 · idempotent: the second run changes nothing and makes no call for an archived ended place', async () => {
  const w = world({
    [PORTAL]: { paid: false, exception: false, shown: 'story', archived: false },
    [LEGACY]: { paid: true, exception: false, shown: 'name', archived: true },
  })
  await reconcilePartnerStories(deps(w))
  w.log = []
  const second = await reconcilePartnerStories(deps(w))
  assert.deepEqual(second, zero)
  assert.deepEqual(w.log, [`restore ${LEGACY}`], 'the suspended place is skipped; the paid one is a no-op')
})

test('BR-B2B-019 · one place failing (23503 from a trigger point) alerts and the others still run', async () => {
  const w = world({
    [BROKEN]: { paid: false, exception: false, shown: 'story', archived: false, fail: '23503' },
    [PORTAL]: { paid: false, exception: false, shown: 'story', archived: false },
    [LEGACY]: { paid: true, exception: false, shown: 'name', archived: true },
  })
  const s = await reconcilePartnerStories(deps(w))
  assert.deepEqual(s, { ...zero, suspended: 1, restored: 1, failed: 1 })
  assert.equal(w.alerts.length, 1)
  assert.equal(w.alerts[0].what, 'story_suspension_failed')
  assert.equal(w.alerts[0].fields.attraction_id, BROKEN)
  assert.match(String(w.alerts[0].fields.error), /23503/)
})

test('BR-B2B-019 · a failed alert does not stop the loop either', async () => {
  const w = world(
    {
      [BROKEN]: { paid: false, exception: false, shown: 'story', archived: false, fail: '23503' },
      [PORTAL]: { paid: false, exception: false, shown: 'story', archived: false },
    },
    { alertError: new Error('mail down') }
  )
  const s = await reconcilePartnerStories(deps(w))
  assert.deepEqual(s, { ...zero, suspended: 1, failed: 1 })
})

test('BR-B2B-019 item 7 · files that fail to go are alerted; the suspension still counts and the read model rebuilds', async () => {
  const w = world({ [PORTAL]: { paid: false, exception: false, shown: 'story', archived: false } }, { filesError: new Error('audio remove failed') })
  const s = await reconcilePartnerStories(deps(w))
  assert.deepEqual(s, { ...zero, suspended: 1 })
  assert.deepEqual(w.alerts.map((a) => a.what), ['story_suspension_files_failed'])
  assert.equal(w.log[w.log.length - 1], `rebuild ${PORTAL}`)
})

test('BR-B2B-019 · processing waits for the next run; no_name alerts', async () => {
  const w = world({
    [PORTAL]: { paid: false, exception: false, shown: 'story', archived: false },
    [LEGACY]: { paid: false, exception: false, shown: 'story', archived: false },
  })
  const d = deps(w)
  d.suspend = async (id) => (id === PORTAL ? 'processing' : 'no_name')
  const s = await reconcilePartnerStories(d)
  assert.deepEqual(s, { ...zero, waiting: 1, failed: 1 })
  assert.deepEqual(w.alerts.map((a) => [a.what, a.fields.attraction_id]), [['story_suspension_no_name', LEGACY]])
  assert.equal(w.log.length, 0, 'no files, no rebuild')
})

test('BR-B2B-019 · a row that is not a uuid is skipped before any call', async () => {
  const w = world({})
  const d = deps(w)
  d.places = async () => [{ attractionId: '../x', state: 'ended', archived: false }]
  const s = await reconcilePartnerStories(d)
  assert.deepEqual(s, zero)
  assert.equal(w.log.length, 0)
})
