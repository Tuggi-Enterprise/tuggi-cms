/**
 * #902 — Pendências no navegador: o que `tests/api/finance-pending-routes.test.ts` garante no
 * servidor (503, nunca lista vazia) só vale se a TELA também não transformar o erro em "Nada
 * pendente". Este arquivo é a outra metade.
 *
 * Regras: BR-B2B-044 (repasse: só admin age), BR-B2B-046 (nota), DS-A11Y-003 (gravidade e estado
 * sempre em texto).
 *
 * Mutations that turn this suite red:
 *  · a tela mostrar "Nada pendente" quando `/api/finance/pending` responde 503 ou cai;
 *  · a seção inicial deixar de ser Pendências;
 *  · gravidade só em cor (o teste lê o TEXTO "Urgente"/"Atenção");
 *  · o contador do menu divergir do número de linhas;
 *  · o editor ver botão de repasse em vez de "Só admin";
 *  · a ordem da API não chegar à tela como veio.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import { FinancePageContent } from '@/components/finance/FinancePageContent'
import { FinanceWrapper as Wrapper } from './finance-helpers'
import { mockAll } from './finance-fixtures'
import ptMessages from '@/messages/pt.json'

const F = ptMessages.Finance
const NOTHING_PENDING = /Nada pendente/

const row = (over: Record<string, unknown>) => ({
  kind: 'charge_overdue',
  severity: 'warning',
  objectType: 'charge',
  objectId: 'o1',
  subscriptionId: 'sub-1',
  clientId: null,
  periodMonth: null,
  amountCents: 10_000,
  referenceDate: '2026-08-01',
  detail: null,
  placeName: 'Baires Bistrô',
  attractionId: null,
  attractionEntityKind: null,
  contactEmail: null,
  invoiceStatus: null,
  ...over,
})

async function mockPending(page: Page, status: number, body: unknown) {
  await page.route('**/api/finance/pending', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  )
}

const mountPage = (mount: any) =>
  mount(
    <Wrapper>
      <FinancePageContent />
    </Wrapper>
  )

test('#902: a tela abre em Pendências', async ({ mount, page }) => {
  await mockAll(page)
  await mockPending(page, 200, { items: [], checkedAt: '2026-10-07T15:30:00Z', viewerIsAdmin: true })
  const component = await mountPage(mount)
  await expect(component.getByRole('heading', { level: 2, name: F.sections.pending })).toBeVisible()
})

test('#902: lista vazia e saudável mostra "Nada pendente" com a hora da conferência', async ({ mount, page }) => {
  await mockAll(page)
  await mockPending(page, 200, { items: [], checkedAt: '2026-10-07T15:30:00Z', viewerIsAdmin: true })
  const component = await mountPage(mount)
  await expect(component.getByText(NOTHING_PENDING)).toBeVisible()
})

test('BR-B2B-044 #902: leitura que falha (503) mostra o erro e NUNCA "Nada pendente"', async ({ mount, page }) => {
  await mockAll(page)
  await mockPending(page, 503, { error: 'pending_unavailable' })
  const component = await mountPage(mount)

  await expect(component.getByText(F.pending.error)).toBeVisible()
  await expect(component.getByRole('button', { name: F.pending.reload })).toBeVisible()
  await expect(component.getByText(NOTHING_PENDING)).toHaveCount(0)
})

test('BR-B2B-044 #902: rede que cai também mostra o erro e NUNCA "Nada pendente"', async ({ mount, page }) => {
  await mockAll(page)
  await page.route('**/api/finance/pending', (route) => route.abort('failed'))
  const component = await mountPage(mount)

  await expect(component.getByText(F.pending.error)).toBeVisible()
  await expect(component.getByText(NOTHING_PENDING)).toHaveCount(0)
})

test('#902: "Recarregar" depois do erro refaz a leitura e mostra a lista', async ({ mount, page }) => {
  await mockAll(page)
  let calls = 0
  await page.route('**/api/finance/pending', (route) => {
    calls += 1
    return calls === 1
      ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"pending_unavailable"}' })
      : route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [row({})], checkedAt: '2026-10-07T15:30:00Z', viewerIsAdmin: true }),
        })
  })
  const component = await mountPage(mount)
  await component.getByRole('button', { name: F.pending.reload }).click()
  await expect(component.getByText('Cobrança vencida')).toBeVisible()
  await expect(component.getByText(F.pending.error)).toHaveCount(0)
})

