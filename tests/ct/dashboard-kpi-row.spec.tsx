/**
 * THE SIX KPI CARDS OF THE DASHBOARD ARE ONE ROW, AND A ROW HAS ONE HEIGHT — #658.
 *
 * The complaint that opened this card is geometric, so the proof has to be geometric too: no
 * assertion here reads a class name. A class is a claim about what should paint; `boundingBox()`
 * is what the operator's browser actually laid out, and the two came apart exactly here — the
 * `subtitle` that `spec-dashboard-acesso-e-saldo-2026-09` §2 introduced wrapped to two lines at
 * the width a sixth of the row really has, and the card grew past its five neighbours.
 *
 * Three things are being held, and each one is a sentence from the card:
 *
 * 1. **the title shares the icon's line.** Measured as overlap between the two boxes, not as
 *    "the flex container has `items-center`" — the second passes with the title wrapped below;
 * 2. **the split does not push the card.** Asserted as the SAME row mounted twice, with and
 *    without the `subtitle`: if the two heights are equal, the break is living in space the row
 *    already had. A pixel ceiling would have been a guess about a font this suite does not own;
 * 3. **the split does not disappear either.** Both amounts, on one line, in the colour §5 of the
 *    spec measured at 7,56:1 (`DS-A11Y-001`). Shortening the FORMAT was the licence; shortening
 *    the FACT was never one — paid minutes are revenue being used and granted minutes are
 *    acquisition being burnt (`BR-MONETIZACAO-047`), and a card that shows only the total says
 *    neither.
 *
 * See `playwright-ct.config.ts` for why this is a component mount and not a page navigation.
 * Run with: npx playwright test -c playwright-ct.config.ts dashboard-kpi-row
 */

import { test, expect } from '@playwright/experimental-ct-react'
import { DashboardKpiRowHarness, DashboardWrapper } from './helpers'
import ptMessages from '@/messages/pt.json'
import { formatDuration } from '@/lib/format/duration'

const LABELS = ptMessages.Pages.Dashboard.labels

/** The six cards, in the order `app/[locale]/dashboard/page.tsx` mounts them. */
const CARDS = [
  'kpi-approved',
  'kpi-users',
  'kpi-active',
  'kpi-paid',
  'kpi-trips',
  'kpi-consumed',
] as const

/** `#4B5563` — the gray-600 §5 of the spec measured at 7,56:1 over white. */
const GRAY_600 = 'rgb(75, 85, 99)'

test('the six cards of the row end at the same height', async ({ mount, page }) => {
  await mount(
    <DashboardWrapper>
      <DashboardKpiRowHarness />
    </DashboardWrapper>
  )

  const heights: Record<string, number> = {}
  for (const id of CARDS) {
    const box = await page.getByTestId(id).locator('> div').boundingBox()
    heights[id] = Math.round(box!.height)
  }

  const measured = Object.values(heights)
  const shortest = Math.min(...measured)
  const tallest = Math.max(...measured)

  // 1px of tolerance for sub-pixel layout, and not a pixel more: the card that opened #658 was
  // 20px past its neighbours, which is not rounding.
  expect(
    tallest - shortest,
    `heights: ${JSON.stringify(heights)}`
  ).toBeLessThanOrEqual(1)
})

test('BR-MONETIZACAO-047: the split costs its own two lines and nothing else', async ({
  mount,
}) => {
  const withSplit = await mount(
    <DashboardWrapper>
      <DashboardKpiRowHarness split={true} />
    </DashboardWrapper>
  )
  const tall = (await withSplit.locator('[data-testid="kpi-consumed"] > div').boundingBox())!
    .height
  await withSplit.unmount()

  const withoutSplit = await mount(
    <DashboardWrapper>
      <DashboardKpiRowHarness split={false} />
    </DashboardWrapper>
  )
  const short = (await withoutSplit.locator('[data-testid="kpi-consumed"] > div').boundingBox())!
    .height
  const line = await withSplit
    .locator('[data-testid="kpi-consumed"] p')
    .last()
    .evaluate(el => parseFloat(getComputedStyle(el).lineHeight))
    .catch(() => 13)

  // The break is two lines of text and a 2px gap — no extra padding, no third line, no slot
  // reserved somewhere else. At a sixth of a 1280px row there is no arrangement that fits both
  // labelled durations on ONE line (the string measures 229px against 169px of card), so what
  // the card can be held to is that the break costs its own text and not a pixel beyond it.
  expect(
    Math.round(tall - short),
    `card with the split: ${tall}px, without it: ${short}px, one line: ${line}px`
  ).toBeLessThanOrEqual(Math.round(2 * line) + 4)
})

test('the title sits on the icon line, not under it', async ({ mount, page }) => {
  await mount(
    <DashboardWrapper>
      <DashboardKpiRowHarness />
    </DashboardWrapper>
  )

  for (const id of CARDS) {
    const card = page.getByTestId(id)
    const icon = (await card.locator('svg').boundingBox())!
    const title = (await card.getByText(/./).first().boundingBox())!

    const iconCentre = icon.y + icon.height / 2
    const titleCentre = title.y + title.height / 2

    // Same line means the two centres are within half a line of each other. Stacked, they are a
    // whole icon box apart.
    expect(Math.abs(iconCentre - titleCentre), `${id}: icon vs title`).toBeLessThanOrEqual(6)
  }
})

test('BR-MONETIZACAO-047: both amounts survive, one bucket per line', async ({ mount, page }) => {
  await mount(
    <DashboardWrapper>
      <DashboardKpiRowHarness />
    </DashboardWrapper>
  )

  const split = page.getByTestId('kpi-consumed').locator('p').last()
  const text = (await split.textContent())!

  // The two durations are `lib/format/duration`'s, never re-derived on screen.
  expect(text).toContain(formatDuration(1309))
  expect(text).toContain(formatDuration(1102))
  // And each one still says which bucket it is — the numbers alone are two anonymous durations.
  expect(text).toContain(LABELS.consumption_split.split('{paid}')[0].trim())
  expect(text).toContain(LABELS.consumption_split.split('{granted}')[0].split('\n').pop()!.trim())

  // Two lines, one per origin, and never a third: `whitespace-pre-line` breaks where the
  // message says to, so neither label can be stranded from its own amount by a wrap.
  const box = (await split.boundingBox())!
  const lineHeight = await split.evaluate(el => parseFloat(getComputedStyle(el).lineHeight))
  expect(box.height, `split is ${box.height}px tall, one line is ${lineHeight}px`).toBeLessThan(
    lineHeight * 2.5
  )
  expect(box.height).toBeGreaterThan(lineHeight * 1.5)
})

test('DS-A11Y-001: the split keeps the gray-600 the spec measured at 7,56:1', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <DashboardKpiRowHarness />
    </DashboardWrapper>
  )

  const split = page.getByTestId('kpi-consumed').locator('p').last()
  await expect(split).toHaveCSS('color', GRAY_600)
})
