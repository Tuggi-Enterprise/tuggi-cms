/**
 * #1233: `/admin/trip-reminder` in a real browser, the API answered by `page.route`.
 * BR-COMUNICACAO-024 items 9 and 10, BR-COMUNICACAO-023 item 5, BR-USUARIO-055 item 6.c.
 * #1238: the length bands in the panel and the numbers, BR-MONETIZACAO-091 2.a and 2.d.
 *
 * `CT_CAPTURE_DIR` set = the inspection screenshots of the four tabs are written there (1440 and
 * 390 px).
 *
 * Run with: npx playwright test -c playwright-ct.config.ts trip-reminder-1233
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page, Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { TripReminderHarness } from './trip-reminder-helpers'
import { PANEL, SENDS, SETTINGS } from './trip-reminder-fixtures'

const CAPTURE = process.env.CT_CAPTURE_DIR
const NEW_SECRET = 'EAAG-new-provider-token-0123-QRST'

type Sent = { url: string; method: string; body: unknown }

async function serve(page: Page, sent: Sent[]) {
  let settings: typeof SETTINGS = JSON.parse(JSON.stringify(SETTINGS))
  const record = (route: Route) => {
    const request = route.request()
    sent.push({ url: request.url(), method: request.method(), body: request.postDataJSON() })
  }
  await page.route('**/api/admin/trip-reminder/settings', (route) => route.fulfill({ json: settings }))
  await page.route('**/api/admin/trip-reminder/panel', (route) => route.fulfill({ json: PANEL }))
  await page.route('**/api/admin/trip-reminder/sends**', (route) => route.fulfill({ json: { sends: SENDS } }))
  await page.route('**/api/admin/trip-reminder/switches', async (route) => {
    record(route)
    const { key, is_on } = route.request().postDataJSON()
    settings = { ...settings, switches: settings.switches.map((s) => (s.key === key ? { ...s, is_on } : s)) }
    await route.fulfill({ json: { key, is_on, updated_at: '2026-11-23T19:00:00Z', ask_phone_effective: false } })
  })
  await page.route('**/api/admin/trip-reminder/secrets', async (route) => {
    record(route)
    const { name } = route.request().postDataJSON()
    settings = {
      ...settings,
      secrets: settings.secrets.map((s) => (s.name === name ? { ...s, configured_at: '2026-11-23T19:00:00Z', last4: 'QRST' } : s)),
      secret_changes: [{ name, changed_at: '2026-11-23T19:00:00Z', changed_by: 'u1', changed_by_email: 'operador@tuggi.app' }, ...settings.secret_changes],
    }
    await route.fulfill({ json: { name, channel: name.split('.')[0], configured_at: '2026-11-23T19:00:00Z', last4: 'QRST' } })
  })
  await page.route('**/api/admin/trip-reminder/test-send', async (route) => {
    record(route)
    const { channel } = route.request().postDataJSON()
    await route.fulfill({ json: channel === 'whatsapp' ? { ok: false, channel, error_code: '131026' } : { ok: true, channel } })
  })
}

async function settle(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().endTime === Infinity)
  )
}

for (const size of [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
]) {
  test(`#1233 the four tabs at ${size.name} px`, async ({ mount, page }) => {
    await page.setViewportSize({ width: size.width, height: size.height })
    await serve(page, [])
    const component = await mount(<TripReminderHarness />)

    await expect(component.getByRole('heading', { name: 'Viagem marcada e lembrete' })).toBeVisible()
    await expect(component.getByText('Horas de viagem liberadas')).toBeVisible()
    await expect(component.getByRole('cell', { name: /Búzios/ }).first()).toBeVisible()
    if (CAPTURE) await page.screenshot({ path: `${CAPTURE}/painel-${size.name}.png`, fullPage: true })

    await component.getByRole('tab', { name: 'Configuração' }).click()
    await expect(component.getByText('Acima de 5 dias, as boas-vindas perdem o aviso da véspera.')).toBeVisible()
    await expect(component.getByLabel('Canal WhatsApp')).not.toBeChecked()
    if (CAPTURE) await page.screenshot({ path: `${CAPTURE}/configuracao-${size.name}.png`, fullPage: true })

    await component.getByRole('tab', { name: 'Segredos' }).click()
    await expect(component.getByText(/termina em a91F/)).toBeVisible()
    if (CAPTURE) await page.screenshot({ path: `${CAPTURE}/segredos-${size.name}.png`, fullPage: true })

    await component.getByRole('tab', { name: 'Envios' }).click()
    await expect(component.getByText('final 4321')).toBeVisible()
    if (CAPTURE) await page.screenshot({ path: `${CAPTURE}/envios-${size.name}.png`, fullPage: true })
  })
}

