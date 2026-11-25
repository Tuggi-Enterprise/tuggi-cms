/**
 * #1261: the partner's place suggestions and the partner author in the route review, in real
 * Chromium with the real Tailwind. The CMS routes are `page.route` fixtures; nothing reaches a
 * database.
 *
 * Pinned: each suggestion shows what the partner sent beside the POIs around the pin, and "Ligar a
 * este" sends `link` with that POI; "Criar o ponto" sends the fields with the partner's name already
 * filled; a refusal without a reason never leaves the browser, and one with a reason travels as
 * written (BR-B2B-073 item 3.b); only one form shows at a time and switching keeps the text; TGB86
 * reads as the sentence and the queue reloads; the Marca tab reads only its partner; the route review
 * shows the badge "Parceiro" in the queue and in the header, with the link to the record, and the
 * "Contado por" line before "Virar POI" (item 7.b and 8).
 * Set CT_SHOTS=<folder> to also write the 390 and 1440 px captures.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Locator, Page, Route } from '@playwright/test'
import { BrandTabHost, PartnerBrandPageHost, RouteReviewHost } from './partner-suggestions-1261-helpers'

const CLIENT_ID = 'cccccccc-1111-4222-8333-444444444444'
const OTHER_CLIENT = 'dddddddd-1111-4222-8333-444444444444'
const S1 = 'aaaaaaaa-1111-4222-8333-444444444444'
const S2 = 'bbbbbbbb-1111-4222-8333-444444444444'
const POI = 'eeeeeeee-1111-4222-8333-444444444444'

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

const nearby = [
  { id: POI, name: 'Quiosque do Tonho (rascunho antigo)', city: 'Cabo Frio', country: 'Brasil', category: 'restaurant', approved: false, distance_m: 40 },
  { id: 'eeeeeeee-2222-4222-8333-444444444444', name: 'Praia do Forte', city: 'Cabo Frio', country: 'Brasil', category: 'beach', approved: true, distance_m: 220 },
]

const suggestion = (id: string, clientId: string, partner: string, name: string, note: string | null) => ({
  id,
  client_id: clientId,
  partner_handle: null,
  partner_name: partner,
  client_type: 'hotel',
  name,
  latitude: -22.8806,
  longitude: -42.0187,
  note,
  status: 'pending',
  created_at: '2026-11-22T13:14:00Z',
  picks_count: 3,
  pending_count: 1,
  nearby,
})

async function stubBrand(page: Page) {
  await page.route('**/api/admin/partner-brand/logos', (r) => json(r, { logos: [] }))
  await page.route('**/api/admin/partner-brand/settings', (r) => json(r, { term_days: 30, switches: [], packages: [] }))
  await page.route(`**/api/admin/clients/${OTHER_CLIENT}/brand`, (r) =>
    json(r, {
      brand: {
        client_id: OTHER_CLIENT, logo_path: null, logo_status: null, logo_submitted_at: null, logo_decided_at: null,
        logo_rejection_reason: null, logo_url: null, approved_logo_path: null, approved_logo_url: null,
        pilot_starts_at: null, pilot_ends_at: null, gift_days: null,
      },
    }),
  )
}

async function stubSuggestions(page: Page, opts: { decision?: (r: Route) => Promise<void> } = {}) {
  const posted: Record<string, unknown>[] = []
  const reads: string[] = []
  await page.route('**/api/admin/partner-brand/suggestions**', (r) => {
    if (r.request().method() === 'POST') {
      posted.push(r.request().postDataJSON())
      return opts.decision ? opts.decision(r) : json(r, { decision: { status: 'linked' }, attraction_id: null })
    }
    const url = new URL(r.request().url())
    reads.push(url.search)
    const all = [
      suggestion(S1, CLIENT_ID, 'Hotel Mar Azul', 'Quiosque do Tonho', 'Barraca de praia com peixe frito, parceira nossa há dez anos.'),
      suggestion(S2, OTHER_CLIENT, 'Pousada Canto do Mar', 'Bar da Laje', 'Música ao vivo às sextas.'),
    ]
    const only = url.searchParams.get('client_id')
    return json(r, { suggestions: only ? all.filter((s) => s.client_id === only) : all })
  })
  return { posted, reads }
}

async function shoot(page: Page, name: string) {
  const dir = process.env.CT_SHOTS
  if (!dir) return
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.screenshot({ path: `${dir}/${name}-${width}.png`, fullPage: true })
  }
}

const card = (c: Locator, id: string) => c.locator(`[data-suggestion="${id}"]`)

