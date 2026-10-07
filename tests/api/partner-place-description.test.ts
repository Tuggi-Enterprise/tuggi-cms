/**
 * #888 — the place born from a partner's registration carries the description of its tier.
 *
 * The REAL `applyPartnerPlaceDescription` / `describeDescriptionPolicy` run; only the database is
 * faked (`setup/fake-description-db.ts`), and every case asserts what was left in the stored row,
 * not which function was called. Nothing here touches a real database.
 *
 * Rules: BR-B2B-016 (free tier = the name; paid tier = the story; never write over a description),
 * BR-B2B-018 (text only on creation — nothing on air, no audio), BR-B2B-025 (Tuggi narrates what
 * the establishment asserts; the text is the partner's, trimmed, not rewritten).
 *
 * Run with: npm run test:api
 */

import { test, before, mock } from 'node:test'
import assert from 'node:assert/strict'

import { describeDescriptionPolicy } from '@/lib/partnerships/place-description-policy'
import { createDescriptionOperator, freshDescWorld, type DescWorld } from './setup/fake-description-db'

const POI = '22222222-2222-4222-8222-222222222222'
const STORY = 'Meu avô Aurélio abriu a cantina em 1962, no galpão do antigo mercado de peixe.'

let svc: typeof import('@/lib/services/place-description-policy-service')

before(async () => {
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseService: () => ({ auth: { admin: { getUserById: async () => ({ data: null, error: null }) } } }),
    },
  })
  svc = await import('@/lib/services/place-description-policy-service')
})

const run = (w: DescWorld, story: string | null, acceptedPlanChoice: 'map_and_description' | 'map_only' | null) =>
  svc.applyPartnerPlaceDescription(POI, { story, acceptedPlanChoice }, createDescriptionOperator(w))

// ── 1 · paid on the portal ───────────────────────────────────────────────────────────────────

test('BR-B2B-016 item 1 · BR-B2B-025 · BR-B2B-018 · portal paid tier: the description is the trimmed story, pt-br/male, no audio', async () => {
  const w = freshDescWorld()
  const out = await run(w, `  ${STORY}\n`, 'map_and_description')
  assert.equal(out, 'written')
  assert.equal(w.row?.description, STORY, 'trimmed, not rewritten')
  assert.deepEqual(w.row?.generation_meta, { kind: 'partner_story_script' })
  assert.equal(w.row?.audio_url, null, 'text only: nothing is voiced or queued here')
  assert.equal(w.row?.language, 'pt-br')
  assert.equal(w.row?.gender, 'male')
  assert.equal(w.rpcs.some((r) => r.name === 'cms_apply_name_only_description'), false)
})

// ── 2 · free ─────────────────────────────────────────────────────────────────────────────────

test('BR-B2B-016 item 9 · BR-B2B-018 · portal free tier (map_only): the description is the name, by the RPC', async () => {
  const w = freshDescWorld()
  const out = await run(w, STORY, 'map_only')
  assert.equal(out, 'written')
  assert.equal(w.row?.description, 'Bar do Zé')
  assert.deepEqual(w.row?.generation_meta, { kind: 'partner_name_only' })
  assert.equal(w.row?.audio_url, null)
  assert.equal(w.rpcs.filter((r) => r.name === 'cms_apply_name_only_description').length, 1)
  assert.equal(w.writes.length, 0, 'the story is NOT written on the free tier')
})

// ── 3 · idempotent ───────────────────────────────────────────────────────────────────────────

test('BR-B2B-016 5th edge case · paid: running twice answers unchanged and leaves one row', async () => {
  const w = freshDescWorld()
  assert.equal(await run(w, STORY, 'map_and_description'), 'written')
  const after1 = JSON.stringify(w.row)
  const writes1 = w.writes.length
  assert.equal(await run(w, STORY, 'map_and_description'), 'unchanged')
  assert.equal(JSON.stringify(w.row), after1)
  assert.equal(w.writes.length, writes1, 'the second run writes nothing')
})

test('BR-B2B-016 5th edge case · free: running twice answers unchanged', async () => {
  const w = freshDescWorld()
  assert.equal(await run(w, null, 'map_only'), 'written')
  assert.equal(await run(w, null, 'map_only'), 'unchanged')
})

// ── 4 · operator edit survives ───────────────────────────────────────────────────────────────

