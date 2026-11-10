/**
 * #1185 — the guide's profile is the account's profile, in the CMS. BR-B2B-064 items 4.a, 9.a,
 * 9.b and 11.a, BR-USUARIO-050 item 2.d, BR-USUARIO-042, BR-B2B-069 item 2.b (as amended on
 * 2026-11-10). Contract `docs/contracts/parceiro-sem-local.md` §8.6.
 *
 * The database is faked. What runs for real: `loadGuideProfile`, `loadGuideProfileFacts`,
 * `copyFacadeToProfilePhoto`, `facadeProfilePhotoPaths`, `guideRpcErrorOf`, `setGuideListed`,
 * `guideVisibilityOf` and `derivePipelineState`. That `core.cms_set_guide_listed` checks the
 * account's photo and bio and the WhatsApp (TGP23), and that `core.cms_publish_guide_profile`
 * fills only the empty fields of the account, is the database's promise (lab of migration
 * 20261110180000); here, that the CMS reads the account, copies the facade where the function
 * looks for it, and says each refusal apart.
 *
 * Mutations that turn this suite red:
 *  · the record reading the name, the bio, the photo or the languages from `partner.guide_profiles`;
 *  · the record selecting `full_name`, or showing a name the guide did not authorize;
 *  · the photo read from the public `guide-photos` instead of a signed URL of `profile-photos`;
 *  · the queue calling a guide "No app" while the account has no photo or no bio, or no WhatsApp;
 *  · the facade copied to `guide-photos`, to another folder than the account's, under another name
 *    than `<uuid>.jpg`, copied when the account already has a photo, or copied when it is not a JPEG;
 *  · TGP23 owner or whatsapp read as "no meeting point", or TGP10 owner as a status conflict;
 *  · the tick free to switch on without a WhatsApp.
 *
 * Run with: npm run test:api
 */

import { before, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')
const CLIENT = '33333333-3333-4333-8333-333333333333'
const ACCOUNT = '66666666-6666-4666-8666-666666666666'
const SUB = '11111111-1111-4111-8111-111111111111'
const FACADE_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PHOTO_KEY = `${ACCOUNT}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg`
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])

const GUIDE_ROW = {
  client_id: CLIENT,
  specialties: ['city_tour'],
  whatsapp: '5522999998888',
  public_contact_consent: true,
  hidden: false,
  hidden_reason: null,
  updated_at: '2026-11-10T12:00:00Z',
  listed_in_app: false,
  meeting_point_address: 'Praça Santos Dumont',
  meeting_point_city: 'Búzios',
  meeting_point_lat: -22.7469,
  meeting_point_lng: -41.8817,
}
const ACCOUNT_ROW = {
  id: ACCOUNT,
  nickname: 'ana.guia',
  published_name: 'Ana Guia',
  bio: 'Conto a história da península a pé.',
  photo_key: PHOTO_KEY,
  spoken_languages: ['en', 'pt'],
}

interface World {
  guideRow: Record<string, unknown> | null
  owner: string | null
  account: Record<string, unknown> | null
  facade: Uint8Array
  /** Every `select` of every table, as `<table>:<columns>`. */
  selects: string[]
  /** Every Storage call, as `<verb>:<bucket>/<path>`. */
  storage: string[]
  uploadOptions: Record<string, unknown> | null
}
let w: World

beforeEach(() => {
  w = { guideRow: GUIDE_ROW, owner: ACCOUNT, account: ACCOUNT_ROW, facade: JPEG, selects: [], storage: [], uploadOptions: null }
})

function table(name: string) {
  const q: any = {
    select: (columns: string) => {
      w.selects.push(`${name}:${columns}`)
      return q
    },
    eq: () => q,
    in: () => q,
    maybeSingle: async () => {
      if (name === 'guide_profiles') return { data: w.guideRow, error: null }
      if (name === 'profiles') return { data: w.account, error: null }
      return { data: null, error: null }
    },
    then: (done: (v: unknown) => unknown) => {
      if (name === 'guide_profiles') return done({ data: w.guideRow ? [w.guideRow] : [], error: null })
      if (name === 'clients') return done({ data: [{ id: CLIENT, owner_user_id: w.owner }], error: null })
      if (name === 'profiles') return done({ data: w.account ? [w.account] : [], error: null })
      return done({ data: [], error: null })
    },
  }
  return q
}

