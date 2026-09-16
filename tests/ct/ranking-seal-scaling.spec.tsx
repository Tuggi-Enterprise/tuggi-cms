/**
 * SPEC §9 ITEM 7, MEASURED IN A BROWSER — #741.
 *
 * `docs/design/spec-selo-de-posicao-2026-09.md` §9 item 7: "Com a fonte do sistema em 1,4×, a
 * caixa do numeral não muda e nada transborda o anel." `tests/api/ranking-seal.test.ts` proves
 * twelve of the fourteen items of the critério de pronto without a browser, and its own header
 * names the two it cannot — item 7 is one of them, because it is a claim about what a real
 * Chromium does to layout, not about the component's markup. The card that asked for this file
 * records the seal's author arguing the item true by construction — `width`/`height` in px,
 * `fontSize` a plain SVG number, neither expressed in `em` — and explicitly NOT measuring it.
 * This file measures it.
 *
 * THE MECHANISM. Playwright has no emulation option for an OS text-size setting (checked against
 * playwright.dev/docs/emulation on 1.62.1: viewport, colour scheme, locale, media type, forced
 * colours — none of them touch font size). The browser feature the spec's "fonte do sistema"
 * refers to is the one Chromium itself exposes at `chrome://settings/fonts` — a default font
 * size that flows through `rem`/`%`-relative CSS and leaves `px`-fixed values alone, which is
 * exactly the boundary `DS-COMPONENTE-087` draws around the seal. The standard way to reproduce
 * that boundary in a test is to override the ROOT element's font-size (`document.documentElement
 * .style.fontSize`), because `rem` is defined relative to it — not `page.setViewportSize`, which
 * would scale everything, `px` included, and prove nothing about this specific claim.
 *
 * `CONTROL_TEXT_TESTID` (`ranking-seal-grid.tsx`) and the `td` font-size read below are the
 * canary in both tests: `text-sm` is `0.875rem`, one of the Tailwind utilities the harness and
 * `dense-table.tsx`'s `CELL` both use, and it MUST grow when the override lands. A canary that
 * does not move means the override did nothing, and every "unchanged" assertion beside it would
 * be vacuously true — the class of test this repo already got burned by once.
 *
 * Run with: npx playwright test -c playwright-ct.config.ts ranking-seal-scaling
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import { RING_RADIUS, RING_STROKE } from '@/components/ui/RankSeal'
import { DashboardWrapper } from './helpers'
import { RankingScoreboardHarness } from './ranking-helpers'
import { scrollingRows, WEEK } from './ranking-fixtures'
import { RankSealGrid } from './ranking-seal-grid'
import {
  CONTROL_TEXT_TESTID,
  SEAL_GRID_CYCLES,
  SEAL_GRID_POSITIONS,
  SEAL_GRID_SIZES,
  sealTestId,
} from './ranking-seal-grid-constants'

const BASE_FONT_PX = 16
const SCALE = 1.4
const SCALED_FONT_PX = Number((BASE_FONT_PX * SCALE).toFixed(3)) // 22.4 — the spec's "1,4×"

/** `null` restores the browser default instead of pinning a second literal `16px` somewhere. */
async function setRootFontSize(page: Page, px: number | null) {
  await page.evaluate((value) => {
    document.documentElement.style.fontSize = value === null ? '' : `${value}px`
  }, px)
}

async function computedFontPx(page: Page, testId: string): Promise<number> {
  return page
    .getByTestId(testId)
    .evaluate((element) => parseFloat(getComputedStyle(element).fontSize))
}

interface SealBox {
  outer: { width: number; height: number }
  glyph: { x: number; y: number; width: number; height: number }
}

async function measureSeal(page: Page, testId: string): Promise<SealBox> {
  const cell = page.getByTestId(testId)
  const svgBox = (await cell.locator('svg').boundingBox())!
  const glyph = await cell.locator('svg text').evaluate((node) => {
    // `getBBox()` is the glyph's PAINTED outline, in the SVG's own user-unit space (0–100 of the
    // `viewBox`) — it answers "did the ink move", which a CSS box never would for text.
    const box = (node as SVGTextElement).getBBox()
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  })
  return { outer: { width: svgBox.width, height: svgBox.height }, glyph }
}

