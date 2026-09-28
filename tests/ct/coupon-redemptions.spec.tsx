/**
 * Redemptions list — card #787, spec `docs/design/spec-cms-resgates-de-cupom-2026-09.md`.
 *
 * BR-MONETIZACAO-047: a redemption grants hours OR days, and the page never adds the two into one
 * number. Each row prints its own unit; the hours card and the days card total apart; the days
 * card is absent when the filter holds no redemption in days.
 *
 * Run with: npx playwright test -c playwright-ct.config.ts coupon-redemptions
 */
import { test, expect } from '@playwright/experimental-ct-react'
import { RedemptionsHarness } from './coupon-redemptions-helpers'
import type { CouponRedemption } from '@/lib/coupons/redemptions'

let n = 0
function row(over: Partial<CouponRedemption>): CouponRedemption {
  n += 1
  return {
    redemption_id: `r-${n}`,
    coupon_id: 'c-1',
    coupon_code: 'FAROL',
    owner_client_id: 'o-1',
    owner_name: 'Farol Tur',
    user_id: `u-${n}`,
    nickname: `turista${n}`,
    redeemed_at: '2026-09-20T12:00:00Z',
    minutes_granted: null,
    days_granted: null,
    ...over,
  }
}

const MIXED = [
  row({ minutes_granted: 600 }),
  row({ minutes_granted: 180 }),
  row({ coupon_code: 'OLD7', days_granted: 7 }),
  row({ coupon_code: 'OLD1', days_granted: 1 }),
]

test('BR-MONETIZACAO-047: each row prints its own unit, hours as `N h` and days as `N dias`', async ({ mount }) => {
  const c = await mount(<RedemptionsHarness rows={MIXED} />)
  await expect(c.getByTestId('granted')).toHaveText(['10 h', '3 h', '7 dias', '1 dia'])
})

test('BR-MONETIZACAO-047: hours and days total in separate cards, never in one number', async ({ mount }) => {
  const c = await mount(<RedemptionsHarness rows={MIXED} />)
  await expect(c.getByTestId('card-redemptions')).toContainText('4')
  await expect(c.getByTestId('card-hours')).toContainText('13 h')
  await expect(c.getByTestId('card-hours')).not.toContainText('dia')
  await expect(c.getByTestId('card-days')).toContainText('8 dias')
  await expect(c.getByTestId('card-days')).not.toContainText(' h')
})

test('BR-MONETIZACAO-047: the days card is absent when no redemption of the filter is in days', async ({ mount }) => {
  const c = await mount(<RedemptionsHarness rows={[row({ minutes_granted: 600 })]} />)
  await expect(c.getByTestId('card-hours')).toContainText('10 h')
  await expect(c.getByTestId('card-days')).toHaveCount(0)
})

test('the function not deployed yet shows a friendly empty state, in es too', async ({ mount }) => {
  const c = await mount(<RedemptionsHarness rows={[]} unavailable locale="es" />)
  await expect(c).toContainText('La lista de canjes aún no está disponible')
  await expect(c).not.toContainText('Coupons.redemptions')
})

test('an empty filter says so and offers to clear it', async ({ mount }) => {
  const c = await mount(<RedemptionsHarness rows={[]} filtered />)
  await expect(c).toContainText('Nenhum resgate para este filtro.')
  await expect(c.getByRole('button', { name: 'Limpar filtros' })).toBeVisible()
})
