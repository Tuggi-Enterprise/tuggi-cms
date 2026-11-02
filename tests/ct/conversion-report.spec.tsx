/**
 * The Conversion report (#1068, spec-cms-relatorio-conversao-2026-11 §6 and §7, the funnel chart of
 * #1069), mounted with fixtures.
 *
 * Mounts `ConversionReport` and not the page: the page only owns `?month=` and the query, and the
 * proxy needs a CMS session this bench does not have (see `playwright-ct.config.ts`).
 *
 * Run with: npx playwright test -c playwright-ct.config.ts conversion-report
 * Set CONVERSION_SHOTS=<dir> to also write the 1440 and 390 captures.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import fs from 'fs'
import path from 'path'
import { ConversionHarness as Screen } from './conversion-helpers'
import type { ConversionFunnel } from '@/lib/conversion/funnel'
import ptMessages from '@/messages/pt.json'

const C = ptMessages.Pages.Dashboard.reports.conversion
const SHOTS = process.env.CONVERSION_SHOTS

const base: ConversionFunnel = {
  month: '2026-10',
  installs: { ios: 612, android: 388, total: 1000 },
  entered: 720,
  account: 312,
  usedHours: 455,
  purchased: 61,
}

/** Width of each band against `value / max` of its own column (spec 7.3), never of the band above. */
async function bandWidths(page: import('@playwright/test').Page, keys: string[]) {
  return page.evaluate((ks) => ks.map((k) => {
    const col = document.querySelector(`[data-testid="funnel-band-col-${k}"]`)!.getBoundingClientRect().width
    const band = document.querySelector(`[data-testid="funnel-band-${k}"]`)
    return { k, col, band: band ? band.getBoundingClientRect().width : 0 }
  }), keys)
}

async function noHorizontalScroll(page: import('@playwright/test').Page) {
  const o = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }))
  expect(o.s).toBeLessThanOrEqual(o.c + 1)
}

const pct = (n: number) => new Intl.NumberFormat('pt', { style: 'percent', maximumFractionDigits: 1 }).format(n)

