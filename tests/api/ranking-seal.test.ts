/**
 * #741 — THE POSITION SEAL, PROVED WITHOUT A BROWSER.
 *
 * Spec: `docs/design/spec-selo-de-posicao-2026-09.md`, §9 "Critério de pronto". Of its fourteen
 * items, twelve can be answered here: the geometry is a pure function, the colour lives in
 * `tailwind.config.js`, and a component with no effects renders to a string
 * (`tests/api/ranking-period-label.test.ts` is the precedent). Item 2 (a human reading greyscale)
 * and item 9 (`react-native-view-shot` in the app) are not this repo's to answer.
 *
 * WHY SO MUCH OF IT IS SOURCE AND MARKUP, not behaviour: most of what the `design` decided here
 * is a line of drawing — a stroke ratio, an angle, a hex, an `aria-hidden` — and there is no
 * behaviour that comes back red when one of them is repainted. The rule of the repo for that
 * shape of claim is a test that reads what the component reads, never a constant retyped by
 * hand: if this file spelled `#C9A227` itself, repainting `tailwind.config.js` would leave every
 * assertion green with the screen wrong.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider, createTranslator } from 'next-intl'

import {
  APERTURE_ARC,
  APERTURE_CENTERS,
  CAP_HEIGHT_RATIO,
  DISC_RADIUS,
  METAL_CLASS,
  NUMERAL_BASELINE_Y,
  NUMERAL_CAP_HEIGHT,
  NUMERAL_FONT_SIZE,
  RING_PATHS,
  RING_RADIUS,
  RING_STROKE,
  RING_STROKE_RATIO,
  RankSeal,
  SEAL_SIZE_FLOOR,
  ringSegments,
  type SealCycle,
  type SealPosition,
} from '../../components/ui/RankSeal'
import { RankingScoreboard } from '../../components/dashboard/reports/RankingScoreboard'
import { UNKNOWN_VALUE } from '../../lib/format/unknown'
import {
  rankSeal,
  sealCycle,
  type PeriodOption,
  type PeriodSelection,
  type RankingRow,
} from '../../lib/ranking/scoreboard'
import { ROWS, WEEK, scrollingRows } from '../ct/ranking-fixtures'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const source = (path: string) => readFileSync(resolve(REPO_ROOT, path), 'utf8')
const messagesOf = (locale: string) =>
  JSON.parse(source(`messages/${locale}.json`)) as Record<string, any>

const LOCALES = ['pt', 'en', 'es'] as const
const POSITIONS: SealPosition[] = [1, 2, 3]
const CYCLES: SealCycle[] = ['week', 'month', 'year']
/** The scale of spec §4.1 — the CMS uses the first one and the app the other three. */
const SIZES = [20, 32, 48, 64]

/** The CMS panel in dark mode, `gray-900` — the background of §9 item 4. */
const PANEL_DARK = '#111827'

/**
 * WCAG 2.2, the same formula as `tuggi-drive-v2/src/test-utils/contrast.ts` — REIMPLEMENTED and
 * not imported, because the two repositories are separate and a relative import across them
 * breaks the type-check of both.
 */
function luminance(hex: string): number {
  const channel = (value: number) => {
    const srgb = value / 255
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16))
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

/** The palette as the COMPONENT reads it — `tailwind.config.js` is the owner (`DS-COR-001`). */
async function rankPalette(): Promise<Record<string, string>> {
  const loaded = (await import('../../tailwind.config.js')) as any
  const config = loaded.default ?? loaded
  return config.theme.extend.colors.rank as Record<string, string>
}

function renderSeal(
  position: SealPosition,
  cycle: SealCycle,
  size = SEAL_SIZE_FLOOR,
  locale: string = 'pt'
): string {
  return renderToStaticMarkup(
    // eslint-disable-next-line react/no-children-prop
    createElement(NextIntlClientProvider, {
      locale,
      messages: messagesOf(locale),
      timeZone: 'UTC',
      children: createElement(RankSeal, {
        position,
        cycle,
        size,
        label: sealLabel(locale, position),
      }),
    })
  )
}

/**
 * The accessible name EXACTLY as the table cell builds it — `t('table.seal', { rank })`, through
 * the same ICU formatter the screen uses. Writing the phrase out here instead would prove the
 * test's own Portuguese, not the repo's.
 */