test('#1233 BR-COMUNICACAO-024 item 10: a new secret leaves the field before the request, and only the last 4 come back', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const sent: Sent[] = []
  await serve(page, sent)
  const component = await mount(<TripReminderHarness />)
  await component.getByRole('tab', { name: 'Segredos' }).click()

  await component.getByRole('button', { name: 'Configurar Token de acesso da API do WhatsApp' }).click()
  const field = component.getByLabel('Valor novo de Token de acesso da API do WhatsApp')
  await expect(field).toHaveAttribute('type', 'password')
  await field.fill(NEW_SECRET)
  await component.getByRole('button', { name: 'Salvar segredo' }).click()

  await expect(component.getByRole('status')).toHaveText('Token de acesso da API do WhatsApp salvo.')
  await expect(component.getByText(/termina em QRST/)).toBeVisible()
  await expect(field).toHaveCount(0)
  expect(sent.map((s) => [s.method, s.url.split('/api/')[1], s.body])).toEqual([
    ['PUT', 'admin/trip-reminder/secrets', { name: 'whatsapp.access_token', value: NEW_SECRET }],
  ])
  expect(await page.content()).not.toContain(NEW_SECRET)
  if (CAPTURE) await page.screenshot({ path: `${CAPTURE}/segredo-salvo-1440.png`, fullPage: true })
})

test('#1233 BR-COMUNICACAO-024 item 9: the test send shows the verdict, the failure code included', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const sent: Sent[] = []
  await serve(page, sent)
  const component = await mount(<TripReminderHarness />)
  await component.getByRole('tab', { name: 'Envios' }).click()

  await expect(component.getByRole('button', { name: 'Enviar teste de Confirmação do celular por E-mail' })).toHaveCount(0)
  await component.getByRole('button', { name: 'Enviar teste de Lembrete no dia por E-mail' }).click()
  await expect(component.getByRole('status').filter({ hasText: 'Enviado' })).toBeVisible()
  await component.getByRole('button', { name: 'Enviar teste de Confirmação do celular por WhatsApp' }).click()
  await expect(component.getByText('Falhou: 131026')).toBeVisible()
  expect(sent.map((s) => s.body)).toEqual([
    { piece: 'trip_reminder_day', channel: 'email' },
    { piece: 'phone_confirmation', channel: 'whatsapp' },
  ])
})

test('#1233 BR-COMUNICACAO-023 item 5: a switch saves on the control', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const sent: Sent[] = []
  await serve(page, sent)
  const component = await mount(<TripReminderHarness />)
  await component.getByRole('tab', { name: 'Configuração' }).click()

  await component.getByLabel('Lembrete no dia da viagem').uncheck()
  await expect(component.getByText('Lembrete no dia da viagem: desligada.')).toBeVisible()
  expect(sent.map((s) => s.body)).toEqual([{ key: 'trip_reminder.same_day', is_on: false }])
})

for (const size of [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
]) {
  test(`#1238 BR-MONETIZACAO-091 2.a and BR-USUARIO-055 item 6.c: the panel splits the trips by length band at ${size.name} px`, async ({ mount, page }) => {
    await page.setViewportSize({ width: size.width, height: size.height })
    await serve(page, [])
    const component = await mount(<TripReminderHarness />)

    const bands = component.getByRole('region', { name: 'Viagens por duração' })
    await expect(bands).toBeVisible()
    expect(await bands.locator('dt').allTextContents()).toEqual(['Até 3 dias', 'De 4 a 7 dias', 'Mais de 7 dias', 'Sem duração'])
    expect(await bands.locator('dd').allTextContents()).toEqual(['12', '9', '8', '9'])
    await expect(component.getByRole('row', { name: /Lisboa/ })).toContainText('Mais de 7 dias')
    await expect(component.getByRole('row', { name: /Paraty/ })).toContainText('Sem duração')
    expect(await component.getByRole('row', { name: /Búzios/ }).count()).toBe(2)
    if (CAPTURE) await page.screenshot({ path: `${CAPTURE}/painel-1238-${size.name}.png`, fullPage: true })

    await component.getByRole('tab', { name: 'Configuração' }).click()
    await expect(component.getByText('Hora de viagem: até 3 dias')).toBeVisible()
    if (CAPTURE) await page.screenshot({ path: `${CAPTURE}/configuracao-1238-${size.name}.png`, fullPage: true })
  })
}

