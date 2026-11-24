/**
 * #1242 — the host of an event can be a POI or a place (operator decision, 2026-11-23; it
 * changes item 1 of BR-EVENTO-001, which still says POI only).
 *
 * Real Chromium, the real `VenuePicker`; the network is `page.route` over the Supabase fixture
 * host (`playwright-ct.config.ts`). The two RPCs the picker asks are answered with one row each,
 * so the dropdown has to offer both, each tagged with its kind, and picking the place has to hand
 * back the place's id.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page, Route } from '@playwright/test'
import { VenuePickerHost } from './venue-picker-1242-helpers'

const POI_ID = '11111111-1111-4111-8111-111111111111'
const PLACE_ID = '22222222-2222-4222-8222-222222222222'

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function stubSearches(page: Page, opts: { poisFail?: boolean } = {}) {
  // `poiService` builds its cache key with `Buffer`, which Next provides to the browser bundle
  // and Vite does not. Only `from(text).toString('base64')` is ever called. `evaluate`, not
  // `addInitScript`: the CT page is already loaded when the test starts.
  await page.evaluate(() => {
    ;(globalThis as { Buffer?: unknown }).Buffer ??= {
      from: (text: string) => ({ toString: () => btoa(unescape(encodeURIComponent(text))) }),
    }
  })
  await page.route('**/rest/v1/rpc/cms_list_pois', (r) =>
    opts.poisFail
      ? json(r, { message: 'boom', code: 'XX000' }, 500)
      : json(r, [{ id: POI_ID, name: 'Igreja Matriz', city: 'Búzios', approved: true }]),
  )
  await page.route('**/rest/v1/rpc/cms_poi_facets', (r) => json(r, [{ total_count: 1 }]))
  await page.route('**/rest/v1/rpc/cms_list_places', (r) =>
    json(r, [{ id: PLACE_ID, name: 'Bar da Praia', city: 'Búzios', tags: [], total_count: 1 }]),
  )
}

test('BR-EVENTO-001 (#1242): the host picker offers a POI and a place, each with its kind', async ({ mount, page }) => {
  await stubSearches(page)
  const c = await mount(<VenuePickerHost />)

  await c.getByPlaceholder('Buscar POI ou local por nome…').fill('bu')

  const poi = c.getByRole('button', { name: /Igreja Matriz/ })
  const place = c.getByRole('button', { name: /Bar da Praia/ })
  await expect(poi).toBeVisible()
  await expect(place).toBeVisible()
  await expect(poi.getByTestId('venue-kind')).toHaveText('POI')
  await expect(place.getByTestId('venue-kind')).toHaveText('Local')

  await place.click()
  await expect(c.getByTestId('picked')).toHaveText(`place:${PLACE_ID}`)
  await expect(c.getByTestId('venue-kind')).toHaveText('Local')
})

test('#1242: a failed POI search still shows the places that matched', async ({ mount, page }) => {
  await stubSearches(page, { poisFail: true })
  const c = await mount(<VenuePickerHost />)

  await c.getByPlaceholder('Buscar POI ou local por nome…').fill('bar')

  await expect(c.getByRole('button', { name: /Bar da Praia/ })).toBeVisible()
  await expect(c.getByRole('button', { name: /Igreja Matriz/ })).toHaveCount(0)
})