function sealLabel(locale: string, rank: SealPosition): string {
  const t = createTranslator({
    locale,
    messages: messagesOf(locale),
    namespace: 'Pages.Dashboard.ranking.table',
  })
  return t('seal', { rank })
}

/** How many seals a rendered markup carries — the seal is the only 100-unit `viewBox` on screen. */
const sealCount = (html: string) => html.split('viewBox="0 0 100 100"').length - 1

// ── The geometry, which is where the brand is inherited ───────────────────────────────────

/**
 * `DS-MARCA-010` — the seal inherits CONSTRUCTION, and the construction is these four numbers.
 *
 * Spec §9 item 5. The stroke is 48,91 ÷ 441,37 of the master's ring; everything else follows
 * from it, which is what makes the outer edge of the stroke land exactly on the 50 of the
 * `viewBox` — the outline of the seal is ink, and nothing bleeds past the box.
 */
test('#741: DS-MARCA-010 — the stroke is 11.08 % of the diameter and the cap height is half the side', () => {
  assert.ok(
    Math.abs(RING_STROKE / 100 - RING_STROKE_RATIO) <= RING_STROKE_RATIO * 0.05,
    `the stroke is 0.1108 × D ± 5 %: measured ${RING_STROKE / 100}`
  )
  assert.ok(
    Math.abs(NUMERAL_CAP_HEIGHT / 100 - 0.5) <= 0.5 * 0.08,
    `the cap height is 0.50 × D ± 8 %: measured ${NUMERAL_CAP_HEIGHT / 100}`
  )

  // The ring is stroked on its centre line, so half the stroke sits outside the radius.
  assert.equal(RING_RADIUS + RING_STROKE / 2, 50)
  // And the metal stops against the inner edge — `50 − t`.
  assert.equal(DISC_RADIUS, 50 - RING_STROKE)

  // `font-size` is DERIVED from the cap height, never hand-tuned (spec §6 item 12: the baseline
  // is calculated, and `dominant-baseline` is out because the app's twin cannot match it).
  assert.ok(Math.abs(NUMERAL_FONT_SIZE * CAP_HEIGHT_RATIO - NUMERAL_CAP_HEIGHT) < 0.01)
  assert.equal(NUMERAL_BASELINE_Y, 50 + NUMERAL_CAP_HEIGHT / 2)

  // The CMS floor is the numeral's, not the ring's (spec §4.2).
  assert.equal(SEAL_SIZE_FLOOR, 20)
  assert.equal((SEAL_SIZE_FLOOR * NUMERAL_CAP_HEIGHT) / 100, 10)
})

/** Degrees clockwise from the vertical of a point on the ring — the inverse of the component's. */
function angleOf(x: number, y: number): number {
  const degrees = (Math.atan2(x - 50, 50 - y) * 180) / Math.PI
  return (degrees + 360) % 360
}

/** The two endpoints of an `M … A …` command, read back off the rendered path. */
function endpointsOf(d: string): { start: number; end: number } {
  const numbers = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number)
  const [x1, y1] = numbers.slice(0, 2)
  const [x2, y2] = numbers.slice(-2)
  return { start: angleOf(x1, y1), end: angleOf(x2, y2) }
}

/**
 * `DS-COMPONENTE-087` — THE CYCLE IS THE COUNT OF APERTURES, and nothing else changes with it.
 *
 * Spec §9 item 6. The angles are measured back off the paths the component actually renders,
 * not off the table they came from: a segment list that agrees with itself while the `A` command
 * is drawn the wrong way round would be the one failure this test exists to catch.
 */
