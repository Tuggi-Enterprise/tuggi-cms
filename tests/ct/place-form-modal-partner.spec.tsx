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

test.describe('PlaceFormModal · campos do parceiro (#886)', () => {
  test('BR-B2B-033 · prefill completo: horário, WhatsApp, site, ofertas e as 4 flags aparecem', async ({ page, mount }) => {
    await wire(page, { policy: PARTNER_POLICY })
    await open(page, mount)

    // Hours: Seg 09:00–18:00, Sex has two ranges. `input[type=time]` values are the stored ones.
    const times = await page.locator('input[type="time"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
    expect(times).toEqual(['09:00', '18:00', '09:00', '12:00', '14:00', '22:00'])

    await expect(page.locator('input[inputmode="tel"]')).toHaveValue('21999998888')
    await expect(page.locator('input[value="https://padaria.example"]')).toBeVisible()
    await expect(page.locator('textarea').nth(0)).toHaveValue('Café grátis')
    await expect(page.locator('textarea').nth(1)).toHaveValue('10% de desconto')

    // The four flags: yes / yes / OSM "no" / true.
    await expect(page.getByLabel('Cartão e Pix')).toBeChecked()
    await expect(page.getByLabel('Aceita pets')).toBeChecked()
    await expect(page.getByLabel('Ar-condicionado')).not.toBeChecked()
    await expect(page.getByLabel('Acessível a cadeirantes')).toBeChecked()
  })

  test('BR-B2B-033 · salvar o horário grava o formato de parseOpeningHours, e só o que mudou nas flags', async ({ page, mount }) => {
    const captured = await wire(page, { policy: PARTNER_POLICY })
    await open(page, mount)

    // Close Friday's second range and change Monday's closing time.
    await page.locator('input[type="time"]').nth(1).fill('19:30')
    await page.getByRole('button', { name: 'Remover faixa', exact: true }).nth(2).click()
    await saveButton(page).click()

    await expect.poll(() => captured.attractionPatch.length).toBe(1)
    const patch = captured.attractionPatch[0]
    expect(patch.opening_hours).toEqual({
      monday: [{ open: '09:00', close: '19:30' }],
      friday: [{ open: '09:00', close: '12:00' }],
    })
    expect(patch.contact_whatsapp).toBe('21999998888')
    expect(patch.website).toBe('https://padaria.example')
    // BR-B2B-033: no flag was touched, so none enters the update — the OSM "no" is not turned into null.
    for (const flag of ['payment_credit_cards', 'pet_friendly', 'air_conditioning', 'wheelchair_accessible']) {
      expect(patch, flag).not.toHaveProperty(flag)
    }
    await expect.poll(() => captured.detailsUpsert.length).toBe(1)
    expect(captured.detailsUpsert[0]).toMatchObject({ app_benefit: 'Café grátis', subscriber_benefit: '10% de desconto' })
  })

  test('BR-B2B-033 · desmarcar uma flag grava null; marcar a que era "no" grava o valor sim', async ({ page, mount }) => {
    const captured = await wire(page, { policy: PARTNER_POLICY })
    await open(page, mount)

    await page.getByLabel('Aceita pets').uncheck() // 'yes' → null
    await page.getByLabel('Acessível a cadeirantes').uncheck() // true → null
    await page.getByLabel('Ar-condicionado').check() // 'no' → 'yes'
    await saveButton(page).click()

    await expect.poll(() => captured.attractionPatch.length).toBe(1)
    const patch = captured.attractionPatch[0]
    expect(patch.pet_friendly).toBeNull()
    expect(patch.wheelchair_accessible).toBeNull()
    expect(patch.air_conditioning).toBe('yes')
    expect(patch).not.toHaveProperty('payment_credit_cards')
  })

  test('BR-B2B-030 · faixa de horário incompleta recusa o save INTEIRO: nada é escrito', async ({ page, mount }) => {
    const captured = await wire(page, { policy: PARTNER_POLICY })
    await open(page, mount)

    await page.getByRole('button', { name: 'Faixa', exact: true }).first().click() // Seg gets a 2nd range, 00 blank
    await saveButton(page).click()

    await expect(page.getByText('Horário incompleto: preencha abertura e fechamento')).toBeVisible()
    expect(captured.attractionPatch).toHaveLength(0)
    expect(captured.detailsUpsert).toHaveLength(0)
    expect(captured.coordinate).toHaveLength(0)
  })

  test('BR-B2B-030 · WhatsApp com menos de 10 dígitos recusa o save INTEIRO: nada é escrito', async ({ page, mount }) => {
    const captured = await wire(page, { policy: PARTNER_POLICY })
    await open(page, mount)

    await page.locator('input[inputmode="tel"]').fill('(21) 9999-88') // 8 digits
    await saveButton(page).click()

    await expect(page.getByText('WhatsApp inválido')).toBeVisible()
    expect(captured.attractionPatch).toHaveLength(0)
    expect(captured.detailsUpsert).toHaveLength(0)
    expect(captured.coordinate).toHaveLength(0)
  })

  test('BR-B2B-030 · WhatsApp com máscara é gravado só com dígitos', async ({ page, mount }) => {
    const captured = await wire(page, { policy: PARTNER_POLICY })
    await open(page, mount)

    await page.locator('input[inputmode="tel"]').fill('+55 (21) 99999-8888')
    await saveButton(page).click()
    await expect.poll(() => captured.attractionPatch.length).toBe(1)
    expect(captured.attractionPatch[0].contact_whatsapp).toBe('5521999998888')
  })

  test('BR-B2B-033 · parceiro: o painel "O que o parceiro informou" mostra a resposta, e nada do representante', async ({ page, mount }) => {
    await wire(page, { policy: PARTNER_POLICY })
    await open(page, mount)

    await expect(page.getByText('O que o parceiro informou')).toBeVisible()
    await expect(page.getByText('Pão de queijo recheado')).toBeVisible()
    await expect(page.getByText('Portal de locais')).toBeVisible()
    await expect(page.getByText('Dona Clara abriu em 1971.')).toBeVisible()
    const body = await page.locator('body').innerText()
    expect(body).not.toMatch(/representative|CPF|\d{3}\.\d{3}\.\d{3}-\d{2}/i)
  })

  test('BR-B2B-033 · local SEM parceiro não mostra o painel do parceiro (os campos do editor continuam)', async ({ page, mount }) => {
    await wire(page, {}) // policy: partnerClientId null
    await open(page, mount)

    await expect(page.locator('input[inputmode="tel"]')).toHaveValue('21999998888')
    await expect(page.getByText('O que o parceiro informou')).toHaveCount(0)
  })
})