test('DS-A11Y-003 #902: gravidade em texto, motivo na linha, ordem da API preservada, contador = linhas', async ({
  mount,
  page,
}) => {
  await mockAll(page)
  await mockPending(page, 200, {
    items: [
      row({ objectId: 'a', kind: 'invoice_error', severity: 'critical', objectType: 'invoice', invoiceStatus: 'ERROR', detail: 'IM do prestador inválida', placeName: 'Local A' }),
      row({ objectId: 'b', kind: 'invoice_error', severity: 'critical', objectType: 'invoice', invoiceStatus: 'CANCELLATION_DENIED', detail: 'prazo vencido', placeName: 'Local B' }),
      row({ objectId: 'c', kind: 'charge_without_invoice', placeName: 'Local C' }),
      row({ objectId: 'd', kind: 'refund_invoice_not_canceled', placeName: 'Local D' }),
      row({ objectId: 'e', kind: 'charge_overdue', placeName: 'Local E' }),
    ],
    checkedAt: '2026-10-07T15:30:00Z',
    viewerIsAdmin: true,
  })
  const component = await mountPage(mount)

  await expect(component.getByText('Nota com erro: IM do prestador inválida')).toBeVisible()
  await expect(component.getByText('Cancelamento da nota negado: prazo vencido')).toBeVisible()
  await expect(component.getByText('Paga sem nota fiscal')).toBeVisible()
  await expect(component.getByText('Reembolsada, nota ainda ativa')).toBeVisible()
  await expect(component.getByText('Cobrança vencida')).toBeVisible()
  // Gravidade lida pelo texto, não pela classe.
  await expect(component.getByText('Urgente', { exact: true })).toHaveCount(2)
  await expect(component.getByText('Atenção', { exact: true })).toHaveCount(3)
  // Sem endpoint de nota entregue, a ação é "Ver cobrança", não botão que não faz nada.
  await expect(component.getByRole('button', { name: F.pending.action.viewCharge })).toHaveCount(5)
  // Ordem como veio da API.
  const places = await component.locator('tbody tr td:nth-child(3)').allInnerTexts()
  expect(places.map((p: string) => p.trim())).toEqual(['Local A', 'Local B', 'Local C', 'Local D', 'Local E'])
  // Contador do menu bate com as linhas.
  const menu = component.getByRole('button', { name: new RegExp(`^${F.sections.pending}\\s+5$`) })
  await expect(menu).toBeVisible()
  expect(await component.locator('tbody tr').count()).toBe(5)
})

const PAYOUTS = [
  row({ objectId: 'p1', kind: 'payout_not_released', severity: 'critical', periodMonth: '2026-08-01', referenceDate: '2026-09-10', placeName: 'Local P1' }),
  row({ objectId: 'p2', kind: 'payout_failed', severity: 'critical', detail: 'chave Pix recusada', placeName: 'Local P2' }),
  row({ objectId: 'p3', kind: 'payout_period_not_calculated', periodMonth: '2026-09-01', placeName: 'Local P3' }),
]

test('BR-B2B-044 #902: o editor não vê botão nas linhas de repasse — vê "Só admin"', async ({ mount, page }) => {
  await mockAll(page)
  await mockPending(page, 200, { items: PAYOUTS, checkedAt: '2026-10-07T15:30:00Z', viewerIsAdmin: false })
  const component = await mountPage(mount)

  await expect(component.getByText('Repasse falhou: chave Pix recusada')).toBeVisible()
  await expect(component.getByText(F.pending.action.adminOnly)).toHaveCount(2)
  await expect(component.getByText('Repasse de 08/2026 a liberar até 10/09')).toBeVisible()
})

test('BR-B2B-044 #902: o admin vê a ação nas linhas de repasse e nenhum "Só admin"', async ({ mount, page }) => {
  await mockAll(page)
  await mockPending(page, 200, { items: PAYOUTS, checkedAt: '2026-10-07T15:30:00Z', viewerIsAdmin: true })
  const component = await mountPage(mount)

  await expect(component.getByText(F.pending.action.adminOnly)).toHaveCount(0)
  await expect(component.getByRole('button', { name: F.pending.action.viewPayouts })).toHaveCount(3)
})