test('#1261 BR-B2B-073 item 3.b: each suggestion shows what the partner sent beside the POIs near the pin, and links to one', async ({ mount, page }) => {
  await stubBrand(page)
  const s = await stubSuggestions(page)
  const c = await mount(<PartnerBrandPageHost />)
  await expect(c.getByRole('heading', { name: 'Sugestões de local' })).toBeVisible()
  const first = card(c, S1)
  await expect(first.getByRole('link', { name: 'Hotel Mar Azul' })).toHaveAttribute('href', `/admin/clients?clientId=${CLIENT_ID}&tab=brand`)
  await expect(first.getByText('Quiosque do Tonho', { exact: true })).toBeVisible()
  await expect(first.getByText('restaurant · 40 m do pino · não aprovado')).toBeVisible()

  // The two forms open on the cards for the capture: create on the first, refuse on the second.
  await first.getByRole('button', { name: 'Criar o ponto' }).click()
  await card(c, S2).getByRole('button', { name: 'Recusar', exact: true }).click()
  await card(c, S2).getByLabel(/Motivo da recusa/).fill('Fechado desde outubro, segundo a prefeitura.')
  await shoot(page, 'c01-suggestions')

  await first.getByRole('button', { name: 'Ligar a Praia do Forte' }).click()
  await expect.poll(() => s.posted.length).toBe(1)
  expect(s.posted[0]).toEqual({ suggestion_id: S1, decision: 'link', attraction_id: 'eeeeeeee-2222-4222-8333-444444444444' })
  await expect(c.getByRole('status')).toHaveText('Sugestão ligada ao ponto. Ele entra no fim da lista do parceiro.')
  await expect(card(c, S1)).toHaveCount(0)
})

test('#1261 BR-B2B-073 item 3.b: "Criar o ponto" sends the fields with the name the partner sent', async ({ mount, page }) => {
  await stubBrand(page)
  const s = await stubSuggestions(page, { decision: (r) => json(r, { decision: { status: 'created' }, attraction_id: POI }) })
  const c = await mount(<PartnerBrandPageHost />)
  const first = card(c, S1)
  await first.getByRole('button', { name: 'Criar o ponto' }).click()
  await expect(first.getByLabel('Nome')).toHaveValue('Quiosque do Tonho')
  await expect(first.getByLabel('Cidade')).toHaveValue('Cabo Frio')
  await first.getByLabel('Estado').fill('RJ')
  await first.getByRole('button', { name: 'Criar POI em revisão' }).click()
  await expect.poll(() => s.posted.length).toBe(1)
  expect(s.posted[0]).toEqual({
    suggestion_id: S1,
    decision: 'created',
    poi: { name: 'Quiosque do Tonho', description: 'Barraca de praia com peixe frito, parceira nossa há dez anos.', city: 'Cabo Frio', country: 'Brasil', state: 'RJ' },
  })
  await expect(c.getByRole('status')).toContainText('Ponto criado em revisão')
})

test('#1261 BR-B2B-073 item 3.b: a refusal without a reason never leaves the browser; with one it travels as written; switching forms keeps it', async ({ mount, page }) => {
  await stubBrand(page)
  const s = await stubSuggestions(page)
  const c = await mount(<PartnerBrandPageHost />)
  const first = card(c, S1)
  await first.getByRole('button', { name: 'Recusar', exact: true }).click()
  await expect(first.getByRole('button', { name: 'Recusar sugestão' })).toBeDisabled()
  await first.getByLabel(/Motivo da recusa/).focus()
  await first.getByLabel(/Motivo da recusa/).blur()
  await expect(first.getByText('Escreva o motivo: o parceiro lê no portal.')).toBeVisible()
  expect(s.posted).toHaveLength(0)

  await first.getByLabel(/Motivo da recusa/).fill('  Fechado desde outubro.')
  await first.getByRole('button', { name: 'Criar o ponto' }).click()
  await expect(first.getByLabel(/Motivo da recusa/)).toBeHidden()
  await first.getByRole('button', { name: 'Recusar', exact: true }).click()
  await expect(first.getByLabel(/Motivo da recusa/)).toHaveValue('  Fechado desde outubro.')
  await first.getByRole('button', { name: 'Recusar sugestão' }).click()
  await expect.poll(() => s.posted.length).toBe(1)
  expect(s.posted[0]).toEqual({ suggestion_id: S1, decision: 'refuse', reason: '  Fechado desde outubro.' })
})