for (const width of [1440, 390]) {
  test(`measured month at ${width}: five bands, rates of entered, difference on the seam, no horizontal scroll`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 1000 })
    const c = await mount(<Screen funnel={base} />)
    const funnel = c.getByTestId('funnel-bands')
    const shown = (text: string) => funnel.getByText(text, { exact: true }).filter({ visible: true })
    await expect(shown('280 instalaram e não entraram')).toBeVisible()
    if (width >= 768) {
      await expect(shown('43,3% de quem entrou')).toBeVisible()
      await expect(shown('8,5% de quem entrou')).toBeVisible()
    } else {
      // below md the rate goes bare on the first line, beside the number (spec 7.2)
      await expect(shown(pct(312 / 720))).toBeVisible()
      await expect(shown(pct(61 / 720))).toBeVisible()
    }
    await expect(shown('iOS 612 · Android 388')).toBeVisible()
    await noHorizontalScroll(page)
    // at 390 no label is truncated with the final copy (spec 7.7 item 9)
    const truncated = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="conversion-funnel"] .truncate'))
        .filter((el) => (el as HTMLElement).offsetParent !== null && el.scrollWidth > el.clientWidth).map((el) => el.textContent)
    )
    expect(truncated).toEqual([])
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/conversion-${width}.png`, fullPage: true })
  })

  test(`BR-USUARIO-037 3.j at ${width}: every band is value / max of its column, one ruler, not the band above`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await mount(<Screen funnel={base} />)
    const values: Record<string, number> = { installs: 1000, entered: 720, account: 312, used_hours: 455, purchased: 61 }
    const max = 1000
    const w = await bandWidths(page, Object.keys(values))
    for (const { k, col, band } of w) {
      expect(Math.abs(band - (values[k] / max) * col), `${k}: band ${band} col ${col}`).toBeLessThanOrEqual(1)
      expect(band).toBeGreaterThanOrEqual(4)
    }
    // a guest buys without an account, so Used hours, below Account, may be wider than it
    const by = Object.fromEntries(w.map((x) => [x.k, x.band]))
    expect(by.used_hours).toBeGreaterThan(by.account)
  })
}

test('no rate between Installs and Entered, nor between steps 3, 4 and 5 (spec 7.3)', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen funnel={base} />)
  // the list is exactly: installs, seam, entered, account, used hours, purchased; nothing in between
  const items = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="funnel-bands"] > li')).map((li) => li.getAttribute('data-testid'))
  )
  expect(items).toEqual([
    'funnel-step-installs', 'funnel-seam', 'funnel-step-entered',
    'funnel-step-account', 'funnel-step-used_hours', 'funnel-step-purchased',
  ])
  // the seam prints the difference and no ratio
  const seam = await page.getByTestId('funnel-seam').innerText()
  expect(seam.trim()).toBe('280 instalaram e não entraram')
  expect(seam).not.toContain('%')
  // the bands are aria-hidden; the text is the data
  const hidden = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="funnel-band-col-"]')).every((el) => el.getAttribute('aria-hidden') === 'true')
  )
  expect(hidden).toBe(true)
})

test('Installs is hollow and dashed; steps wear the colour of their tile', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen funnel={base} />)
  const styles = await page.evaluate(() => {
    const read = (k: string) => {
      const s = getComputedStyle(document.querySelector(`[data-testid="funnel-band-${k}"]`)!)
      return { bg: s.backgroundColor, border: s.borderTopStyle }
    }
    const icon = (k: string) => {
      const svg = document.querySelector(`[data-testid="conversion-tile-${k}"] svg`)
      return svg ? getComputedStyle(svg).color : null
    }
    return {
      installs: read('installs'),
      steps: ['entered', 'account', 'used_hours', 'purchased'].map((k) => ({ k, band: read(k).bg, tile: icon(k) })),
    }
  })
  expect(styles.installs.border).toBe('dashed')
  expect(styles.installs.bg).toBe('rgba(0, 0, 0, 0)')
  const expected = { entered: 'rgb(0, 168, 232)', account: 'rgb(139, 92, 246)', used_hours: 'rgb(255, 111, 0)', purchased: 'rgb(16, 185, 129)' } as Record<string, string>
  for (const s of styles.steps) expect(s.band, s.k).toBe(expected[s.k])
})

test('DS-COMPONENTE-084 item 1: installs below entered is a floor, with no difference and a note', async ({ mount }) => {
  const c = await mount(<Screen funnel={{ ...base, installs: { ios: 300, android: 200, total: 500 } }} />)
  const floor = C.installs_floor.replace('{ios}', '300').replace('{android}', '200')
  await expect(c.getByText(floor).filter({ visible: true })).toBeVisible()
  await expect(c.getByText(C.floor_note)).toBeVisible()
  await expect(c.getByText(/instalaram e não entraram/)).toHaveCount(0)
})

test('DS-COMPONENTE-084 item 1: installs null prints the unknown mark, not 0', async ({ mount, page }) => {
  const c = await mount(<Screen funnel={{ ...base, installs: { ios: null, android: null, total: null } }} />)
  await expect(c.getByText(C.installs_unknown).filter({ visible: true })).toBeVisible()
  // the column stays at full height and empty: the grid does not jump between months
  await expect(page.getByTestId('funnel-band-installs')).toHaveCount(0)
  expect((await page.getByTestId('funnel-band-col-installs').boundingBox())!.height).toBeGreaterThan(20)
  await expect(c.getByText(/instalaram e não entraram/)).toHaveCount(0)
  if (SHOTS) {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({ path: `${SHOTS}/conversion-1440-no-ga4.png`, fullPage: true })
  }
})

test('DS-COMPONENTE-084 item 2: entered = 0 prints no rate and draws no band below the seam', async ({ mount, page }) => {
  const c = await mount(<Screen funnel={{ ...base, entered: 0, account: 0, usedHours: 0, purchased: 0 }} />)
  await expect(c.getByText(/^[0-9,]+% de quem entrou$/)).toHaveCount(0)
  await expect(c.getByText('100%')).toHaveCount(0)
  for (const k of ['entered', 'account', 'used_hours', 'purchased']) await expect(page.getByTestId(`funnel-band-${k}`)).toHaveCount(0)
})

for (const width of [1440, 390]) {
  test(`loading and loaded funnel card have the same height at ${width}`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 1000 })
    const loading = await mount(<Screen isLoading />)
    const h1 = (await page.getByTestId('conversion-funnel').boundingBox())!.height
    await loading.update(<Screen funnel={base} />)
    await expect(page.getByText('280 instalaram e não entraram')).toBeVisible()
    const h2 = (await page.getByTestId('conversion-funnel').boundingBox())!.height
    expect(Math.abs(h1 - h2), `loading ${h1} loaded ${h2}`).toBeLessThanOrEqual(1)
  })
}

test('RPC error: red box with retry, no zero printed', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const c = await mount(<Screen isError />)
  await expect(c.getByRole('alert')).toContainText(C.load_failed)
  await expect(c.getByRole('button', { name: C.retry })).toBeVisible()
  await expect(c.getByText(C.no_data)).toHaveCount(4)
  await expect(c.getByText('0', { exact: true })).toHaveCount(0)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/conversion-1440-error.png`, fullPage: true })
})

/** Route imports, walked from the page through `@/` and relative paths: no `recharts`, and the chart adds no package. */
function routeImports(entry: string, seen = new Set<string>(), pkgs = new Set<string>()) {
  if (seen.has(entry)) return pkgs
  seen.add(entry)
  const src = fs.readFileSync(entry, 'utf8')
  for (const m of src.matchAll(/^\s*import\s+(?!type\b)[^'"]*['"]([^'"]+)['"]/gm)) {
    const spec = m[1]
    const local = spec.startsWith('@/') ? path.resolve(spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(entry), spec) : null
    if (!local) { pkgs.add(spec); continue }
    const file = ['', '.tsx', '.ts', '/index.tsx', '/index.ts'].map((e) => local + e).find((f) => fs.existsSync(f) && fs.statSync(f).isFile())
    if (file) routeImports(file, seen, pkgs)
  }
  return pkgs
}

test('spec 7.7 item 8: the route pulls no recharts and FunnelBands imports no package', async () => {
  const pkgs = routeImports(path.resolve('app/[locale]/dashboard/reports/conversion/page.tsx'))
  expect([...pkgs].filter((p) => p.startsWith('recharts'))).toEqual([])
  // FunnelBands reaches only packages the CMS already declares (clsx and tailwind-merge via `cn`, lucide via `DIM`'s module)
  const declared = Object.keys(JSON.parse(fs.readFileSync('package.json', 'utf8')).dependencies)
  const own = routeImports(path.resolve('components/dashboard/reports/conversion/FunnelBands.tsx'))
  expect([...own].filter((p) => p.startsWith('recharts') || !declared.includes(p))).toEqual([])
})
