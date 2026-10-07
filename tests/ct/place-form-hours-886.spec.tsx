/**
 * #886 — O EDITOR DO LOCAL MOSTRA E GRAVA O QUE O CADASTRO DO PARCEIRO ESCREVE (BR-B2B-033), e o
 * parceiro é a fonte de horário, contato e ofertas (BR-B2B-030).
 *
 * Chromium real, o `PlaceFormModal` real (com `OpeningHoursEditor`, `PartnerRegistrationPanel` e o
 * `EntityManagementDrawer`); a rede é `page.route` sobre o host de fixture do Supabase
 * (`ct-fixture.supabase.co`, ver `playwright-ct.config.ts`) e sobre `/api/*`. Nenhum banco real,
 * nenhuma EF: toda escrita é capturada e respondida com sucesso falso.
 *
 * O que a suíte `tests/api` não alcança: que o modal ABRE com o prefill completo, que o horário que
 * o editor monta é o formato de `parseOpeningHours`, que o save inteiro é RECUSADO (nada escrito)
 * com faixa incompleta ou WhatsApp curto, que a flag desmarcada grava `null` e a que não mudou
 * nem entra no update, e que o painel do parceiro some em local sem parceiro.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { ReactElement } from 'react'
import type { Page, Route } from '@playwright/test'
import { PlaceFormHost } from './place-form-modal-helpers'

const PLACE_ID = '33333333-3333-4333-8333-333333333333'

const HOURS = {
  monday: [{ open: '09:00', close: '18:00' }],
  friday: [{ open: '09:00', close: '12:00' }, { open: '14:00', close: '22:00' }],
}

interface Fixture {
  /** `core.attractions` columns the editor reads beside the RPC. */
  attraction?: Record<string, unknown>
  details?: Record<string, unknown>
  /** The description-policy view the panel reads; `null` = a place with no partner. */
  policy?: Record<string, unknown>
}

interface Captured {
  attractionPatch: Record<string, unknown>[]
  detailsUpsert: Record<string, unknown>[]
  coordinate: unknown[]
  policyPut: number
}

const WRITES = new Set(['PATCH', 'POST', 'PUT'])

