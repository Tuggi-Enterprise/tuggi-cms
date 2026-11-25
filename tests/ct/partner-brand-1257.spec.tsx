/**
 * #1257: the curator's screens of the Tuggi do parceiro, in real Chromium with the real Tailwind.
 * The CMS routes are `page.route` fixtures; nothing reaches a database.
 *
 * Pinned: the queue shows the logo on the air beside the one sent and warns when the sent one is not
 * square or is smaller than 512 px (BR-B2B-070 item 2); a TGB71 answer (the file is not pending any
 * more) reads as the sentence and reloads the queue; a refusal without a reason never leaves the
 * browser; the pilot with the end before the start is refused on the screen (item 9).
 * Set CT_SHOTS=<folder> to also write the 390 and 1440 px captures.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page, Route } from '@playwright/test'
import { BrandTabHost, PartnerBrandPageHost } from './partner-brand-1257-helpers'

const CLIENT_ID = 'cccccccc-1111-4222-8333-444444444444'
const LOGO = `${CLIENT_ID}/dddddddd-1111-4222-8333-444444444444.png`
const svg = (w: number, h: number, fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" rx="40" fill="${fill}"/></svg>`)}`

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function stub(page: Page, opts: { decision?: (r: Route) => Promise<void> } = {}) {
  let queueReads = 0
  // The place suggestions (#1261) share the page; empty here.
  await page.route('**/api/admin/partner-brand/suggestions**', (r) => json(r, { suggestions: [] }))
  await page.route('**/api/routes/partners', (r) => json(r, { partners: [] }))
  await page.route('**/api/admin/partner-brand/logos', (r) => {
    if (r.request().method() === 'POST') return opts.decision ? opts.decision(r) : json(r, { decision: {} })
    queueReads += 1
    return json(r, {
      logos: [
        {
          client_id: CLIENT_ID,
          client_name: 'Pousada Mar Azul',
          logo_path: LOGO,
          logo_submitted_at: '2026-11-24T15:00:00Z',
          logo_url: svg(400, 300, '#E4572E'),
          approved_logo_path: null,
          approved_logo_url: null,
        },
      ],
    })
  })
  await page.route('**/api/admin/partner-brand/settings', (r) =>
    json(r, {
      term_days: 30,
      switches: [
        { key: 'partner.brand_color_enabled', is_on: false, updated_at: null },
        { key: 'partner.gift_ios_enabled', is_on: true, updated_at: null },
        { key: 'partner.gift_android_enabled', is_on: true, updated_at: null },
      ],
      packages: [1, 3, 5, 7, 10, 15].map((days) => ({ days, price_cents: days === 7 ? 4990 : null, price_currency: days === 7 ? 'BRL' : null })),
    }),
  )
  await page.route(`**/api/admin/clients/${CLIENT_ID}/brand`, (r) =>
    json(r, {
      brand: {
        client_id: CLIENT_ID,
        logo_path: LOGO,
        logo_status: 'pending',
        logo_submitted_at: '2026-11-24T15:00:00Z',
        logo_decided_at: null,
        logo_rejection_reason: null,
        logo_url: svg(512, 512, '#1B998B'),
        approved_logo_path: `${CLIENT_ID}/eeeeeeee-1111-4222-8333-444444444444.png`,
        approved_logo_url: svg(512, 512, '#2D3047'),
        pilot_starts_at: '2026-12-01T03:00:00Z',
        pilot_ends_at: '2027-03-01T03:00:00Z',
        gift_days: 7,
      },
    }),
  )
  return { queueReads: () => queueReads }
}

async function shoot(page: Page, name: string) {
  const dir = process.env.CT_SHOTS
  if (!dir) return
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.screenshot({ path: `${dir}/${name}-${width}.png`, fullPage: true })
  }
}

test('#1257 BR-B2B-070: the queue shows the sent logo beside the live one and warns when it is not square', async ({ mount, page }) => {
  await stub(page)
  const c = await mount(<PartnerBrandPageHost />)
  await expect(c.getByRole('heading', { name: 'Logos para aprovar' })).toBeVisible()
  await expect(c.getByRole('link', { name: 'Pousada Mar Azul' })).toHaveAttribute('href', `/admin/clients?clientId=${CLIENT_ID}&tab=brand`)
  await expect(c.getByText('Nenhum logo aprovado')).toBeVisible()
  await expect(c.getByText('400 × 300 px: o logo precisa ser quadrado, com pelo menos 512 × 512 px.')).toBeVisible()
  await expect(c.getByLabel('Prazo da marca no app')).toHaveValue('30')
  await expect(c.getByLabel('Preço do pacote de 7 dias')).toHaveValue('49,90')
  await shoot(page, 'partner-brand')
})

test('#1257 BR-B2B-070: a refusal without a reason never leaves the browser', async ({ mount, page }) => {
  let posted = 0
  await stub(page, { decision: (r) => ((posted += 1), json(r, { decision: {} })) })
  const c = await mount(<PartnerBrandPageHost />)
  await c.getByRole('button', { name: 'Recusar', exact: true }).click()
  await c.getByRole('button', { name: 'Recusar logo' }).click()
  await expect(c.getByText('Escreva o motivo da recusa: o parceiro lê no portal.')).toBeVisible()
  expect(posted).toBe(0)
})

test('#1257 BR-B2B-070: TGB71 reads as the sentence and the queue reloads', async ({ mount, page }) => {
  const s = await stub(page, { decision: (r) => json(r, { error: { code: 'logo_not_pending' } }, 409) })
  const c = await mount(<PartnerBrandPageHost />)
  await expect(c.getByText('Pousada Mar Azul')).toBeVisible()
  const before = s.queueReads()
  await c.getByRole('button', { name: 'Aprovar' }).click()
  await expect(c.getByText(/Este logo não espera mais decisão/)).toBeVisible()
  await expect.poll(() => s.queueReads()).toBeGreaterThan(before)
})

test('#1257 BR-B2B-070: the record tab shows both logos and refuses a pilot that ends before it starts', async ({ mount, page }) => {
  await stub(page)
  let patched = 0
  await page.route(`**/api/admin/clients/${CLIENT_ID}/brand`, (r, request) => {
    if (request.method() === 'PATCH') patched += 1
    return r.fallback()
  })
  const c = await mount(<BrandTabHost clientId={CLIENT_ID} />)
  await expect(c.getByText('No ar', { exact: true })).toBeVisible()
  await expect(c.getByText('512 × 512 px', { exact: true })).toBeVisible()
  await shoot(page, 'brand-tab')
  await c.getByLabel('Fim').fill('2026-11-01T10:00')
  await c.getByRole('button', { name: 'Salvar' }).click()
  await expect(c.getByText('O fim do piloto precisa vir depois do início.')).toBeVisible()
  expect(patched).toBe(0)
})
