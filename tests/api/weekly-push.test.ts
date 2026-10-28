/**
 * #1047: the CMS screen of the weekly push (BR-COMUNICACAO-019 3.m), its three API doors
 * (`/api/admin/weekly-push`, `.../texts`, `.../results`) and the hour select.
 *
 * Pinned here: admin only, no RPC before the gate; the writes call the `drive.cms_set_weekly_push_*`
 * functions on service_role with the documented argument names; a database refusal (TGN01, TGN02,
 * TGN07) comes back as a code and that code resolves to the copy sentence in `messages/pt.json`;
 * the client check of a text mirrors the database; the hour select offers `policy.allowed_hours`
 * and nothing else.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider, createTranslator } from 'next-intl'
import type { NextRequest } from 'next/server'

const OPERATOR_UID = 'cccccccc-2222-4333-8444-555555555555'

type RpcCall = { schema: string; fn: string; args: unknown }
let calls: RpcCall[]
let role: string
let answers: Record<string, { data?: unknown; error?: { code: string; message: string } }>

function client() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {
    auth: { getUser: async () => ({ data: { user: { id: OPERATOR_UID, email: 'admin@tuggi.app' } }, error: null }) },
    schema: (schema: string) => ({
      from: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: 'cms-1', email: 'admin@tuggi.app', role, is_active: true }, error: null }) }
        return q
      },
      rpc: async (fn: string, args?: unknown) => {
        calls.push({ schema, fn, args })
        const a = answers[fn]
        return { data: a?.data ?? null, error: a?.error ?? null }
      },
    }),
  }
  return c
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let settingsRoute: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let textsRoute: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let resultsRoute: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lib: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let page: any

const root = resolve(import.meta.dirname, '../..')
const pt = JSON.parse(readFileSync(resolve(root, 'messages/pt.json'), 'utf8'))
const tPt = createTranslator({ locale: 'pt', messages: pt, namespace: 'Pages.WeeklyPush' })

before(async () => {
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) } })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => client(),
      getSupabaseService: () => client(),
      getSupabase: () => client(),
    },
  })
  settingsRoute = await import('@/app/api/admin/weekly-push/route')
  textsRoute = await import('@/app/api/admin/weekly-push/texts/route')
  resultsRoute = await import('@/app/api/admin/weekly-push/results/route')
  lib = await import('@/lib/notifications/weekly-push')
  page = await import('@/components/admin/weekly-push/WeeklyPushPageContent')
})

beforeEach(() => {
  calls = []
  role = 'admin'
  answers = {}
})

const req = (method: string, body?: unknown, path = '') =>
  new Request(`http://localhost/api/admin/weekly-push${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
const ctx = { params: Promise.resolve({}) }

const TEXT = { piece: 'thursday_local', variant: 'event', language: 'pt', title: 'Evento perto de você', body: '{name}, {city}. Acontece.' }

test('#1047 BR-COMUNICACAO-019 3.m: only an admin reaches the weekly push, and no RPC runs before the gate', async () => {
  for (const r of ['editor', 'viewer', 'client']) {
    role = r
    assert.equal((await settingsRoute.GET(req('GET'), ctx)).status, 403, r)
    assert.equal((await settingsRoute.PATCH(req('PATCH', { piece: 'thursday_local', is_active: false }), ctx)).status, 403, r)
    assert.equal((await textsRoute.PUT(req('PUT', TEXT, '/texts'), ctx)).status, 403, r)
    assert.equal((await resultsRoute.GET(req('GET', undefined, '/results'), ctx)).status, 403, r)
  }
  assert.deepEqual(calls, [])
})

test('#1047 BR-COMUNICACAO-019 3.m: the writes call the drive functions with the documented arguments', async () => {
  assert.equal((await settingsRoute.PATCH(req('PATCH', { piece: 'saturday_local', local_hour: 9 }), ctx)).status, 200)
  assert.equal((await settingsRoute.PATCH(req('PATCH', { piece: 'thursday_local', is_active: false }), ctx)).status, 200)
  assert.equal((await textsRoute.PUT(req('PUT', TEXT, '/texts'), ctx)).status, 200)
  assert.equal((await resultsRoute.GET(req('GET', undefined, '/results'), ctx)).status, 200)
  assert.deepEqual(calls, [
    { schema: 'drive', fn: 'cms_set_weekly_push_piece', args: { p_piece: 'saturday_local', p_is_active: null, p_local_hour: 9 } },
    { schema: 'drive', fn: 'cms_set_weekly_push_piece', args: { p_piece: 'thursday_local', p_is_active: false, p_local_hour: null } },
    { schema: 'drive', fn: 'cms_set_weekly_push_text', args: { p_piece: 'thursday_local', p_variant: 'event', p_language: 'pt', p_title: TEXT.title, p_body: TEXT.body } },
    { schema: 'drive', fn: 'cms_get_weekly_push_results', args: { p_weeks: 12 } },
  ])
})

test('#1047: a malformed body never reaches the database, new_place included', async () => {
  const bad = [
    { piece: 'friday_local', is_active: true },
    { piece: 'thursday_local' },
    { piece: 'thursday_local', local_hour: 9.5 },
    { piece: 'thursday_local', is_active: 'yes' },
  ]
  for (const body of bad) assert.equal((await settingsRoute.PATCH(req('PATCH', body), ctx)).status, 400, JSON.stringify(body))
  assert.equal((await textsRoute.PUT(req('PUT', { ...TEXT, variant: 'new_place' }, '/texts'), ctx)).status, 400)
  assert.equal((await textsRoute.PUT(req('PUT', { ...TEXT, language: 'de' }, '/texts'), ctx)).status, 400)
  assert.deepEqual(calls, [])
})

test('#1047 BR-COMUNICACAO-019 item 5: TGN02 (hour in the quiet hours) comes back as hour_not_allowed and reads as the copy sentence', async () => {
  answers.cms_set_weekly_push_piece = { error: { code: 'TGN02', message: 'cms_set_weekly_push_piece: hour outside the allowed hours' } }
  const res = await settingsRoute.PATCH(req('PATCH', { piece: 'saturday_local', local_hour: 22 }), ctx)
  assert.equal(res.status, 400)
  const { error } = await res.json()
  assert.equal(error.code, 'hour_not_allowed')
  const key = lib.weeklyPushErrorKey(error.code, 'piece')
  assert.equal(key, 'pieces.hour_in_quiet')
  assert.equal(
    tPt(key, { from: 22, until: 8, before_from: 21 }),
    'Essa hora cai no silêncio (22h às 8h) e a peça não sai. Escolha entre 8h e 21h.'
  )
})

test('#1047 BR-COMUNICACAO-019 3.m: TGN01 (piece, variant or language refused) comes back as refused, on both writes, and reads as the reload sentence', async () => {
  answers.cms_set_weekly_push_piece = { error: { code: 'TGN01', message: 'unknown piece' } }
  answers.cms_set_weekly_push_text = { error: { code: 'TGN01', message: 'refused' } }
  const piece = await settingsRoute.PATCH(req('PATCH', { piece: 'thursday_local', is_active: true }), ctx)
  const text = await textsRoute.PUT(req('PUT', TEXT, '/texts'), ctx)
  for (const res of [piece, text]) {
    assert.equal(res.status, 404)
    assert.equal((await res.json()).error.code, 'refused')
  }
  assert.equal(lib.weeklyPushErrorKey('refused', 'piece'), 'messages.refused')
  assert.equal(lib.weeklyPushErrorKey('refused', 'text'), 'messages.refused')
  assert.equal(tPt('messages.refused'), 'O banco não aceita esta peça, variante ou idioma. Recarregue a página.')
})

test('#1047: every TGN code has a message in the three locales, and the literal placeholders survive ICU', () => {
  const codes = ['TGN01', 'TGN02', 'TGN03', 'TGN04', 'TGN05', 'TGN06', 'TGN07', 'TGN08', 'TGN09', 'TGN10']
  for (const locale of ['pt', 'en', 'es']) {
    const messages = JSON.parse(readFileSync(resolve(root, `messages/${locale}.json`), 'utf8'))
    const t = createTranslator({ locale, messages, namespace: 'Pages.WeeklyPush' })
    for (const code of codes) {
      const { code: mapped } = lib.classifyWeeklyPushError({ code })
      assert.notEqual(mapped, 'unknown', code)
      const text = t(lib.weeklyPushErrorKey(mapped, 'text'), { max: 40, placeholder: '{foo}', from: 22, until: 8, before_from: 21 })
      assert.ok(!text.startsWith('Pages.'), `${locale} ${code}`)
    }
  }
  assert.equal(tPt('texts.errors.city_required'), 'Esta variante precisa de {city} no título ou no corpo.')
  assert.equal(tPt('texts.errors.unknown_placeholder', { placeholder: '{cidade}' }), 'Só {name} e {city} são preenchidos. Tire {cidade}.')
})

test('#1047 BR-COMUNICACAO-019 3.m: the client check mirrors the database (city rule, name in body, 40 and 110 without placeholders)', () => {
  const codes = (variant: string, title: string, body: string) =>
    lib.validateWeeklyPushText(variant, title, body).map((p: { code: string }) => p.code)
  assert.deepEqual(codes('event', 'Evento perto de você', '{name}, {city}. Acontece.'), [])
  assert.deepEqual(codes('reminder_no_city', 'Fim de semana', 'Saia com o Tuggi em {city}.'), ['city_forbidden'])
  assert.deepEqual(codes('route', 'Rota perto', '{name}. Histórias pelo caminho.'), ['city_required'])
  assert.deepEqual(codes('event', 'Evento', '{city}. Sem nome.'), ['name_required'])
  assert.deepEqual(codes('reminder_city', '{name} em {city}', 'Volta pela cidade.'), ['name_in_title'])
  assert.deepEqual(codes('reminder_city', '{city}', 'Volta.'), ['title_required'])
  assert.deepEqual(codes('reminder_city', '{city} {cidade}', 'Volta.'), ['unknown_placeholder'])
  assert.deepEqual(codes('reminder_city', `{city} ${'a'.repeat(39)}`, 'Volta.'), [])
  assert.deepEqual(codes('reminder_city', `{city} ${'a'.repeat(40)}`, 'Volta.'), ['title_too_long'])
  assert.deepEqual(codes('event', 'Evento', `{name}, {city}. ${'a'.repeat(106)}`), [])
  assert.deepEqual(codes('event', 'Evento', `{name}, {city}. ${'a'.repeat(107)}`), ['body_too_long'])
})

test('#1047 BR-COMUNICACAO-019 item 5: the hour select offers policy.allowed_hours, and only them', () => {
  const allowed = [9, 10, 13]
  const html = renderToStaticMarkup(
    // eslint-disable-next-line react/no-children-prop
    createElement(NextIntlClientProvider, {
      locale: 'pt',
      messages: pt,
      timeZone: 'UTC',
      children: createElement(page.PieceCard, {
        row: { piece: 'saturday_local', push_kind: 'weekly_saturday_local', local_dow: 6, local_hour: 10, is_active: true, updated_at: null, last_sent_local_date: null },
        policy: { week_cap: 2, quiet_from_hour: 22, quiet_until_hour: 8, allowed_hours: allowed },
        dateFormat: new Intl.DateTimeFormat('pt', { dateStyle: 'short' }),
        onSaved: () => {},
      }),
    })
  )
  const values = [...html.matchAll(/<option[^>]*value="(\d+)"/g)].map((m) => Number(m[1]))
  assert.deepEqual(values, allowed)
  assert.match(html, /Sábado, 10h local/)
  assert.doesNotMatch(html, /new_place/)
})