test("BR-B2B-016 5th edge case · the operator's edit after the first run: the retry is blocked and the edit stays", async () => {
  const w = freshDescWorld()
  await run(w, STORY, 'map_and_description')
  w.row = { description: 'Texto editado pelo curador.', audio_url: null, generation_meta: { kind: 'operator_edit' } }
  const out = await run(w, STORY, 'map_and_description')
  assert.equal(out, 'blocked')
  assert.equal(w.row?.description, 'Texto editado pelo curador.')
  assert.deepEqual(w.row?.generation_meta, { kind: 'operator_edit' })
})

test("BR-B2B-016 5th edge case · the operator's edit of a free place's name row: blocked, kept", async () => {
  const w = freshDescWorld()
  await run(w, null, 'map_only')
  w.row = { description: 'Bar do Zé, desde 1962.', audio_url: null, generation_meta: { kind: 'operator_edit' } }
  assert.equal(await run(w, null, 'map_only'), 'blocked')
  assert.equal(w.row?.description, 'Bar do Zé, desde 1962.')
})

// ── 5 · name row replaced by the story ───────────────────────────────────────────────────────

test('BR-B2B-016 item 1 · a name-only row already written on a paid place is replaced by the story', async () => {
  const w = freshDescWorld({
    row: { description: 'Bar do Zé', audio_url: null, generation_meta: { kind: 'partner_name_only' } },
  })
  const out = await run(w, STORY, 'map_and_description')
  assert.equal(out, 'written')
  assert.equal(w.row?.description, STORY)
  assert.deepEqual(w.row?.generation_meta, { kind: 'partner_story_script' })
})

// ── 6 · never over a catalogue / processing row ──────────────────────────────────────────────

test('BR-B2B-016 5th edge case · a `[PROCESSING]` row is never overwritten: blocked', async () => {
  const w = freshDescWorld({
    row: { description: '[PROCESSING]', audio_url: null, generation_meta: { kind: 'tts_generation' } },
  })
  const out = await run(w, STORY, 'map_and_description')
  assert.equal(out, 'blocked')
  assert.equal(w.row?.description, '[PROCESSING]')
})

test('BR-B2B-016 5th edge case · a catalogue description (with audio) is never overwritten: blocked', async () => {
  const w = freshDescWorld({
    row: { description: 'Descrição do catálogo.', audio_url: 'https://x/a.mp3', generation_meta: { kind: 'generated' } },
  })
  const out = await run(w, STORY, 'map_and_description')
  assert.equal(out, 'blocked')
  assert.equal(w.row?.description, 'Descrição do catálogo.')
  assert.equal(w.row?.audio_url, 'https://x/a.mp3')
})

test('BR-B2B-016 5th edge case · a row with no generation_meta at all is not a name row: blocked', async () => {
  const w = freshDescWorld({ row: { description: 'Legado.', audio_url: null, generation_meta: null } })
  assert.equal(await run(w, STORY, 'map_and_description'), 'blocked')
  assert.equal(w.row?.description, 'Legado.')
})

// ── 7 · paid without story ───────────────────────────────────────────────────────────────────

test('BR-B2B-011 gate 2 · BR-B2B-025 · paid without story_script: no_story, nothing written, nothing invented', async () => {
  for (const story of [null, '', '   \n ']) {
    const w = freshDescWorld()
    assert.equal(await run(w, story, 'map_and_description'), 'no_story')
    assert.equal(w.row, null)
    assert.equal(w.writes.length, 0)
    assert.equal(w.rpcs.some((r) => r.name === 'cms_apply_name_only_description'), false, 'not even the name')
  }
})

// ── 8 · operator exception on a free place ───────────────────────────────────────────────────

test("BR-B2B-016 item 1 · the operator's exception on a free place writes the story_script when there is one", async () => {
  const w = freshDescWorld({ exceptionAt: '2026-10-01T10:00:00Z' })
  assert.equal(await run(w, STORY, 'map_only'), 'written')
  assert.equal(w.row?.description, STORY)
  assert.deepEqual(w.row?.generation_meta, { kind: 'partner_story_script' })
})

test("BR-B2B-016 item 1 · the exception without a story_script: no_story, nothing written", async () => {
  const w = freshDescWorld({ exceptionAt: '2026-10-01T10:00:00Z' })
  assert.equal(await run(w, null, null), 'no_story')
  assert.equal(w.row, null)
})

