/**
 * #138 — `supabase/functions/_shared/venueComposition.ts`, the three decisions that
 * make the composed narration of BR-EVENTO-002 possible inside
 * `generate-description`.
 *
 * The module is Deno source (`.ts` specifiers), so it is loaded through a path built
 * at run time — a static import would end in `.ts` and fail `npm run type-check` for
 * the whole repo. It is pure, so no `Deno` global is needed here.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface VenueDescriptionRow {
  language?: string | null
  name?: string | null
  description?: string | null
}

interface VenueCompositionModule {
  linkedVenueId: (
    entityKind: unknown,
    eventDetails: { venue_attraction_id?: string | null } | null | undefined
  ) => string | null
  resolveVenueContext: (
    canonicalName: string,
    language: string,
    rows: VenueDescriptionRow[]
  ) => { name: string; facts: string | null; factsLanguage: string | null }
  venueCompositionMeta: (
    venueId: string,
    factsLanguage: string | null,
    composed: boolean
  ) => Record<string, unknown>
  isComposedWithVenue: (generationMeta: unknown, venueId: string) => boolean
  VENUE_META_KEY: string
}

const MODULE_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/_shared/venueComposition.ts'
)

// Loaded in `before` and not at the top level: the runner transpiles this file to
// CJS, where top-level await is a build error.
let mod: VenueCompositionModule

before(async () => {
  mod = await import(pathToFileURL(MODULE_PATH).href)
})

const CHURCH = '81ca65b4-9d5b-4c2a-8d43-37c9c4ec5f89'
const OTHER_VENUE = '00000000-0000-0000-0000-0000000000ff'

// ── 1. The gate: who is a linked event, and who must not change at all ────────

test('BR-EVENTO-002: an event carrying venue_attraction_id is a linked event', () => {
  assert.equal(mod.linkedVenueId('event', { venue_attraction_id: CHURCH }), CHURCH)
})

test('BR-EVENTO-002: the autonomous event narrates on its own and is not composed', () => {
  // "Não se aplica a: evento autônomo, que narra por conta própria."
  assert.equal(mod.linkedVenueId('event', { venue_attraction_id: null }), null)
  assert.equal(mod.linkedVenueId('event', {}), null)
  assert.equal(mod.linkedVenueId('event', null), null)
  assert.equal(mod.linkedVenueId('event', undefined), null)
})

test('BR-EVENTO-002: a POI or a place is never composed, even carrying a link', () => {
  // core.attractions holds POI, event and place in one table; a stray link on a
  // non-event must not turn its narration into someone else's.
  assert.equal(mod.linkedVenueId('poi', { venue_attraction_id: CHURCH }), null)
  assert.equal(mod.linkedVenueId('place', { venue_attraction_id: CHURCH }), null)
  assert.equal(mod.linkedVenueId(undefined, { venue_attraction_id: CHURCH }), null)
})

// ── 2. Host name and host facts, per language (BR-CONTEUDO-001) ───────────────

test('BR-CONTEUDO-001: the host name comes in the listener language when it exists', () => {
  const ctx = mod.resolveVenueContext('Igreja Matriz da Nossa Senhora da Assunção', 'en-us', [
    { language: 'pt-br', name: 'Igreja Matriz de Nossa Senhora da Assunção', description: 'Esta igreja colonial…' },
    { language: 'en-us', name: 'Mother Church of Our Lady of the Assumption', description: 'This colonial church…' },
  ])
  assert.equal(ctx.name, 'Mother Church of Our Lady of the Assumption')
  assert.equal(ctx.facts, 'This colonial church…')
  assert.equal(ctx.factsLanguage, 'en-us')
})

test('BR-CONTEUDO-001: a same-base-language name is accepted (pt-pt serves pt-br)', () => {
  const ctx = mod.resolveVenueContext('Igreja Matriz', 'pt-br', [
    { language: 'pt-pt', name: 'Igreja Matriz da Assunção', description: 'A igreja…' },
  ])
  assert.equal(ctx.name, 'Igreja Matriz da Assunção')
})

test('BR-CONTEUDO-001: a name in an unrelated language is never delivered', () => {
  // Silêncio é preferível a idioma errado: opening a ja-JP narration with an
  // en-us name is the wrong language; the canonical local proper noun is not.
  const ctx = mod.resolveVenueContext('Igreja Matriz', 'ja-JP', [
    { language: 'en-us', name: 'Mother Church', description: 'This colonial church…' },
  ])
  assert.equal(ctx.name, 'Igreja Matriz')
  // Facts are INPUT to the generator, never delivered text — any language serves.
  assert.equal(ctx.facts, 'This colonial church…')
  assert.equal(ctx.factsLanguage, 'en-us')
})

test('BR-CONTEUDO-001: facts fall back exact → base → en → any', () => {
  const rows: VenueDescriptionRow[] = [
    { language: 'de-de', description: 'Die Kirche…' },
    { language: 'en-us', description: 'This church…' },
    { language: 'pt-pt', description: 'A igreja…' },
    { language: 'pt-br', description: 'Esta igreja…' },
  ]
  assert.equal(mod.resolveVenueContext('X', 'pt-br', rows).factsLanguage, 'pt-br')
  assert.equal(mod.resolveVenueContext('X', 'pt-ao', rows).factsLanguage, 'pt-pt')
  assert.equal(mod.resolveVenueContext('X', 'fr-fr', rows).factsLanguage, 'en-us')
  assert.equal(
    mod.resolveVenueContext('X', 'fr-fr', [{ language: 'de-de', description: 'Die Kirche…' }])
      .factsLanguage,
    'de-de'
  )
})

test('BR-CONTEUDO-002: a host with no description in any language still composes, by name', () => {
  // "POI de área sem descrição recebe conteúdo gerado como qualquer outro" — the
  // host is not blocked and is not written to from here; the narration grounds the
  // listener by NAME, which is what BR-EVENTO-002 item 2 requires.
  const ctx = mod.resolveVenueContext('Igreja Matriz da Nossa Senhora da Assunção', 'pt-br', [])
  assert.equal(ctx.name, 'Igreja Matriz da Nossa Senhora da Assunção')
  assert.equal(ctx.facts, null)
  assert.equal(ctx.factsLanguage, null)
})

test('BR-CONTEUDO-001: a host row locked or half-written does not become the name', () => {
  const ctx = mod.resolveVenueContext('Igreja Matriz', 'pt-br', [
    { language: 'pt-br', name: null, description: null },
    { language: 'pt-br', name: '', description: 'Esta igreja…' },
  ])
  assert.equal(ctx.name, 'Igreja Matriz')
  assert.equal(ctx.facts, 'Esta igreja…')
})

test('the listener language may be missing entirely without throwing', () => {
  const ctx = mod.resolveVenueContext('Igreja Matriz', '', [
    { language: 'pt-br', name: 'Igreja Matriz da Assunção', description: 'Esta igreja…' },
  ])
  assert.equal(ctx.name, 'Igreja Matriz')
  assert.equal(ctx.facts, 'Esta igreja…')
})

// ── 3. The mark that proves item 2 held (BR-EVENTO-002) ───────────────────────

test('BR-EVENTO-002 item 2: the mark written is the mark read', () => {
  const meta = mod.venueCompositionMeta(CHURCH, 'pt-br', true)
  assert.equal(mod.isComposedWithVenue(meta, CHURCH), true)
  assert.equal(meta.venue_facts_language, 'pt-br')
  assert.equal(meta.venue_composed, true)
})

test('BR-EVENTO-002 item 2: a dangling link is still marked, or it regenerates forever', () => {
  const meta = mod.venueCompositionMeta(CHURCH, null, false)
  assert.equal(mod.isComposedWithVenue(meta, CHURCH), true)
  assert.equal(meta.venue_composed, false)
})

test('BR-EVENTO-002 item 2: a description composed before the link answers false', () => {
  // The real shape read from production on 2026-08-08 for the pt-br Festa da
  // Padroeira: composed by hand, outside this path, with no venue mark.
  const preLink = {
    kind: 'master_2step',
    models: 'retrieve:gemini-2.5-flash compose:gemini-2.5-flash',
    sources: 8,
    grounded: true,
    safe_mode: false,
  }
  assert.equal(mod.isComposedWithVenue(preLink, CHURCH), false)
})

test('BR-EVENTO-002 item 2: a translation of an uncomposed source answers false', () => {
  const translated = { kind: 'translation', grounded: null, source_language: 'pt-br' }
  assert.equal(mod.isComposedWithVenue(translated, CHURCH), false)
})

test('BR-EVENTO-002 item 2: composed with ANOTHER host answers false', () => {
  const meta = mod.venueCompositionMeta(OTHER_VENUE, 'pt-br', true)
  assert.equal(mod.isComposedWithVenue(meta, CHURCH), false)
})

test('BR-EVENTO-002 item 2: an absent or unreadable trail fails closed', () => {
  for (const value of [null, undefined, '', 'venue_attraction_id', 42, []]) {
    assert.equal(mod.isComposedWithVenue(value, CHURCH), false)
  }
})