const service = {
  schema: () => ({ from: (name: string) => table(name) }),
  storage: {
    from: (bucket: string) => ({
      createSignedUrl: async (path: string, ttl: number) => {
        w.storage.push(`sign:${bucket}/${path}`)
        return { data: { signedUrl: `https://cms.test/sign/${bucket}/${path}?ttl=${ttl}` }, error: null }
      },
      download: async (path: string) => {
        w.storage.push(`download:${bucket}/${path}`)
        return { data: new Blob([w.facade as BlobPart]), error: null }
      },
      upload: async (path: string, _body: unknown, options: Record<string, unknown>) => {
        w.storage.push(`upload:${bucket}/${path}`)
        w.uploadOptions = options
        return { data: { path }, error: null }
      },
      copy: async (from: string, to: string) => {
        w.storage.push(`copy:${bucket}/${from}->${to}`)
        return { data: null, error: null }
      },
    }),
  },
}

let guides: typeof import('@/lib/services/guide-profile-service')
let pipeline: typeof import('@/lib/partnerships/pipeline')

before(async () => {
  mock.module('@/lib/core/supabase-client', { namedExports: { getSupabaseService: () => service } })
  guides = await import('@/lib/services/guide-profile-service')
  pipeline = await import('@/lib/partnerships/pipeline')
})

function quiet<T>(run: () => Promise<T>): Promise<T> {
  const original = console.error
  console.error = () => {}
  return run().finally(() => {
    console.error = original
  })
}

// ── The record reads the account ──────────────────────────────────────────────────────────────