test('#1238 BR-MONETIZACAO-091 2.a and 2.d, BR-COMUNICACAO-024 item 1: three amounts by band, the interval saves 0, the phone line names no channel', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const sent: Sent[] = []
  await serve(page, sent)
  // The interval starts above 0 here, so that 0 is a change the editor must let through.
  const withInterval = JSON.parse(JSON.stringify(SETTINGS))
  withInterval.numbers['planned_trip.interval_months'].value = 6
  await page.route('**/api/admin/trip-reminder/settings', (route) => route.fulfill({ json: withInterval }))
  await page.route('**/api/admin/reward-settings', async (route) => {
    const request = route.request()
    sent.push({ url: request.url(), method: request.method(), body: request.postDataJSON() })
    await route.fulfill({ json: { key: 'planned_trip.interval_months', value: 0 } })
  })
  const component = await mount(<TripReminderHarness />)
  await component.getByRole('tab', { name: 'Configuração' }).click()

  expect(await component.getByText(/^Hora de viagem: /).allTextContents()).toEqual([
    'Hora de viagem: até 3 dias',
    'Hora de viagem: de 4 a 7 dias',
    'Hora de viagem: mais de 7 dias',
  ])
  await expect(component.getByText('Vale também para a viagem sem duração informada.')).toBeVisible()
  await expect(component.getByText('O app não pede o celular agora. Para pedir, ligue "Pedir o celular".')).toBeVisible()
  await expect(component.getByText(/canal de mensagem|Só vale com/)).toHaveCount(0)

  // A band amount stays above zero (reward_settings_value_ck).
  await component.getByRole('button', { name: 'Editar Hora de viagem: até 3 dias' }).click()
  await component.getByLabel('Hora de viagem: até 3 dias', { exact: true }).fill('0')
  await expect(component.getByText('O valor precisa ser maior que zero.')).toBeVisible()
  await expect(component.getByRole('button', { name: 'Salvar', exact: true })).toBeDisabled()
  await component.getByRole('button', { name: 'Cancelar' }).click()

  // The interval takes 0, never a negative.
  await component.getByRole('button', { name: 'Editar Intervalo mínimo entre duas liberações' }).click()
  const interval = component.getByLabel('Intervalo mínimo entre duas liberações', { exact: true })
  await interval.fill('-1')
  await expect(component.getByText('O valor não pode ser negativo.')).toBeVisible()
  await interval.fill('0')
  await expect(component.getByText('O valor não pode ser negativo.')).toHaveCount(0)
  await component.getByRole('button', { name: 'Salvar', exact: true }).click()
  await page.getByRole('button', { name: 'Salvar valor' }).click()
  await expect(page.getByRole('button', { name: 'Salvar valor' })).toHaveCount(0)
  expect(sent.map((s) => [s.method, s.url.split('/api/')[1], s.body])).toEqual([
    ['PATCH', 'admin/reward-settings', { key: 'planned_trip.interval_months', value: 0 }],
  ])
})

test('#1233 the four tabs pass axe', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await serve(page, [])
  const component = await mount(<TripReminderHarness />)
  for (const tab of ['Painel', 'Configuração', 'Segredos', 'Envios']) {
    await component.getByRole('tab', { name: tab }).click()
    await expect(component.getByRole('tabpanel')).not.toContainText('Carregando')
    await settle(page)
    const result = await new AxeBuilder({ page }).include('#root').analyze()
    expect(result.violations.map((v) => `${tab}: ${v.id}`)).toEqual([])
  }
})
