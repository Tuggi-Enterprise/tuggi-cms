/**
 * #889 — the paid description follows the payment (BR-B2B-019).
 *
 * `reconcilePartnerStories` is import-free: it runs for real, every effect is a fake and every case
 * asserts what was WRITTEN (and in which order), never which helper was called. Nothing here touches
 * a database, a bucket or an Edge Function.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  reconcilePartnerStories,
  nameOnlyRow,
  storyRow,
  PARTNER_STORY_SCRIPT_KIND,
  PARTNER_NAME_ONLY_KIND,
  type BaseRow,
  type StoryPlace,
  type SuspensionDeps,
} from '../../supabase/functions/_shared/places-story-suspension'

const NOW = new Date('2026-10-06T12:00:00.000Z')
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const S1 = '11111111-1111-4111-8111-111111111111'
const S2 = '22222222-2222-4222-8222-222222222222'
const STORY = 'Meu avô Aurélio abriu a cantina em 1962.'

type World = {
  places: StoryPlace[]
  paid: Record<string, boolean | Error>
  name: string
  hasException: boolean
  kind: string | null
  removeError: Error | null
  log: string[]
  alerts: { what: string; fields: Record<string, unknown> }[]
  writes: { id: string; from: string; row: BaseRow }[]
}

function world(over: Partial<World> = {}): World {
  return {
    places: [{ submissionId: S1, attractionId: A, story: STORY }],
    paid: { [S1]: false },
    name: 'Bar do Zé',
    hasException: false,
    kind: PARTNER_STORY_SCRIPT_KIND,
    removeError: null,
    log: [],
    alerts: [],
    writes: [],
    ...over,
  }
}

function deps(w: World): SuspensionDeps {
  return {
    storyPlaces: async () => w.places,
    entitled: async (id) => {
      const v = w.paid[id]
      if (v instanceof Error) throw v
      return v === true
    },
    placeFacts: async () => ({ name: w.name, hasException: w.hasException }),
    baseKind: async () => w.kind,
    removeVoicedCopies: async (id) => {
      w.log.push('remove')
      if (w.removeError) throw w.removeError
      void id
    },
    // Conditional UPDATE, as in the runtime: only moves the row when its kind is `fromKind`.
    writeBase: async (id, from, row) => {
      w.log.push('write')
      if (w.kind !== from) return false
      w.writes.push({ id, from, row })
      w.kind = row.generation_meta.kind
      return true
    },
    rebuildReadModel: async () => {
      w.log.push('rebuild')
    },
    alert: async (what, fields) => {
      w.alerts.push({ what, fields })
    },
    now: () => NOW,
  }
}

test('BR-B2B-019 items 1 and 3 · unpaid with a story base: voiced copies go first, then the base becomes the name', async () => {
  const w = world()
  const s = await reconcilePartnerStories(deps(w))
  assert.deepEqual(s, { suspended: 1, restored: 0, exception: 0, failed: 0 })
  assert.deepEqual(w.log, ['remove', 'write', 'rebuild'], 'copies removed BEFORE the base write')
  assert.equal(w.writes.length, 1)
  assert.equal(w.writes[0].from, 'partner_story_script')
  assert.deepEqual(w.writes[0].row, nameOnlyRow('Bar do Zé', NOW))
  assert.equal(w.writes[0].row.description, 'Bar do Zé')
  assert.equal(w.writes[0].row.audio_url, null)
  assert.deepEqual(w.writes[0].row.generation_meta, { kind: 'partner_name_only' })
})

test('BR-B2B-019 item 6 · paid again with a name-only base: the story comes back from the same input', async () => {
  const w = world({ paid: { [S1]: true }, kind: PARTNER_NAME_ONLY_KIND })
  const s = await reconcilePartnerStories(deps(w))
  assert.deepEqual(s, { suspended: 0, restored: 1, exception: 0, failed: 0 })
  assert.deepEqual(w.writes[0].row, storyRow(STORY, NOW))
  assert.equal(w.writes[0].from, 'partner_name_only')
  assert.deepEqual(w.writes[0].row.generation_meta, { kind: 'partner_story_script' })
})

for (const [label, story] of [['no story', null], ['blank story', '  \n\t ']] as const) {
  test(`BR-B2B-019 item 6 · paid again but ${label}: nothing written, outcome none`, async () => {
    const w = world({ paid: { [S1]: true }, kind: PARTNER_NAME_ONLY_KIND, places: [{ submissionId: S1, attractionId: A, story }] })
    const s = await reconcilePartnerStories(deps(w))
    assert.deepEqual(s, { suspended: 0, restored: 0, exception: 0, failed: 0 })
    assert.deepEqual(w.log, [])
    assert.equal(w.writes.length, 0)
  })
}

test('BR-B2B-019 · restore trims the story', async () => {
  const w = world({ paid: { [S1]: true }, kind: PARTNER_NAME_ONLY_KIND, places: [{ submissionId: S1, attractionId: A, story: `  ${STORY}\n` }] })
  await reconcilePartnerStories(deps(w))
  assert.equal(w.writes[0].row.description, STORY)
})

test("BR-B2B-019 operator's exception · wins in both directions: no write, counted as exception", async () => {
  for (const [paid, kind] of [[false, PARTNER_STORY_SCRIPT_KIND], [true, PARTNER_NAME_ONLY_KIND]] as const) {
    const w = world({ paid: { [S1]: paid }, kind, hasException: true })
    const s = await reconcilePartnerStories(deps(w))
    assert.deepEqual(s, { suspended: 0, restored: 0, exception: 1, failed: 0 })
    assert.deepEqual(w.log, [], `paid=${paid}`)
  }
})

test('BR-B2B-019 · catalogue, operator or absent base is never touched, paid or not', async () => {
  for (const kind of ['catalog', 'operator_edit', '[PROCESSING]', 'something_else', null]) {
    for (const paid of [false, true]) {
      const w = world({ paid: { [S1]: paid }, kind })
      const s = await reconcilePartnerStories(deps(w))
      assert.deepEqual(s, { suspended: 0, restored: 0, exception: 0, failed: 0 }, `kind=${kind} paid=${paid}`)
      assert.deepEqual(w.log, [], `kind=${kind} paid=${paid}`)
    }
  }
})

test('BR-B2B-019 item 4 · two submissions on one place, one paid: the place is paid, nothing is demoted', async () => {
  const w = world({
    places: [
      { submissionId: S1, attractionId: A, story: STORY },
      { submissionId: S2, attractionId: A, story: STORY },
    ],
    paid: { [S1]: false, [S2]: true },
  })
  const s = await reconcilePartnerStories(deps(w))
  assert.deepEqual(s, { suspended: 0, restored: 0, exception: 0, failed: 0 })
  assert.deepEqual(w.log, [])
  assert.equal(w.kind, PARTNER_STORY_SCRIPT_KIND)
})

test('BR-B2B-019 · two submissions on one place, none paid: demoted once', async () => {
  const w = world({
    places: [
      { submissionId: S1, attractionId: A, story: STORY },
      { submissionId: S2, attractionId: A, story: STORY },
    ],
    paid: { [S1]: false, [S2]: false },
  })
  const s = await reconcilePartnerStories(deps(w))
  assert.equal(s.suspended, 1)
  assert.equal(w.writes.length, 1)
})

test('BR-B2B-019 · removeVoicedCopies throws: base NOT written, alert raised, the next place still runs', async () => {
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const S3 = '33333333-3333-4333-8333-333333333333'
  const w = world({
    places: [
      { submissionId: S1, attractionId: A, story: STORY },
      { submissionId: S3, attractionId: B, story: STORY },
    ],
    paid: { [S1]: false, [S3]: false },
  })
  const d = deps(w)
  const realRemove = d.removeVoicedCopies
  d.removeVoicedCopies = async (id) => {
    if (id === A) {
      w.log.push('remove-A-throws')
      throw new Error('storage down')
    }
    return realRemove(id)
  }
  const s = await reconcilePartnerStories(d)
  assert.deepEqual(s, { suspended: 1, restored: 0, exception: 0, failed: 1 })
  assert.equal(w.writes.length, 1)
  assert.equal(w.writes[0].id, B, 'only the healthy place was written')
  assert.equal(w.alerts.length, 1)
  assert.equal(w.alerts[0].what, 'story_suspension_failed')
  assert.equal(w.alerts[0].fields.attraction_id, A)
})

test('BR-B2B-019 · entitlement read error is `failed`, never "not paid": a paying place keeps its story', async () => {
  const w = world({ paid: { [S1]: new Error('entitled 42501') } })
  const s = await reconcilePartnerStories(deps(w))
  assert.deepEqual(s, { suspended: 0, restored: 0, exception: 0, failed: 1 })
  assert.equal(w.writes.length, 0)
  assert.equal(w.log.includes('remove'), false, 'no copy was removed on a read error')
  assert.equal(w.kind, PARTNER_STORY_SCRIPT_KIND)
  assert.equal(w.alerts[0].what, 'story_suspension_failed')
})

test('BR-B2B-019 · empty or blank place name: not demoted (the row would carry no text)', async () => {
  for (const name of ['', '   ']) {
    const w = world({ name })
    const s = await reconcilePartnerStories(deps(w))
    assert.deepEqual(s, { suspended: 0, restored: 0, exception: 0, failed: 0 }, JSON.stringify(name))
    assert.deepEqual(w.log, [])
  }
})

test('BR-B2B-019 · ids that are not uuid are ignored, never reach a dependency', async () => {
  const w = world({
    places: [
      { submissionId: S1, attractionId: 'not-a-uuid', story: STORY },
      { submissionId: 'nope', attractionId: A, story: STORY },
      { submissionId: S1, attractionId: `${A}'; drop`, story: STORY },
    ],
  })
  let entitledCalls = 0
  const d = deps(w)
  const e = d.entitled
  d.entitled = async (id) => {
    entitledCalls++
    return e(id)
  }
  const s = await reconcilePartnerStories(d)
  assert.deepEqual(s, { suspended: 0, restored: 0, exception: 0, failed: 0 })
  assert.equal(entitledCalls, 0)
  assert.deepEqual(w.log, [])
})

test('BR-B2B-019 · second run does nothing (idempotent), in both directions', async () => {
  const down = world()
  await reconcilePartnerStories(deps(down))
  const logAfter1 = [...down.log]
  const s2 = await reconcilePartnerStories(deps(down))
  assert.deepEqual(s2, { suspended: 0, restored: 0, exception: 0, failed: 0 })
  assert.deepEqual(down.log, logAfter1, 'no effect on the 2nd run')

  const up = world({ paid: { [S1]: true }, kind: PARTNER_NAME_ONLY_KIND })
  await reconcilePartnerStories(deps(up))
  const up1 = [...up.log]
  const s3 = await reconcilePartnerStories(deps(up))
  assert.deepEqual(s3, { suspended: 0, restored: 0, exception: 0, failed: 0 })
  assert.deepEqual(up.log, up1)
})

test('BR-B2B-019 · race: the conditional write finds another kind (false): outcome none, no read-model rebuild', async () => {
  const w = world()
  const d = deps(w)
  d.writeBase = async () => {
    w.log.push('write')
    return false
  }
  const s = await reconcilePartnerStories(d)
  assert.deepEqual(s, { suspended: 0, restored: 0, exception: 0, failed: 0 })
  assert.equal(w.log.includes('rebuild'), false)
})