test('BR-B2B-064 item 4.a: the record reads name, @, bio, photo and languages from the account that owns the guide', async () => {
  const read = await guides.loadGuideProfile(CLIENT)
  assert.ok(read.ok && read.profile)
  assert.equal(read.profile.hasAccount, true)
  assert.equal(read.profile.handle, 'ana.guia')
  assert.equal(read.profile.shownName, 'Ana Guia')
  assert.equal(read.profile.bio, ACCOUNT_ROW.bio)
  assert.deepEqual(read.profile.languages, ['en', 'pt'])
  assert.equal(read.profile.hasPhoto, true)
  // The photo is the account's, in the private bucket: a signed URL, never the public guide-photos.
  assert.deepEqual(w.storage, [`sign:profile-photos/${PHOTO_KEY}`])
  assert.match(read.profile.photoUrl ?? '', /^https:\/\/cms\.test\/sign\/profile-photos\//)
  // The display row keeps what is its own.
  assert.equal(read.profile.whatsapp, '5522999998888')
  assert.deepEqual(read.profile.specialties, ['city_tour'])
})

test('BR-B2B-064 item 4.a.i: the out-of-use copies of guide_profiles are never selected', async () => {
  await guides.loadGuideProfile(CLIENT)
  await guides.loadGuideProfileFacts([CLIENT])
  const guideSelects = w.selects.filter((s) => s.startsWith('guide_profiles:'))
  assert.ok(guideSelects.length >= 2)
  for (const select of guideSelects) {
    const columns = select.slice('guide_profiles:'.length).split(',').map((c) => c.trim())
    for (const dead of ['display_name', 'bio', 'photo_path', 'languages', 'instagram', 'tiktok', 'youtube', 'facebook']) {
      assert.ok(!columns.includes(dead), `${dead} in ${select}`)
    }
  }
})

test('BR-USUARIO-050 item 2.d · BR-USUARIO-042: without the authorization the record shows only the @, and full_name never leaves the database', async () => {
  w.account = { ...ACCOUNT_ROW, published_name: null }
  const read = await guides.loadGuideProfile(CLIENT)
  assert.ok(read.ok && read.profile)
  assert.equal(read.profile.shownName, null)
  assert.equal(read.profile.handle, 'ana.guia')
  const accountSelects = w.selects.filter((s) => s.startsWith('profiles:'))
  assert.ok(accountSelects.length > 0)
  for (const select of accountSelects) {
    assert.match(select, /\bpublished_name\b/)
    assert.doesNotMatch(select, /\bfull_name\b/)
  }
})

test('#1185: a record without an account reads whole, with every account field empty and no Storage call', async () => {
  w.owner = null
  const read = await guides.loadGuideProfile(CLIENT)
  assert.ok(read.ok && read.profile)
  assert.equal(read.profile.hasAccount, false)
  assert.equal(read.profile.handle, null)
  assert.equal(read.profile.bio, null)
  assert.equal(read.profile.hasPhoto, false)
  assert.equal(read.profile.photoUrl, null)
  assert.deepEqual(read.profile.languages, [])
  assert.deepEqual(w.storage, [])
})

// ── The queue: listed means in "Parceiros" ───────────────────────────────────────────────────

test('BR-B2B-064 items 4.a and 9.a: the queue calls the guide complete only with the account\'s photo and bio and a WhatsApp', async () => {
  assert.equal((await guides.loadGuideProfileFacts([CLIENT])).get(CLIENT)?.complete, true)
  w.account = { ...ACCOUNT_ROW, photo_key: null }
  assert.equal((await guides.loadGuideProfileFacts([CLIENT])).get(CLIENT)?.complete, false)
  w.account = { ...ACCOUNT_ROW, bio: null }
  assert.equal((await guides.loadGuideProfileFacts([CLIENT])).get(CLIENT)?.complete, false)
  w.account = ACCOUNT_ROW
  w.guideRow = { ...GUIDE_ROW, whatsapp: null }
  assert.equal((await guides.loadGuideProfileFacts([CLIENT])).get(CLIENT)?.complete, false)
  w.guideRow = GUIDE_ROW
  w.owner = null
  assert.equal((await guides.loadGuideProfileFacts([CLIENT])).get(CLIENT)?.complete, false)
})

test('BR-B2B-064 items 6 and 11.a: a ticked guide without photo, bio or WhatsApp is incomplete, out of the app, never "No app"', () => {
  const facts = { hidden: false, consent: true, listedInApp: true, hasMeetingPoint: true, complete: false }
  assert.equal(pipeline.guideVisibilityOf(facts), 'incomplete')
  assert.equal(pipeline.guideVisibilityOf({ ...facts, complete: true }), 'listed')
  // consent, hidden and the point stay above it
  assert.equal(pipeline.guideVisibilityOf({ ...facts, consent: false }), 'no_consent')
  assert.equal(pipeline.guideVisibilityOf({ ...facts, hidden: true }), 'hidden')
  assert.equal(pipeline.guideVisibilityOf({ ...facts, hasMeetingPoint: false }), 'no_meeting_point')
  const state = pipeline.derivePipelineState({
    proposalStatus: 'submitted',
    conference: { documentsSeen: [] } as never,
    clientId: CLIENT,
    gateMissing: [],
    placeCount: 0,
    publishedPlaceCount: 0,
    origin: 'portal',
    portalStatus: 'live',
    partnerKind: 'guide',
    guideProfile: facts,
  })
  assert.equal(state, 'published_unlisted')
})

// ── "Aparece no app" and the bio: each refusal apart ─────────────────────────────────────────

test('BR-B2B-064 items 4.a and 11.a: TGP23 owner and whatsapp reach the tab as their own reason; TGP10 owner is not a status conflict', async () => {
  assert.deepEqual(guides.guideRpcErrorOf('TGP23', 'owner'), { httpStatus: 409, error: 'owner_required' })
  assert.deepEqual(guides.guideRpcErrorOf('TGP23', 'whatsapp'), { httpStatus: 409, error: 'whatsapp_required' })
  assert.deepEqual(guides.guideRpcErrorOf('TGP23', 'photo'), { httpStatus: 409, error: 'photo_required' })
  assert.deepEqual(guides.guideRpcErrorOf('TGP10', 'owner'), { httpStatus: 409, error: 'owner_conflict' })
  assert.deepEqual(guides.guideRpcErrorOf('TGP10', 'in_review'), { httpStatus: 409, error: 'status_conflict' })
  for (const [detail, expected] of [['owner', 'owner_required'], ['whatsapp', 'whatsapp_required']]) {
    const refusing: any = { schema: () => ({ rpc: async () => ({ data: null, error: { code: 'TGP23', details: detail, message: 'x' } }) }) }
    assert.deepEqual(await quiet(() => guides.setGuideListed(refusing, CLIENT, true)), { ok: false, httpStatus: 409, error: expected })
  }
})

test('BR-B2B-064 items 9.a and 11.a: the tab locks the tick without a WhatsApp, names the missing account, and the curator bio edit needs an account', () => {
  const tab = readFileSync(resolve(ROOT, 'components/admin/clients/tabs/GuideProfileTab.tsx'), 'utf8')
  assert.match(tab, /owner_required: 'owner',\s+whatsapp_required: 'whatsapp',/)
  assert.match(tab, /const whatsappMissing = profile\.whatsapp === null \|\| listRefused === 'whatsapp'/)
  assert.match(tab, /const ownerMissing = !profile\.hasAccount \|\| listRefused === 'owner'/)
  assert.match(tab, /complete: !nothingToConfer && !whatsappMissing/)
  assert.match(tab, /<Button variant="outline" disabled=\{!profile\.hasAccount\}/)
  // The name is the authorized one; the record never reads the out-of-use display name.
  assert.match(tab, /const name = profile\.shownName \?\? fallbackName/)
  assert.doesNotMatch(tab, /displayName|photoPath|guide-photos/)
  for (const locale of ['pt', 'en', 'es']) {
    const guide = JSON.parse(readFileSync(resolve(ROOT, `messages/${locale}.json`), 'utf8')).Clients.guide
    for (const key of ['incomplete', 'whatsappLocked', 'ownerLocked']) assert.equal(typeof guide.visibility[key], 'string', `${locale} visibility.${key}`)
    for (const key of ['handle', 'nameNotShown', 'fromAccount', 'noAccount']) assert.equal(typeof guide.data[key], 'string', `${locale} data.${key}`)
  }
})

// ── The publication: the facade becomes the account's photo ──────────────────────────────────

test('BR-B2B-069 item 2.b: an account without a photo gets the facade as profile-photos/<account>/<uuid of the facade>.jpg, a JPEG', async () => {
  w.account = { ...ACCOUNT_ROW, photo_key: null }
  w.guideRow = null
  const out = await guides.copyFacadeToProfilePhoto(SUB, CLIENT, ACCOUNT, `${SUB}/facade/${FACADE_UUID}.jpg`)
  assert.deepEqual(out, { ok: true, copied: true })
  assert.deepEqual(w.storage, [
    `download:place-submission-photos/${SUB}/facade/${FACADE_UUID}.jpg`,
    `upload:profile-photos/${ACCOUNT}/${FACADE_UUID}.jpg`,
  ])
  assert.equal(w.uploadOptions?.contentType, 'image/jpeg')
  assert.equal(w.uploadOptions?.upsert, false)
})

test('BR-B2B-069 item 2.b: the account keeps its own photo, and a republish copies nothing', async () => {
  const kept = await guides.copyFacadeToProfilePhoto(SUB, CLIENT, ACCOUNT, `${SUB}/facade/${FACADE_UUID}.jpg`)
  assert.deepEqual(kept, { ok: true, copied: false })
  w.account = { ...ACCOUNT_ROW, photo_key: null }
  const republish = await guides.copyFacadeToProfilePhoto(SUB, CLIENT, ACCOUNT, `${SUB}/facade/${FACADE_UUID}.jpg`)
  assert.deepEqual(republish, { ok: true, copied: false })
  assert.deepEqual(w.storage, [])
})

test('#1185: a facade that is not a JPEG is refused, never stored as the account\'s .jpg', async () => {
  w.account = { ...ACCOUNT_ROW, photo_key: null }
  w.guideRow = null
  w.facade = PNG
  const out = await guides.copyFacadeToProfilePhoto(SUB, CLIENT, ACCOUNT, `${SUB}/facade/${FACADE_UUID}.png`)
  assert.deepEqual(out, { ok: false, error: 'photo_not_jpeg' })
  assert.ok(!w.storage.some((call) => call.startsWith('upload:')))
})

test('#1185: no account, or a path that is not the submission\'s own facade, never reaches Storage', async () => {
  w.account = { ...ACCOUNT_ROW, photo_key: null }
  w.guideRow = null
  assert.deepEqual(await guides.copyFacadeToProfilePhoto(SUB, CLIENT, null, `${SUB}/facade/${FACADE_UUID}.jpg`), { ok: false, error: 'invalid_photo' })
  assert.deepEqual(await guides.copyFacadeToProfilePhoto(SUB, CLIENT, ACCOUNT, `../${SUB}/facade/${FACADE_UUID}.jpg`), { ok: false, error: 'invalid_photo' })
  assert.equal(guides.facadeProfilePhotoPaths(SUB, 'not-a-uuid', `${SUB}/facade/${FACADE_UUID}.jpg`), null)
  assert.deepEqual(guides.facadeProfilePhotoPaths(SUB, ACCOUNT, `${SUB}/facade/${FACADE_UUID}.webp`), {
    from: `${SUB}/facade/${FACADE_UUID}.webp`,
    to: `${ACCOUNT}/${FACADE_UUID}.jpg`,
  })
  assert.deepEqual(w.storage, [])
})
