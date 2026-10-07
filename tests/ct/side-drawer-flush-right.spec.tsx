/**
 * #870 (operator 2026-10-06) — every side drawer of the Studio sits flush against the right edge
 * of the window: the client record, the POI management and the portal validation.
 *
 * WHY EACH ONE IS MOUNTED INSIDE `cms-width`. That is the host shape that broke it: `/pois` renders
 * `POIDetailsModal` as a direct child of its `cms-width` shell, and `app/globals.css` caps those
 * children at 1600px with `margin-inline: auto`. The fixed backdrop became a centred 1600px box and
 * the panel, flush with IT, left a 160px band at 1920. At 1280 nothing showed (100% < 1600), which
 * is why both widths are measured here.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { ClientEditorModal } from '@/components/admin/clients/ClientEditorModal'
import { PoiDrawerHost } from './side-drawer-hosts'
import { ValidationModal } from '@/components/admin/partner-proposals/ValidationModal'

const NOOP = () => {}

async function mockApi(page: Page) {
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'sub-1',
        status: 'in_review',
        answers: { trade_name: 'Padaria Santa Clara', category: 'restaurant', city: 'Gramado', state: 'RS', plan_choice: 'free' },
        submittedAt: '2026-10-01T12:00:00Z',
        statusChangedAt: '2026-10-01T12:00:00Z',
        attractionId: null,
        clientId: null,
        acceptance: null,
        payment: null,
        history: [],
        sameTaxId: [],
        nextInReviewId: null,
        photos: [],
      }),
    })
  )
}

const DRAWERS = {
  'client record': () => <ClientEditorModal isOpen mode="new" onClose={NOOP} />,
  'POI management': () => <PoiDrawerHost />,
  'portal validation': () => (
    <ValidationModal locale="pt" submissionId="sub-1" returnTo="/admin/clients" onClose={NOOP} />
  ),
} as const

for (const width of [1280, 1920]) {
  for (const [name, drawer] of Object.entries(DRAWERS)) {
    test(`${name} at ${width}px: backdrop covers the window and the panel touches the right edge`, async ({
      mount,
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await mockApi(page)
      await mount(
        <NextIntlClientProvider locale="pt" messages={ptMessages}>
          <div className="cms-width min-h-screen">{drawer()}</div>
        </NextIntlClientProvider>
      )
      // The backdrop is the `fixed inset-0` layer; the panel is its child.
      const backdrop = page.locator('.cms-width > .fixed.inset-0').first()
      await expect(backdrop).toBeVisible()
      // The slide-in animation moves the panel; measure where it lands.
      await page.waitForTimeout(400)
      const geometry = await backdrop.evaluate((layer) => {
        const p = (layer.firstElementChild as HTMLElement).getBoundingClientRect()
        const b = layer.getBoundingClientRect()
        return { panelRight: p.right, panelWidth: p.width, backdropLeft: b.left, backdropRight: b.right }
      })
      const viewport = await page.evaluate(() => document.documentElement.clientWidth)
      expect(geometry.backdropLeft).toBe(0)
      expect(geometry.backdropRight).toBe(viewport)
      expect(Math.round(geometry.panelRight)).toBe(viewport)
      // 85vw on a monitor — the dimension `POIDetailsModal` set and the other two follow.
      expect(Math.round(geometry.panelWidth)).toBe(Math.round(width * 0.85))
    })
  }
}
