/**
 * #1264, BR-COMUNICACAO-026: the partner message tab of the push composer, in real Chromium. The
 * routes of `app/api/admin/partner-messages` are `page.route` fixtures.
 *
 * Pinned: the list shows the exact numbers; a draft shows the guide of item 7 beside the acts; a
 * refusal of the database (TGB92, the partner's month) becomes the sentence that says what to do;
 * the editor counts the characters of each field against the copy's limits. `PM_SHOTS=<dir>` saves
 * the screens at 390 and 1440 px.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page, Route } from '@playwright/test'
import { PartnerMessageHarness } from './partner-message-1264-helpers'

const ID = 'aaaaaaaa-1111-4222-8333-444444444444'
const CLIENT = 'cccccccc-1111-4222-8333-444444444444'
const SHOTS = process.env.PM_SHOTS

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

const TEXT_PT = {
  title: 'Pousada Vila do Mar: jazz no sábado',
  summary: 'Música ao vivo no jardim, sábado, 28 de novembro, às 20h. A entrada é livre.',
  subject: 'Pousada Vila do Mar: jazz no jardim, sábado às 20h',
  preheader: null,
  body: 'Neste sábado, 28 de novembro, das 20h às 23h, o Trio Maré toca jazz e bossa nova no jardim da pousada.\n\nA entrada é livre, e as mesas são por ordem de chegada.',
  button_label: 'Reservar o jantar',
  image_alt: null,
}

function message(status: string) {
  return {
    id: ID, client_id: CLIENT, partner_handle: 'viladomar', partner_name: 'Pousada Vila do Mar', status,
    requested_by: 'Marina, gerente', requested_at: '2026-11-24T14:00:00Z', button_kind: 'website', button_ref: null,
    button_url: 'https://viladomar.example/reservas', image_path: null, local_send_at: status === 'approved' ? null : '2026-11-28T10:00:00',
    refusal_reason: null, cancel_reason: null, created_at: '2026-11-24T14:10:00Z', decided_at: null, scheduled_at: null, finished_at: null,
    texts: { pt: TEXT_PT },
    numbers: { reach: 41, queued: 38, capped: 2, no_language: 1, push_sent: 30, push_failed: 2, email_sent: 27, email_failed: 0, opened: 19, app_opened: 12, email_clicked: 7, opted_out_7d: 1 },
    audience_yes_now: 40,
  }
}

async function stub(page: Page, status = 'draft') {
  await page.route('**/api/admin/partner-messages/senders', (r) =>
    json(r, { senders: [{ client_id: CLIENT, partner_handle: 'viladomar', partner_name: 'Pousada Vila do Mar', client_type: 'hotel', can_send: true, audience_yes: 40, monthly_cap: 4, used_this_month: 4, last_local_send_at: null }] }))
  await page.route(`**/api/admin/partner-messages/${ID}/decision`, (r) =>
    json(r, { error: { code: 'monthly_cap', cap: 4 } }, 409))
  await page.route(`**/api/admin/partner-messages/${ID}`, (r) => json(r, { message: message(status) }))
  await page.route(/\/api\/admin\/partner-messages(\?.*)?$/, (r) =>
    json(r, { messages: [{ id: ID, client_id: CLIENT, partner_handle: 'viladomar', partner_name: 'Pousada Vila do Mar', status: 'sent', title: TEXT_PT.title, languages: ['pt', 'en'], local_send_at: '2026-11-28T10:00:00', requested_by: 'Marina', requested_at: '2026-11-24T14:00:00Z', created_at: '2026-11-24T14:10:00Z', decided_at: null, refusal_reason: null, cancel_reason: null, reach: 41, push_sent: 30, email_sent: 27, opened: 19 }] }))
}

async function shoot(page: Page, name: string) {
  if (!SHOTS) return
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.screenshot({ path: `${SHOTS}/${name}-${width}.png`, fullPage: true })
  }
}

test('BR-COMUNICACAO-026 item 6.e: the list shows each message with its exact numbers', async ({ mount, page }) => {
  await stub(page)
  const c = await mount(<PartnerMessageHarness />)
  const row = c.getByRole('row', { name: /jazz no sábado/ })
  await expect(row).toContainText('Enviada')
  await expect(row).toContainText('41')
  await expect(row).toContainText('19')
  await shoot(page, 'list')
})

test('BR-COMUNICACAO-026 item 7: a draft shows the guide of what the curator refuses beside the acts', async ({ mount, page }) => {
  await stub(page, 'draft')
  const c = await mount(<PartnerMessageHarness />)
  await c.getByRole('button', { name: /jazz no sábado/ }).click()
  await expect(c.getByRole('button', { name: 'Aprovar' })).toBeVisible()
  await expect(c.getByRole('button', { name: 'Recusar' })).toBeVisible()
  await expect(c.getByText('O que o curador recusa')).toBeVisible()
  await expect(c.getByText('"O Tuggi recomenda o nosso café da manhã." Fala em nome do Tuggi (7.a).')).toBeVisible()
  await expect(c.getByText('Saíram em até 7 dias')).toBeVisible()
  await shoot(page, 'detail-draft')
})

test('BR-COMUNICACAO-026 item 4.a: scheduling past the partner month says what to do', async ({ mount, page }) => {
  await stub(page, 'approved')
  const c = await mount(<PartnerMessageHarness />)
  await c.getByRole('button', { name: /jazz no sábado/ }).click()
  await c.getByRole('button', { name: 'Agendar' }).click()
  await c.getByLabel('Dia e hora do envio').fill('2026-11-30T10:00')
  await c.getByRole('button', { name: 'Confirmar' }).click()
  await expect(c.getByRole('alert')).toHaveText('O parceiro já usou as 4 mensagens deste mês. Agende para o mês seguinte.')
  await shoot(page, 'schedule-cap')
})

test('#1264: the editor counts each field against the limits of the copy', async ({ mount, page }) => {
  await stub(page)
  const c = await mount(<PartnerMessageHarness />)
  await c.getByRole('button', { name: 'Nova mensagem' }).click()
  await c.getByLabel('Título', { exact: true }).fill(TEXT_PT.title)
  await expect(c.getByText('35/40')).toBeVisible()
  await expect(c.getByText('0/500')).toBeVisible()
  await expect(c.getByText('0/24')).toBeVisible()
  await shoot(page, 'editor')
})
