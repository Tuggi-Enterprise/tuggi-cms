/**
 * #922 (BR-B2B-061 item 2): the queue of the portal's photo and text changes, what is on the air
 * and the proposal side by side, Approve, and Refuse with a reason. Mounted as a component (see
 * `playwright-ct.config.ts`); the capture goes to `test-results/922/`.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import { Wrapper } from './helpers'
import { PlaceChangesView } from '@/components/admin/AdminPlaceChangesPageContent'
import ptMessages from '@/messages/pt.json'

const T = ptMessages.Clients.placeChanges
const svg = (color: string, label: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#${color}"/><text x="20" y="280" font-family="sans-serif" font-size="26" fill="#fff">${label}</text></svg>`)}`

const ROWS = [
  {
    requestId: '11111111-2222-4333-8444-000000000001',
    submissionId: 'bbbbbbbb-2222-4333-8444-555555555555',
    attractionId: 'aaaaaaaa-2222-4333-8444-555555555555',
    placeName: 'Casa do Vale Açaí',
    city: 'Cabo Frio',
    kind: 'photo' as const,
    slot: 0,
    photoPath: 'x',
    photoUrl: svg('e8a33d', 'nova fachada'),
    proposedText: null,
    currentValue: svg('1f6f8b', 'fachada no ar'),
    liveValue: null,
    storyEntitled: true,
    requestedAt: '2026-10-08T12:00:00Z',
  },
  {
    requestId: '11111111-2222-4333-8444-000000000002',
    submissionId: 'bbbbbbbb-2222-4333-8444-555555555555',
    attractionId: 'aaaaaaaa-2222-4333-8444-555555555555',
    placeName: 'Casa do Vale Açaí',
    city: 'Cabo Frio',
    kind: 'text' as const,
    slot: null,
    photoPath: null,
    photoUrl: null,
    proposedText: 'Desde 1998 a Casa do Vale bate o açaí na hora. Peça a tigela com cupuaçu e granola da casa, servida na varanda que dá para o canal.',
    currentValue: 'Desde 1998 a Casa do Vale bate o açaí na hora, com fruta do Pará. Quem passa na Passagem sente o cheiro da granola caseira e entra.',
    liveValue: null,
    storyEntitled: true,
    requestedAt: '2026-10-08T13:00:00Z',
  },
]

test('#922 BR-B2B-061 item 2: a foto e o texto pendentes, no ar e proposto lado a lado (1440)', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const decided: unknown[] = []
  const c = await mount(
    <Wrapper>
      <div className="bg-gray-50/50 p-8">
        <PlaceChangesView rows={ROWS} loading={false} error={null} unavailable={false} notice={null} cards={{}} onDecide={(r, d) => decided.push([r.requestId, d])} />
      </div>
    </Wrapper>
  )
  await expect(c.getByText(T.facade)).toBeVisible()
  await expect(c.getByText(T.text, { exact: true })).toBeVisible()
  await expect(c.getByRole('img', { name: `${T.facade}, ${T.live}` })).toBeVisible()
  await expect(c.getByRole('img', { name: `${T.facade}, ${T.proposed}` })).toBeVisible()
  await expect(c.getByText(T.textNote)).toBeVisible()
  await page.screenshot({ path: 'test-results/922/fila-1440.png', fullPage: true })

  // Recusar pede o motivo antes de decidir.
  const text = c.locator('[data-change="11111111-2222-4333-8444-000000000002"]')
  await text.getByRole('button', { name: T.refuse }).click()
  await text.getByRole('button', { name: T.refuseConfirm }).click()
  await expect(text.getByText(T.errors.note_required)).toBeVisible()
  expect(decided).toEqual([])
  await text.getByLabel(T.noteLabel).fill('Tem preço no texto.')
  await page.screenshot({ path: 'test-results/922/fila-recusar-1440.png', fullPage: true })
  await text.getByRole('button', { name: T.refuseConfirm }).click()
  await c.locator('[data-change="11111111-2222-4333-8444-000000000001"]').getByRole('button', { name: T.approve }).click()
  expect(decided).toEqual([
    ['11111111-2222-4333-8444-000000000002', { decision: 'rejected', note: 'Tem preço no texto.' }],
    ['11111111-2222-4333-8444-000000000001', { decision: 'approved' }],
  ])
})