// ── scope guards ─────────────────────────────────────────────────────────────────────────────

test('BR-B2B-016 · a place with no partner behind it (catalogue POI) gets nothing from this entry point', async () => {
  const w = freshDescWorld({ partnerClientId: null })
  assert.equal(await run(w, STORY, 'map_and_description'), 'not_applicable')
  assert.equal(w.row, null)
  assert.equal(w.writes.length, 0)
})

test('a place the caller cannot see (facts RPC answers no row) is not_applicable', async () => {
  const w = freshDescWorld()
  const op: any = { schema: () => ({ rpc: async () => ({ data: [], error: null }) }) }
  assert.equal(await svc.applyPartnerPlaceDescription(POI, { story: STORY, acceptedPlanChoice: null }, op), 'not_applicable')
  assert.equal(w.writes.length, 0)
})

test('BR-B2B-016 · a fee on the client record is still the paid tier, without the portal fact', async () => {
  const w = freshDescWorld({ monthlyFeeCents: 29900, contractTier: 'paid' })
  assert.equal(await run(w, STORY, null), 'written')
  assert.equal(w.row?.description, STORY)
})

// ── 10 · failures ────────────────────────────────────────────────────────────────────────────

test('#888 failures · the name-only RPC erroring throws (never swallowed into "written")', async () => {
  const w = freshDescWorld({ failAt: 'name_only' })
  await assert.rejects(run(w, null, 'map_only'), /rpc failed/)
  assert.equal(w.row, null)
})

test('#888 failures · the insert erroring throws', async () => {
  const w = freshDescWorld({ failAt: 'upsert' })
  await assert.rejects(run(w, STORY, 'map_and_description'), /upsert failed/)
  assert.equal(w.row, null)
})

test('#888 failures · the conditional update erroring throws, and the existing row is untouched', async () => {
  const w = freshDescWorld({
    failAt: 'update',
    row: { description: 'Bar do Zé', audio_url: null, generation_meta: { kind: 'partner_name_only' } },
  })
  await assert.rejects(run(w, STORY, 'map_and_description'), /update failed/)
  assert.equal(w.row?.description, 'Bar do Zé')
})

test('#888 failures · the facts read erroring throws: a failed read is never "does not pay"', async () => {
  const w = freshDescWorld({ failAt: 'facts' })
  await assert.rejects(run(w, STORY, 'map_and_description'), /facts failed/)
  assert.equal(w.writes.length, 0)
})

// ── 11 · the pure rule ───────────────────────────────────────────────────────────────────────

const partner = { partnerClientId: 'c1', plan: null, exception: null } as const

test('BR-B2B-016 item 1 · describeDescriptionPolicy: map_and_description accepted on the portal is the paid tier', () => {
  const d = describeDescriptionPolicy({ ...partner, acceptedPlanChoice: 'map_and_description' })
  assert.equal(d.policy, 'partner_story')
  assert.equal(d.reason, 'paid_tier')
  assert.equal(d.mayException, false)
})

test('BR-B2B-016 item 1 · describeDescriptionPolicy: map_only, null and absent read exactly as before (name only)', () => {
  for (const facts of [
    { ...partner, acceptedPlanChoice: 'map_only' as const },
    { ...partner, acceptedPlanChoice: null },
    { ...partner },
  ]) {
    const d = describeDescriptionPolicy(facts)
    assert.equal(d.policy, 'name_only')
    assert.equal(d.reason, 'free_tier')
  }
})

test('BR-B2B-016 · describeDescriptionPolicy: the portal fact never reaches a place with no partner', () => {
  const d = describeDescriptionPolicy({ partnerClientId: null, plan: null, exception: null, acceptedPlanChoice: 'map_and_description' })
  assert.equal(d.policy, 'curation')
  assert.equal(d.reason, 'not_a_partner')
})

test("BR-B2B-016 item 1 · describeDescriptionPolicy: the exception still lifts a map_only place, and the portal's paid tier wins over it", () => {
  const exception = { at: '2026-10-01T10:00:00Z', by: null, reason: 'x' }
  assert.equal(describeDescriptionPolicy({ ...partner, exception, acceptedPlanChoice: 'map_only' }).reason, 'operator_exception')
  assert.equal(describeDescriptionPolicy({ ...partner, exception, acceptedPlanChoice: 'map_and_description' }).reason, 'paid_tier')
})