test('#741: DS-COMPONENTE-087 — the aperture measures 32.8° at 20.0°, and the ring closes as the cycle closes', () => {
  assert.deepEqual(
    CYCLES.map((cycle) => RING_PATHS[cycle].length),
    [2, 1, 0],
    'weekly has two apertures, monthly one, yearly none'
  )

  for (const cycle of ['week', 'month'] as const) {
    const drawn = RING_PATHS[cycle].map(endpointsOf)
    const centers = [...APERTURE_CENTERS[cycle]]

    // Each aperture is the gap between where one arc ends and the next one begins.
    const apertures = drawn.map((segment, index) => {
      const next = drawn[(index + 1) % drawn.length]
      const width = (next.start - segment.end + 360) % 360
      return { width, center: (segment.end + width / 2) % 360 }
    })

    assert.equal(apertures.length, centers.length, `${cycle}: one aperture per declared centre`)

    for (const [index, aperture] of apertures.entries()) {
      assert.ok(
        Math.abs(aperture.width - APERTURE_ARC) <= 1,
        `${cycle}: the aperture measures 32.8° ± 1° — measured ${aperture.width.toFixed(2)}°`
      )
      // The apertures come out in drawing order, which starts after the first centre.
      const expected = centers[(index + 1) % centers.length]
      const off = Math.abs(((aperture.center - expected + 540) % 360) - 180)
      assert.ok(
        off <= 1,
        `${cycle}: the aperture is centred on ${expected}° ± 1° — measured ${aperture.center.toFixed(2)}°`
      )
    }

    // And what is left of the ring is the arc the master has between the apertures.
    const sweeps = ringSegments(cycle).map((segment) => segment.sweep)
    assert.deepEqual(sweeps, cycle === 'week' ? [147.2, 147.2] : [327.2])
  }

  // The yearly seal is the full turn, drawn as a circle: an SVG arc of exactly 360° starts and
  // ends on the same point and paints nothing.
  assert.match(renderSeal(1, 'year'), new RegExp(`r="${RING_RADIUS}"`))
  assert.equal(ringSegments('year').length, 0)
})

// ── The metal, which is surface and never ink ─────────────────────────────────────────────

/**
 * `DS-COR-006` — spec §9 items 3 and 4, measured over the values the COMPONENT paints with.
 *
 * The three hexes are read from `tailwind.config.js`, the owner declared in spec §7; the
 * component binds a position to one of them through `fill-rank-*` and carries no hex of its own.
 * Repainting the config therefore moves this test, which is the whole point of not retyping the
 * colour here.
 */
test('#741: DS-COR-006 — the ink clears 4.5:1 on the three metals, and the three clear 3:1 on the dark panel', async () => {
  const rank = await rankPalette()

  // The decision of 2026-09-16, as `DS-COR-006` records it. The literal is the CITATION of the
  // rule; what it guards is the config drifting away from the approved palette.
  assert.deepEqual(rank, {
    gold: '#C9A227',
    silver: '#9CA3AF',
    bronze: '#B87333',
    ink: '#0B1220',
  })

  for (const metal of ['gold', 'silver', 'bronze'] as const) {
    const onMetal = contrastRatio(rank.ink, rank[metal])
    assert.ok(
      onMetal >= 4.5,
      `${metal}: ink on metal measures ${onMetal.toFixed(2)}:1 and SC 1.4.3 asks for 4.5:1`
    )

    const onPanel = contrastRatio(rank[metal], PANEL_DARK)
    assert.ok(
      onPanel >= 3,
      `${metal}: the metal on ${PANEL_DARK} measures ${onPanel.toFixed(2)}:1 — it is what outlines the seal in the dark`
    )
  }

  // The bronze is the tight one, and it is why the rule says it does not get darkened:
  // `#A9611F` drops the ink to 3,94:1 and fails.
  assert.ok(contrastRatio(rank.ink, '#A9611F') < 4.5)
})

/**
 * `DS-COR-001`, `DS-COR-006` — ONE OWNER FOR THE COLOUR, and the seal is not it.
 *
 * A hex inside the component would be a second place the metal can be repainted, and the first
 * symptom would be a screen that disagrees with a config nobody edited.
 */