async function wire(page: Page, fx: Fixture): Promise<Captured> {
  const captured: Captured = { attractionPatch: [], detailsUpsert: [], coordinate: [], policyPut: 0 }
  const attraction = {
    opening_hours: HOURS,
    website: 'https://padaria.example',
    contact_whatsapp: '21999998888',
    payment_credit_cards: 'yes',
    pet_friendly: 'yes',
    air_conditioning: 'no', // OSM said "no": it must survive a save that did not touch the flag
    wheelchair_accessible: true,
    formatted_address: 'Rua das Flores 10',
    postal_code: '25000000',
    ...fx.attraction,
  }
  const details = { app_benefit: 'Café grátis', subscriber_benefit: '10% de desconto', ...fx.details }

  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  const wantsObject = (route: Route) => (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object')

  await page.route('**/api/auth/check', (r) => json(r, { user: { role: 'admin', enabledModules: [] } }))
  await page.route('**/api/admin/places/*/description-policy', (r) => {
    if (r.request().method() === 'PUT') {
      captured.policyPut += 1
      return json(r, { outcome: 'not_applicable' })
    }
    return json(r, fx.policy ?? { attractionId: PLACE_ID, partnerClientId: null, registration: null })
  })
  await page.route('**/rest/v1/rpc/get_place_details', (r) =>
    json(r, [
      {
        id: PLACE_ID,
        name: 'Padaria Santa Clara',
        city: 'Gramado',
        state: 'Rio Grande do Sul',
        country: 'Brazil',
        approved: true,
        is_active: true,
        priority_level: 3,
        latitude: -29.37,
        longitude: -50.87,
        place_details: { place_type: 'cafe', price_range: 2, has_wifi: true, ...details },
      },
    ])
  )
  await page.route('**/rest/v1/rpc/cms_set_attraction_coordinate', (r) => {
    captured.coordinate.push(r.request().postDataJSON())
    return json(r, null)
  })
  await page.route('**/rest/v1/attractions**', (r) => {
    const method = r.request().method()
    if (method === 'PATCH') {
      captured.attractionPatch.push(r.request().postDataJSON())
      return r.fulfill({ status: 204, body: '' })
    }
    return json(r, wantsObject(r) ? attraction : [attraction])
  })
  await page.route('**/rest/v1/place_details**', (r) => {
    const method = r.request().method()
    if (WRITES.has(method)) {
      captured.detailsUpsert.push(r.request().postDataJSON())
      return r.fulfill({ status: 201, body: '' })
    }
    return json(r, wantsObject(r) ? details : [details])
  })
  return captured
}

const PARTNER_POLICY = {
  attractionId: PLACE_ID,
  name: 'Padaria Santa Clara',
  partnerClientId: 'client-1',
  decision: { policy: 'partner_story', reason: 'paid_tier' },
  registration: {
    source: 'portal',
    signatureItem: 'Pão de queijo recheado',
    languages: ['pt', 'en'],
    instagram: '@padariasantaclara',
    subtypes: ['bakery'],
    story: [{ id: 'story_script', answer: 'Dona Clara abriu em 1971.' }],
  },
}

async function open(page: Page, mount: (c: ReactElement) => Promise<unknown>) {
  await mount(<PlaceFormHost placeId={PLACE_ID} />)
  // The drawer shows a loader until the RPC answers; the name field is the first real content.
  await expect(page.getByText('Horário de funcionamento')).toBeVisible()
}

const saveButton = (page: Page) => page.getByRole('button', { name: 'Salvar' })


const EMPTY_MSG = 'Sem horário cadastrado. O app mostra este local como aberto.'

test.describe('PlaceFormModal · horário vazio (#886, a43735bb)', () => {
  for (const [name, stored] of [['null', null], ['objeto vazio', {}]] as const) {
    test(`#886 · horário ${name}: diz que o app mostra aberto e não escreve "Fechado" nos 7 dias`, async ({ page, mount }) => {
      await wire(page, { attraction: { opening_hours: stored } })
      await open(page, mount)
      await expect(page.getByText(EMPTY_MSG)).toBeVisible()
      await expect(page.getByText('Fechado', { exact: true })).toHaveCount(0)
    })
  }

  test('#886 · weekday_text do Google (array) abre vazio, mostra o texto e não diz "Fechado"', async ({ page, mount }) => {
    const weekdayText = ['Monday: 9:00 AM – 6:00 PM', 'Tuesday: Closed']
    await wire(page, { attraction: { opening_hours: weekdayText }, details: { opening_hours: weekdayText } })
    await open(page, mount)
    await expect(page.getByText(EMPTY_MSG)).toBeVisible()
    await expect(page.getByText('Monday: 9:00 AM – 6:00 PM')).toBeVisible()
    await expect(page.getByText('Fechado', { exact: true })).toHaveCount(0)
  })

  test('#886 · salvar OUTRO campo com horário vazio não grava opening_hours (nem null)', async ({ page, mount }) => {
    const captured = await wire(page, { attraction: { opening_hours: null } })
    await open(page, mount)
    await page.locator('input[value="https://padaria.example"]').fill('https://padaria2.example')
    await saveButton(page).click()
    await expect.poll(() => captured.attractionPatch.length).toBe(1)
    expect(captured.attractionPatch[0]).not.toHaveProperty('opening_hours')
    expect(captured.attractionPatch[0].website).toBe('https://padaria2.example')
  })

  test('#886 · weekday_text ilegível + salvar outro campo não apaga o horário guardado', async ({ page, mount }) => {
    const weekdayText = ['Monday: 9:00 AM – 6:00 PM']
    const captured = await wire(page, { attraction: { opening_hours: weekdayText }, details: { opening_hours: weekdayText } })
    await open(page, mount)
    await page.locator('input[value="https://padaria.example"]').fill('https://padaria3.example')
    await saveButton(page).click()
    await expect.poll(() => captured.attractionPatch.length).toBe(1)
    expect(captured.attractionPatch[0]).not.toHaveProperty('opening_hours')
  })

  test('#886 · o operador mexe no horário: grava, e os dias sem faixa passam a dizer "Fechado"', async ({ page, mount }) => {
    const captured = await wire(page, { attraction: { opening_hours: null } })
    await open(page, mount)
    await page.getByRole('button', { name: 'Faixa', exact: true }).first().click()
    await expect(page.getByText(EMPTY_MSG)).toHaveCount(0)
    await expect(page.getByText('Fechado', { exact: true })).toHaveCount(6)
    const times = page.locator('input[type="time"]')
    await times.nth(0).fill('09:00')
    await times.nth(1).fill('18:00')
    await saveButton(page).click()
    await expect.poll(() => captured.attractionPatch.length).toBe(1)
    expect(captured.attractionPatch[0].opening_hours).toEqual({ monday: [{ open: '09:00', close: '18:00' }] })
  })
})
