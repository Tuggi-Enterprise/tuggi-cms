/**
 * #809 — the photos of a Portal Locais submission, capped ON READ (contract
 * `docs/contracts/partner-proposal-answers.md` §8.5, BR-B2B-044 items 2 and 3).
 *
 * The Storage policy only tests the limit before writing as superuser, so the bucket can hold
 * more than the plan allows. These tests pin the deterministic selection the CMS applies, and
 * that the screen degrades to "no photos" while the bucket does not exist.
 *
 * Run with: npm run test:api
 */

import { before, test, mock } from 'node:test'
import assert from 'node:assert/strict'

import type * as Photos from '@/lib/services/place-submission-photos'

const SUBMISSION = '11111111-1111-4111-8111-111111111111'

const obj = (id: string, createdAt: string) => ({ id, name: `${id}.jpg`, created_at: createdAt })
const at = (minute: number) => `2026-10-04T12:${String(minute).padStart(2, '0')}:00.000Z`

// ── the stand-in Storage ────────────────────────────────────────────────────────────────────

let folders: Record<string, ReturnType<typeof obj>[]> = {}
let listError: { message: string } | null = null
let signedTtl: number | null = null

const fakeService = {
  storage: {
    from: (bucket: string) => {
      assert.equal(bucket, 'place-submission-photos')
      return {
        list: async (prefix: string) =>
          listError ? { data: null, error: listError } : { data: folders[prefix] ?? [], error: null },
        createSignedUrls: async (paths: string[], ttl: number) => {
          signedTtl = ttl
          return { data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}?ttl=${ttl}`, error: null })), error: null }
        },
      }
    },
  },
}

let photos: typeof Photos

before(async () => {
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseService: () => fakeService,
      getSupabase: () => fakeService,
      getSupabaseRouteHandler: () => fakeService,
      getSupabaseClient: () => ({}),
    },
  })
  photos = await import('@/lib/services/place-submission-photos')
})

// ── pure selection ──────────────────────────────────────────────────────────────────────────

test('BR-B2B-044: two facades in the bucket — only the OLDEST is the facade', () => {
  const chosen = photos.selectSubmissionPhotos({
    facade: [obj('b', at(5)), obj('a', at(1))],
    gallery: [],
    planChoice: 'map_and_description',
    cutoff: null,
  })
  assert.equal(chosen.facade?.id, 'a')
})

test('BR-B2B-044 item 3: seven gallery photos on the paid plan — the 5 oldest, ties broken by id', () => {
  const gallery = [7, 6, 5, 4, 3, 2].map((m) => obj(`g${m}`, at(m)))
  gallery.push(obj('g0', at(2))) // same created_at as g2: `id` decides
  const chosen = photos.selectSubmissionPhotos({ facade: [], gallery, planChoice: 'map_and_description', cutoff: null })
  assert.deepEqual(
    chosen.gallery.map((o) => o.id),
    ['g0', 'g2', 'g3', 'g4', 'g5']
  )
})

test('BR-B2B-044 item 2: on "No mapa" the gallery stops at 2 (3 photos with the facade)', () => {
  const gallery = [1, 2, 3, 4].map((m) => obj(`g${m}`, at(m)))
  for (const planChoice of ['map_only', undefined]) {
    const chosen = photos.selectSubmissionPhotos({ facade: [obj('f', at(0))], gallery, planChoice, cutoff: null })
    assert.deepEqual(chosen.gallery.map((o) => o.id), ['g1', 'g2'])
    assert.equal(chosen.facade?.id, 'f')
  }
})

test('BR-B2B-044: on approval, a photo created after the cutoff is ignored — facade included', () => {
  const chosen = photos.selectSubmissionPhotos({
    facade: [obj('late-facade', at(30))],
    gallery: [obj('g1', at(1)), obj('late', at(30))],
    planChoice: 'map_and_description',
    cutoff: at(20),
  })
  assert.equal(chosen.facade, null)
  assert.deepEqual(chosen.gallery.map((o) => o.id), ['g1'])
})

test('BR-B2B-044: the cutoff is the LAST exit from draft/changes_requested, not the first submit', () => {
  const cutoff = photos.photoCutoff([
    { from_status: 'draft', created_at: '2026-10-01T10:00:00.000000+00:00' },
    { from_status: 'in_review', created_at: '2026-10-02T10:00:00.000000+00:00' },
    { from_status: 'changes_requested', created_at: '2026-10-03T10:00:00.000000+00:00' },
    { from_status: 'in_review', created_at: '2026-10-04T10:00:00.000000+00:00' },
  ])
  assert.equal(cutoff, '2026-10-03T10:00:00.000000+00:00')
  assert.equal(photos.photoCutoff([]), null)
  assert.equal(photos.isPhotoSetFrozen('in_review'), true)
  assert.equal(photos.isPhotoSetFrozen('changes_requested'), false)
})

// ── read + sign ─────────────────────────────────────────────────────────────────────────────

test('BR-B2B-044: readSubmissionPhotos returns facade first, capped, with 5-minute signed URLs', async () => {
  listError = null
  folders = {
    [`${SUBMISSION}/facade`]: [obj('f2', at(3)), obj('f1', at(1))],
    [`${SUBMISSION}/gallery`]: [obj('g1', at(1)), obj('g2', at(2)), obj('g3', at(3)), { id: null as never, name: '.emptyFolderPlaceholder', created_at: null as never }],
  }
  const result = await photos.readSubmissionPhotos(SUBMISSION, { planChoice: 'map_only', cutoff: null })
  assert.deepEqual(
    result.map((p) => [p.role, p.path]),
    [
      ['facade', `${SUBMISSION}/facade/f1.jpg`],
      ['gallery', `${SUBMISSION}/gallery/g1.jpg`],
      ['gallery', `${SUBMISSION}/gallery/g2.jpg`],
    ]
  )
  assert.equal(signedTtl, 300)
  assert.ok(result.every((p) => p.url.startsWith('https://signed/')))
})

test('#809: bucket not created yet (migration not applied) — no photos, no throw', async () => {
  listError = { message: 'Bucket not found' }
  const result = await photos.readSubmissionPhotos(SUBMISSION, { planChoice: 'map_and_description', cutoff: null })
  assert.deepEqual(result, [])
  listError = null
})