test('#741: DS-COR-001 — the seal paints through Tailwind classes and carries no hex of its own', async () => {
  const rank = await rankPalette()
  const component = source('components/ui/RankSeal.tsx')

  // The comment block cites the measured ratios, so the assertion is anchored on the syntax of a
  // colour literal in code, not on the six characters appearing in the file.
  assert.equal(
    /(fill|stroke|color)=["'{]?\s*['"]?#[0-9A-Fa-f]{6}/.test(component),
    false,
    'no literal ink: the owner of the value is tailwind.config.js'
  )

  for (const position of POSITIONS) {
    const metal = METAL_CLASS[position].replace('fill-rank-', '')
    assert.ok(rank[metal], `${METAL_CLASS[position]} points at colors.rank.${metal}`)
  }
  assert.deepEqual(
    POSITIONS.map((position) => METAL_CLASS[position]),
    ['fill-rank-gold', 'fill-rank-silver', 'fill-rank-bronze'],
    'gold, silver and bronze, in that order — the podium convention is redundant of the position'
  )

  const rendered = renderSeal(1, 'week')
  assert.match(rendered, /class="fill-rank-gold"/)
  assert.match(rendered, /class="stroke-rank-ink"/)
  assert.match(rendered, /class="fill-rank-ink"/)
})

// ── What is inside the seal, and what the reader hears ────────────────────────────────────

/**
 * `DS-COPY-063` — spec §9 items 12 and 13, and `BR-RANKING-002`.
 *
 * Inside the seal there is one Arabic digit. The accessible name is text, localized, from the
 * caller — and it carries the position and NEVER a denominator: `1º de 13` tells whoever reads
 * it how many active accounts the Tuggi has. The CMS is the internal surface where
 * `BR-RANKING-002` does not bind, but the seal is the piece that crosses to the app in #745, and
 * the denominator is precisely the part that does not cross (`DS-COMPONENTE-082` item 4).
 */