test('#1261: TGB86 (answered or cancelled meanwhile) reads as the sentence and the queue reloads', async ({ mount, page }) => {
  await stubBrand(page)
  const s = await stubSuggestions(page, { decision: (r) => json(r, { error: { code: 'suggestion_not_pending' } }, 409) })
  const c = await mount(<PartnerBrandPageHost />)
  await expect(card(c, S1)).toBeVisible()
  const before = s.reads.length
  await card(c, S1).getByRole('button', { name: 'Ligar a Praia do Forte' }).click()
  await expect(c.getByRole('alert')).toContainText('Esta sugestão não espera mais resposta')
  await expect.poll(() => s.reads.length).toBeGreaterThan(before)
})

test('#1261: the Marca tab of the record reads only the suggestions of its partner', async ({ mount, page }) => {
  await stubBrand(page)
  const s = await stubSuggestions(page)
  const c = await mount(<BrandTabHost clientId={OTHER_CLIENT} />)
  await expect(card(c, S2)).toBeVisible()
  await expect(card(c, S1)).toHaveCount(0)
  expect(s.reads).toContain(`?client_id=${OTHER_CLIENT}`)
  await shoot(page, 'c01-brand-tab')
})

// ─── Route review ────────────────────────────────────────────────────────────────────────────

const ANNOTATION = '44444444-5555-4666-8777-888888888888'

async function stubReview(page: Page) {
  await page.route('**/maps.googleapis.com/**', (r) => r.abort())
  await page.route('**/api/route-revisions', (r) =>
    json(r, {
      items: [
        { revision_id: 'r1', route_id: 'x1', revision_no: 1, submitted_at: '2026-11-23T10:00:00Z', route_status: 'pending_review', slug: null, author_user_id: 'owner-1', author_nickname: 'hotel-mar-azul', name: 'Cabo Frio em um dia', live_revision_id: null, live_revision_no: null, filter_flag_reason: null, report_count: 0, author_partner: { client_id: CLIENT_ID, name: 'Hotel Mar Azul', handle: 'hotel-mar-azul' } },
        { revision_id: 'r2', route_id: 'x2', revision_no: 2, submitted_at: '2026-11-23T11:00:00Z', route_status: 'active', slug: 'praias', author_user_id: 'tourist', author_nickname: 'ana.viaja', name: 'Praias de Arraial', live_revision_id: 'l2', live_revision_no: 1, filter_flag_reason: null, report_count: 0, author_partner: null },
      ],
    }),
  )
  await page.route('**/api/route-revisions/r1', (r) =>
    json(r, {
      revision: {
        id: 'r1', route_id: 'x1', revision_no: 1, state: 'pending', name: 'Cabo Frio em um dia',
        description: 'Do café na Praia do Forte ao pôr do sol no Canal do Itajuru, com quatro paradas a pé.',
        visibility: 'public', cover_photo_key: null, uncovered_segments: [], filter_flag_reason: null, submitted_at: '2026-11-23T10:00:00Z',
        stops: [{ kind: 'annotation', ref: ANNOTATION, title: 'Quiosque do Tonho', description: 'Peixe frito na areia.', lat: null, lng: null, at: null, photo_keys: [] }],
      },
      live: null,
      route: { id: 'x1', slug: null, status: 'pending_review', live_revision_id: null },
      line: [],
      liveLine: [],
      diff: { first: true, fields: [], stops: [], lineChanged: false },
      photoUrls: {},
      nearby: { [ANNOTATION]: [] },
      promoted: {},
    }),
  )
  await page.route('**/api/route-revisions/r1/photo-check', (r) => json(r, { photos: [] }))
}

test('#1261 BR-B2B-073 item 7.b: the route review shows the partner badge in the queue and the header, and the "Contado por" line', async ({ mount, page }) => {
  await stubReview(page)
  const c = await mount(<RouteReviewHost />)
  const rows = c.locator('tbody tr')
  await expect(rows.nth(0).getByText('Parceiro', { exact: true })).toBeVisible()
  await expect(rows.nth(1).getByText('Parceiro', { exact: true })).toHaveCount(0)

  await c.getByRole('button', { name: 'Cabo Frio em um dia' }).click()
  const header = c.locator('header')
  await expect(header.getByText('Parceiro', { exact: true })).toBeVisible()
  await expect(header.getByRole('link', { name: 'Hotel Mar Azul' })).toHaveAttribute('href', `/admin/clients?clientId=${CLIENT_ID}&tab=brand`)
  await expect(header.getByText(/Autor parceiro\. Aprovado e público/)).toBeVisible()

  await c.getByRole('button', { name: 'Virar POI' }).click()
  await expect(c.getByText('No app o ponto sai com "Contado por @hotel-mar-azul".')).toBeVisible()
  await shoot(page, 'c02-route-review')
})