test('DS-COMPONENTE-087 spec §9 item 7: at 1,4× the seal box stays put and the numeral does not cross the ring, in the nine combinations at the four sizes', async ({
  mount,
  page,
}) => {
  await mount(<RankSealGrid />)

  const controlBefore = await computedFontPx(page, CONTROL_TEXT_TESTID)

  const baseline = new Map<string, SealBox>()
  for (const position of SEAL_GRID_POSITIONS) {
    for (const cycle of SEAL_GRID_CYCLES) {
      for (const size of SEAL_GRID_SIZES) {
        const id = sealTestId(position, cycle, size)
        baseline.set(id, await measureSeal(page, id))
      }
    }
  }

  await setRootFontSize(page, SCALED_FONT_PX)

  const controlAfter = await computedFontPx(page, CONTROL_TEXT_TESTID)
  expect(
    controlAfter,
    `the root font-size override did not reach Tailwind's rem utilities (${controlBefore}px → ${controlAfter}px) — every assertion below would be meaningless`
  ).toBeGreaterThan(controlBefore * 1.3)

  const ringEdge = RING_RADIUS + RING_STROKE / 2 // lands on 50 — RankSeal.tsx's own derivation

  for (const position of SEAL_GRID_POSITIONS) {
    for (const cycle of SEAL_GRID_CYCLES) {
      for (const size of SEAL_GRID_SIZES) {
        const id = sealTestId(position, cycle, size)
        const before = baseline.get(id)!
        const after = await measureSeal(page, id)

        expect(after.outer.width, `${id}: the seal's own box widened at 1,4×`).toBeCloseTo(
          before.outer.width,
          0
        )
        expect(after.outer.height, `${id}: the seal's own box grew taller at 1,4×`).toBeCloseTo(
          before.outer.height,
          0
        )

        expect(
          after.glyph.width,
          `${id}: the numeral's glyph box widened at 1,4× (${before.glyph.width.toFixed(2)} → ${after.glyph.width.toFixed(2)})`
        ).toBeCloseTo(before.glyph.width, 1)
        expect(
          after.glyph.height,
          `${id}: the numeral's glyph box grew taller at 1,4× (${before.glyph.height.toFixed(2)} → ${after.glyph.height.toFixed(2)})`
        ).toBeCloseTo(before.glyph.height, 1)

        // "Nada transborda o anel": every corner of the glyph's painted box stays inside the
        // ring's own outer edge.
        const corners: Array<[number, number]> = [
          [after.glyph.x, after.glyph.y],
          [after.glyph.x + after.glyph.width, after.glyph.y],
          [after.glyph.x, after.glyph.y + after.glyph.height],
          [after.glyph.x + after.glyph.width, after.glyph.y + after.glyph.height],
        ]
        for (const [x, y] of corners) {
          const distance = Math.hypot(x - 50, y - 50)
          expect(
            distance,
            `${id}: a corner of the numeral crosses the ring at 1,4× (${distance.toFixed(2)} > ${ringEdge.toFixed(2)})`
          ).toBeLessThanOrEqual(ringEdge)
        }
      }
    }
  }

  await setRootFontSize(page, null)
})

test('DS-COMPONENTE-082 spec §9 item 10: the podium row is no taller than the digit row, before and after the 1,4× scale', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness rows={scrollingRows(6)} period={WEEK} />
    </DashboardWrapper>
  )

  const rows = page.locator('tbody tr')
  const podiumRow = rows.nth(0) // rank_official 1 → seal (spec §4.3)
  const digitRow = rows.nth(4) // rank_official 5 → plain number, no seal from 4th on

  const controlBefore = await page
    .locator('tbody td')
    .first()
    .evaluate((element) => parseFloat(getComputedStyle(element).fontSize))

  const podiumBefore = (await podiumRow.boundingBox())!.height
  const digitBefore = (await digitRow.boundingBox())!.height
  expect(
    podiumBefore,
    `baseline: the podium row (${podiumBefore}px) is already taller than the digit row (${digitBefore}px) before any scaling`
  ).toBeCloseTo(digitBefore, 0)

  await setRootFontSize(page, SCALED_FONT_PX)

  const controlAfter = await page
    .locator('tbody td')
    .first()
    .evaluate((element) => parseFloat(getComputedStyle(element).fontSize))
  expect(
    controlAfter,
    `the row did not respond to the larger system font (${controlBefore}px → ${controlAfter}px) — the measurement below would be meaningless`
  ).toBeGreaterThan(controlBefore * 1.3)

  const podiumAfter = (await podiumRow.boundingBox())!.height
  const digitAfter = (await digitRow.boundingBox())!.height

  expect(
    podiumAfter,
    `at 1,4× the seal adds height the digit row does not have (podium ${podiumAfter}px vs digit ${digitAfter}px)`
  ).toBeCloseTo(digitAfter, 0)
  expect(
    podiumAfter,
    'the row height did not grow with the larger system font — see the canary above'
  ).toBeGreaterThan(podiumBefore)

  await setRootFontSize(page, null)
})