test('#741: DS-COPY-063, BR-RANKING-002 — only the digit inside the seal, and the accessible name never carries the total', () => {
  for (const cycle of CYCLES) {
    for (const position of POSITIONS) {
      const html = renderSeal(position, cycle)

      const text = html.match(/<text[^>]*>([^<]*)<\/text>/)
      assert.ok(text, `${cycle}/${position}: the seal has a numeral`)
      assert.equal(text![1], String(position), 'one Arabic digit and nothing else')

      // No ordinal indicator, in any of its spellings: the interface publishes five languages
      // and `º` is a Romance convention.
      const svg = html.slice(html.indexOf('<svg'), html.indexOf('</svg>'))
      assert.equal(/[º°]|\b(st|nd|rd|th)\b/.test(svg), false, `${cycle}/${position}: no ordinal indicator`)

      // The glyph is hidden and the name rides beside it as text (`CountryFlag.tsx`'s shape).
      assert.match(svg, /aria-hidden="true"/)
      assert.equal(/aria-label=/.test(svg), false, 'the name does not ride on the glyph')
      assert.match(html, /<span class="sr-only">/)
    }
  }

  // The name arrives in the three locales, and in none of them does a second number appear.
  for (const locale of LOCALES) {
    const template = messagesOf(locale).Pages.Dashboard.ranking.table.seal
    assert.ok(template, `${locale}: the table.seal key exists`)

    for (const rank of POSITIONS) {
      const name = sealLabel(locale, rank)
      const numbers = name.match(/\d+/g) ?? []
      assert.deepEqual(
        numbers,
        [String(rank)],
        `${locale}: the accessible name states the position and no other number — measured "${name}"`
      )
      assert.ok(name.length > String(rank).length, `${locale}: and it is a phrase, not just the digit`)
      assert.equal(/\{/.test(name), false, `${locale}: the ICU message resolved — "${name}"`)
    }
  }
})

/**
 * Spec §9 item 1 — the nine combinations render at the four sizes of the scale (§4.1).
 *
 * The seal has no runtime input beyond its two variables, so "renders" here is the whole claim:
 * one disc, the ring of the cycle, one numeral, and a box exactly `size` wide.
 */
test('#741: DS-COMPONENTE-087 — the nine combinations render at the four sizes of the scale', () => {
  for (const size of SIZES) {
    for (const cycle of CYCLES) {
      for (const position of POSITIONS) {
        const html = renderSeal(position, cycle, size)
        assert.match(html, new RegExp(`width="${size}" height="${size}"`), `${size}/${cycle}`)
        assert.match(html, /viewBox="0 0 100 100"/)
        assert.equal(
          (html.match(/<path/g) ?? []).length,
          cycle === 'year' ? 0 : APERTURE_CENTERS[cycle].length,
          `${size}/${cycle}: one arc per aperture`
        )
      }
    }
  }
})

/**
 * Spec §9 item 14 — NO IMAGE FILE, in this repository or any other.
 *
 * Nine drawings × three densities × four sizes is the file count a raster export would produce,
 * and the app has no OTA: each correction would wait for the store queue (spec §7). The seal is
 * inline geometry, so the assertion is that nothing in it points outside itself.
 */
test('#741: the seal is inline geometry — no image file enters the repository', () => {
  const component = source('components/ui/RankSeal.tsx')
  assert.equal(/\.(png|jpe?g|webp|gif|avif)/i.test(component), false, 'no raster referenced')
  assert.equal(/\bsrc=|url\(|<image\b|xlinkHref|new Image\(/.test(component), false)

  const html = renderSeal(1, 'week')
  assert.match(html, /<svg /)
  assert.equal(/<img|<image|url\(/.test(html), false, 'the seal comes out as inline SVG')
})

// ── When the seal may be drawn at all ─────────────────────────────────────────────────────

const MINUTE = 60_000
const closedWeek: PeriodOption = WEEK
const now = new Date(WEEK.end).getTime()

/**
 * `DS-COMPONENTE-088` — spec §9 item 8, at the level of the decision.
 *
 * `period_end` is EXCLUSIVE (contract `banco-para-cms.md`, Parte 7), so the instant it names is
 * the first one outside the week — which is exactly when the cycle has closed and not a minute
 * later.
 */
test('#741: DS-COMPONENTE-088 — the seal belongs to a closed cycle, and a rolling window is not a cycle', () => {
  assert.equal(sealCycle(closedWeek, now), 'week', 'the week closes on its own `period_end`')
  assert.equal(sealCycle(closedWeek, now + MINUTE), 'week')
  assert.equal(
    sealCycle(closedWeek, now - MINUTE),
    null,
    'a minute before the end, the position is still a number'
  )

  // `rolling_30d` is NOT the monthly cycle: it is calibration (`BR-RANKING-001` item 5), and the
  // monthly cycle — which ranks won weeks — is born in #742.
  for (const kind of ['rolling_30d', 'rolling_90d'] as const) {
    assert.equal(
      sealCycle({ kind, end: closedWeek.end }, now),
      null,
      `${kind}: an analysis window gets no seal`
    )
  }

  assert.equal(sealCycle(null, now), null, 'with no period served there is no closed cycle')
  assert.equal(sealCycle({ kind: 'week', end: 'not an instant' }, now), null)
})

/**
 * `DS-COMPONENTE-088`, spec §5.4 and §9 item 11 — the seal NEVER computes a position.
 *
 * It prints what the view sent, which is what makes a tie self-consistent: two `1`s produce two
 * gold seals and no silver, and nothing here has to know that happened.
 */
test('#741: DS-COMPONENTE-088 — the podium is 1, 2 and 3; the 4th prints a number and a null position prints no seal', () => {
  for (const position of POSITIONS) {
    assert.deepEqual(rankSeal(position, closedWeek, now), { position, cycle: 'week' })
  }

  for (const rank of [0, 4, 10, -1, null]) {
    assert.equal(rankSeal(rank, closedWeek, now), null, `position ${rank} gets no seal`)
  }

  // Closed cycle and podium are only correct together.
  assert.equal(rankSeal(1, closedWeek, now - MINUTE), null)
  assert.equal(rankSeal(1, { kind: 'rolling_30d', end: closedWeek.end }, now), null)
})

// ── And what the table does with all of it ────────────────────────────────────────────────

function renderTable(rows: RankingRow[], period: PeriodOption): string {
  const selection: PeriodSelection = {
    kind: period.kind,
    start: period.kind === 'week' ? period.start : null,
  }

  return renderToStaticMarkup(
    // eslint-disable-next-line react/no-children-prop
    createElement(NextIntlClientProvider, {
      locale: 'pt',
      messages: messagesOf('pt'),
      timeZone: 'UTC',
      children: createElement(RankingScoreboard, {
        rows,
        period,
        periodLabel: 'Semana de 31/08 a 06/09 · UTC',
        selection,
        served: null,
        includeInternal: false,
        internalAccounts: 0,
        isLoading: false,
        error: null,
        onRetry: () => {},
        onOpenSessions: () => {},
      }),
    })
  )
}

/** A week that CONTAINS `now` — the one the `<select>` marks as `(corrente)`. */
function currentWeek(): PeriodOption {
  const midnight = Date.now() - (Date.now() % 86_400_000)
  return {
    kind: 'week',
    start: new Date(midnight).toISOString(),
    end: new Date(midnight + 7 * 86_400_000).toISOString(),
  }
}

/**
 * `DS-COMPONENTE-088` and `DS-COMPONENTE-082` — spec §9 items 8 and 11, on the screen.
 *
 * The rows are the CT bench's own (`tests/ct/ranking-fixtures.ts`), so the table under test is
 * the one the browser bench mounts and not a shape invented here.
 */
test('#741: DS-COMPONENTE-088 — the table only draws a seal on a closed week, and only on the first three rows', () => {
  const rows = scrollingRows(12)
  rows[7] = { ...rows[7], rank_official: null, rank_excluding_internal: null, points_official: 0 }

  const closed = renderTable(rows, closedWeek)
  assert.equal(sealCount(closed), 3, 'three seals on the closed week — and only three')
  assert.match(closed, /<span class="sr-only">1º lugar<\/span>/)
  assert.match(closed, /<span class="sr-only">2º lugar<\/span>/)
  assert.match(closed, /<span class="sr-only">3º lugar<\/span>/)
  assert.equal(/sr-only">4º lugar/.test(closed), false, 'there is no seal for 4th place')

  // The 4th on prints the number as it did before (spec §4.3) …
  assert.match(closed, />\s*4\s*<\/span>/)
  // … and the account with no position prints the em dash: `null` is "does not rank", not zero.
  assert.match(closed, new RegExp(`>\\s*${UNKNOWN_VALUE}\\s*</span>`))

  // The current week is a cycle in progress: position is a number, with no seal.
  assert.equal(sealCount(renderTable(rows, currentWeek())), 0)

  // And a rolling window is not a cycle at all.
  const rolling: PeriodOption = { kind: 'rolling_30d', start: WEEK.start, end: WEEK.end }
  assert.equal(
    sealCount(renderTable(rows.map((row) => ({ ...row, period_kind: 'rolling_30d' as const })), rolling)),
    0
  )
})

/**
 * Spec §9 item 10 — THE SEAL DOES NOT MOVE THE ROW.
 *
 * The `#` cell already carries the expand button at `h-6 w-6 min-h-[24px]`, so 24 px governs the
 * height of the line; a 20 px seal cannot add a pixel to it. What this proves is the two facts
 * that make the arithmetic true: the cell keeps the class it had, and the seal's box is 20.
 */
test('#741: DS-COMPONENTE-082 — the seal does not change the height of the table row', () => {
  const closed = renderTable(scrollingRows(6), closedWeek)
  const cells = [...closed.matchAll(/<td class="([^"]*tabular-nums[^"]*pr-0)"/g)].map((m) => m[1])

  assert.ok(cells.length >= 6, 'one `#` cell per row')
  assert.equal(new Set(cells).size, 1, 'the podium cell carries the same class as the 4th place cell')
  assert.match(cells[0], /py-2\.5/, 'e continua sendo o `CELL` de `dense-table.tsx`')

  // 24 px of chevron governs the line; the seal is 20 and `shrink-0`.
  assert.match(closed, /<svg width="20" height="20"/)
  assert.ok(SEAL_SIZE_FLOOR < 24)
  assert.match(closed, /min-h-\[24px\]/)
})

/** The fixtures the CT bench uses still type-check against the table this file renders. */
test('#741: BR-RANKING-001 — the marked row stays out, and the seal follows the ruler of the `#` column', () => {
  // `ROWS` has the operator's account at `rank_official: 1` and `rank_excluding_internal: null`;
  // with the switch off it does not render, and the seal of 1st goes to the row whose
  // `rank_excluding_internal` is 1 — the same ruler the `#` column prints.
  const html = renderTable(ROWS, closedWeek)

  assert.equal(/tuggi-operator/.test(html), false, 'the marked account does not render (#740)')
  assert.equal(sealCount(html), 2, 'two visible accounts, two positions, two seals')
  assert.match(html, /<span class="sr-only">1º lugar<\/span>/)
  assert.match(html, /<span class="sr-only">2º lugar<\/span>/)
})
