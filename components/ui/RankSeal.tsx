/**
 * THE POSITION SEAL — 1st, 2nd and 3rd, drawn from the ring of the brand.
 *
 * Spec: `docs/design/spec-selo-de-posicao-2026-09.md` (#741, epic #737), design fixed by the
 * operator on 2026-09-16. Rules: `DS-MARCA-010`, `DS-COR-006`, `DS-COMPONENTE-087`,
 * `DS-COPY-063`. WHEN it may be drawn is not this module's call — that is
 * `lib/ranking/scoreboard.ts` · `rankSeal` (`DS-COMPONENTE-088`).
 *
 * THERE IS NO ASSET, AND THAT IS THE POINT (spec §7). Nine drawings (3 positions × 3 cycles) at
 * four sizes and three densities would be 108 files that only a store release can fix on the app
 * side; as geometry, a correction is a constant in this file. The three seal PNGs that a raster
 * export would produce are exactly the kind of orphan the repo already pays for elsewhere.
 *
 * WHAT IT INHERITS FROM THE BRAND IS CONSTRUCTION, NEVER DRAWING — `DS-MARCA-010`. The stroke at
 * 11.08 % of the ring diameter and the 32.8° aperture centred on 20.0° from the vertical are
 * measured off `docs/design/marca/TUGGI_logo.svg`; the needle, the pin and the lockup are NOT
 * here and may not be (`DS-MARCA-007` items 4, 5 and 7). The aperture exists where the needle
 * passes — 20.0° against the needle's 20.1° — which is what makes the angle meaningful instead
 * of arbitrary.
 *
 * ONE AXIS OF FORM PER VARIABLE — `DS-COMPONENTE-087`. The POSITION is the numeral; the CYCLE is
 * how many apertures the ring has (two weekly, one monthly, none yearly). The metal is
 * REDUNDANT: gold against silver measures 1.05:1, so in greyscale and for most colour blindness
 * they are the same object, and the numeral is the only difference that survives 20 px (SC
 * 1.4.1). Nothing gets a second axis.
 *
 * THE METAL IS SURFACE AND THE HEX LIVES IN `tailwind.config.js` — `DS-COR-006`, `DS-COR-001`.
 * This file paints through `fill-rank-gold` / `fill-rank-silver` / `fill-rank-bronze` and
 * `fill-rank-ink` / `stroke-rank-ink`; a hex written here would be a second owner of a colour
 * that already has one.
 *
 * ONE ARTWORK SERVES LIGHT AND DARK (spec §2.3). The seal carries its own surface: on white the
 * ink ring against the page measures 18.72:1, and on the CMS panel `#111827` the ink ring
 * vanishes (1.06:1) while the metal disc takes over as the outline at 7.33 / 6.99 / 4.68:1. The
 * seal then READS about 22 % smaller, which is accepted and declared — there is no `dark:`
 * variant here on purpose.
 */

/** 1, 2 and 3. There is no fourth seal: from 4th on the cell prints the number (spec §4.3). */
export type SealPosition = 1 | 2 | 3

/** The three cycles of #737. Only `week` is reachable from the CMS today; `month` is born in #742. */
export type SealCycle = 'week' | 'month' | 'year'

/**
 * THE FLOOR IS THE NUMERAL, NOT THE RING (spec §4.2). The aperture survives 16 px — 4.58 px of
 * arc, above the ~2 px a gap needs to stay a gap (`DS-MARCA-004`) — but the cap height is
 * `0.50 × D`, so at 16 px the digit is 8 px, about an 11 px font. 10 px of cap height is the
 * floor a monitor at 100 % reads with confidence, hence `D ≥ 20` in the CMS. (The app's floor is
 * 32: sun on the screen, `tuggi-drive-v2`, spec §4.1.)
 */
export const SEAL_SIZE_FLOOR = 20

/** `48,91 ÷ 441,37` of the master, as a fraction of the ring diameter — `DS-MARCA-010`. */
export const RING_STROKE_RATIO = 0.1108

/**
 * Everything below is in the 100-unit space of the `viewBox`, so it is `× D` for free.
 *
 * The ring is drawn as a STROKED circle on its centre line, which is why the radius is 44.46 and
 * not 50: half the stroke sits outside it and the OUTER EDGE lands exactly on 50. The outline of
 * the seal is ink, with nothing bleeding past the box.
 */
export const RING_STROKE = 11.08
export const RING_RADIUS = 44.46
/** The metal stops against the inner edge of the ring — `50 − t`. */
export const DISC_RADIUS = 38.92
/** `0,50 × D` (spec §2.1). It is what `DS-COMPONENTE-087` measures at ± 8 %. */
export const NUMERAL_CAP_HEIGHT = 50

/**
 * CAP HEIGHT IS NOT FONT SIZE, and SVG only lets us set the second one.
 *
 * The CMS renders in a humanist sans (Inter, falling back on the system stack), whose cap height
 * is 1490/2048 = 0.7275 of the em; Arial, the likeliest fallback, is 0.716. 0.72 is the ratio
 * that puts both inside the ± 8 % `DS-COMPONENTE-087` allows, and `font-size` follows from it
 * instead of being a hand-tuned number nobody can re-derive later.
 */
export const CAP_HEIGHT_RATIO = 0.72
export const NUMERAL_FONT_SIZE = Number((NUMERAL_CAP_HEIGHT / CAP_HEIGHT_RATIO).toFixed(3))

/**
 * THE BASELINE IS CALCULATED, NEVER `dominant-baseline` (spec §6 item 12).
 *
 * The cap box is centred on the seal, so it runs from 25 to 75 and the baseline is its bottom.
 * The browser would honour `dominant-baseline="central"`, but the app's twin cannot —
 * `react-native-svg` supports it differently on iOS and Android — and a seal whose numeral sits
 * at a different height in the CMS and in the app is the kind of divergence that no test catches
 * and every screenshot shows.
 */
export const NUMERAL_BASELINE_Y = 50 + NUMERAL_CAP_HEIGHT / 2

/** The aperture of the master's ring, in degrees of outer arc — `DS-MARCA-010`. */
export const APERTURE_ARC = 32.8

/**
 * WHERE THE RING OPENS, in degrees clockwise from the vertical — and HOW MANY is the cycle.
 *
 * The mnemonic is `DS-COMPONENTE-087`: the ring closes as the cycle closes. Weekly keeps the
 * literal construction of the brand's ring (two apertures, 20.0° and 200.0°, two arcs of
 * 147.2°); monthly keeps one; yearly is the full turn.
 */
export const APERTURE_CENTERS: Readonly<Record<SealCycle, readonly number[]>> = {
  week: [20, 200],
  month: [20],
  year: [],
}

/**
 * The metal of each position — `DS-COR-006`. The values live in `tailwind.config.js` under
 * `colors.rank`; this map is the only place that binds a position to one of them, and it is
 * spelled out class by class so Tailwind's content scanner can see all three.
 */
export const METAL_CLASS: Readonly<Record<SealPosition, string>> = {
  1: 'fill-rank-gold',
  2: 'fill-rank-silver',
  3: 'fill-rank-bronze',
}

/** A span of ring that gets drawn, in degrees clockwise from the vertical. */
export interface RingSegment {
  start: number
  sweep: number
}

/**
 * The arcs left between the apertures. Derived from `APERTURE_CENTERS` and `APERTURE_ARC` so the
 * gap and the arc can never disagree — a hand-written 147.2 next to a 32.8 is two owners of one
 * subtraction (CLAUDE.md §6).
 *
 * `year` has no aperture and therefore no segment: the component draws a plain circle, because
 * an SVG elliptical arc of exactly 360° has the same start and end point and paints nothing.
 */
export function ringSegments(cycle: SealCycle): RingSegment[] {
  const centers = APERTURE_CENTERS[cycle]
  if (centers.length === 0) return []

  return centers.map((center, index) => {
    const start = center + APERTURE_ARC / 2
    const nextCenter = index + 1 < centers.length ? centers[index + 1] : centers[0] + 360
    return { start, sweep: Number((nextCenter - APERTURE_ARC / 2 - start).toFixed(3)) }
  })
}

/**
 * Degrees clockwise from the vertical to a point on the ring's centre line.
 *
 * `y` DECREASES upwards: the `viewBox` has y growing down, so 0° is the top of the seal and the
 * angle grows to the right — the same direction the SVG arc's `sweep-flag = 1` takes.
 */
function pointAt(degrees: number): [number, number] {
  const radians = (degrees * Math.PI) / 180
  return [
    Number((50 + RING_RADIUS * Math.sin(radians)).toFixed(3)),
    Number((50 - RING_RADIUS * Math.cos(radians)).toFixed(3)),
  ]
}

/** One segment as an `A` command. `large-arc-flag` follows the sweep; `sweep-flag` is clockwise. */
export function arcPath(segment: RingSegment): string {
  const [x1, y1] = pointAt(segment.start)
  const [x2, y2] = pointAt(segment.start + segment.sweep)
  const largeArc = segment.sweep > 180 ? 1 : 0
  return `M ${x1} ${y1} A ${RING_RADIUS} ${RING_RADIUS} 0 ${largeArc} 1 ${x2} ${y2}`
}

/** The three cycles, resolved once at module load — the geometry has no runtime input. */
export const RING_PATHS: Readonly<Record<SealCycle, readonly string[]>> = {
  week: ringSegments('week').map(arcPath),
  month: ringSegments('month').map(arcPath),
  year: ringSegments('year').map(arcPath),
}

export interface RankSealProps {
  position: SealPosition
  cycle: SealCycle
  /** Logical px; the floor is `SEAL_SIZE_FLOOR` in the CMS (spec §4.1). */
  size?: number
  /**
   * THE ACCESSIBLE NAME COMES FROM THE CALLER, ALREADY LOCALIZED — spec §5.6.
   *
   * The seal shows up in three shapes of sentence (a table cell, a Passport tile, a
   * celebration) and none of them can be written here. `DS-COPY-063`: it carries the position
   * and NEVER how many people are disputing — `1º de 13` tells anyone how many active accounts
   * the Tuggi has (#737, `BR-RANKING-002`).
   */
  label: string
}

/**
 * INSIDE THE SEAL THERE IS ONE ARABIC DIGIT AND NOTHING ELSE — `DS-COPY-063`.
 *
 * No `º`, no `°`, no `st`/`nd`/`rd`, no word: the interface publishes five languages and the
 * masculine ordinal indicator is a Romance convention that lies in `en`, `de`, `ko` and `zh`. A
 * digit is not translatable text, which is what lets one drawing serve every locale.
 *
 * The glyph is `aria-hidden` and the name rides next to it as text, the same shape
 * `CountryFlag.tsx` uses: a reader that announced the drawing AND the label would say the
 * position twice.
 */
export function RankSeal({ position, cycle, size = SEAL_SIZE_FLOOR, label }: RankSealProps) {
  return (
    <span className="inline-flex items-center">
      {/* `width`/`height` in px with the geometry in user units is also what freezes the seal
          under text scaling: at 1.4× the box and the numeral both stay put, because neither is
          expressed in `em` (spec §9 item 7). */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        className="shrink-0"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="50" cy="50" r={DISC_RADIUS} className={METAL_CLASS[position]} />

        {cycle === 'year' ? (
          <circle
            cx="50"
            cy="50"
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
            className="stroke-rank-ink"
          />
        ) : (
          RING_PATHS[cycle].map((d) => (
            <path
              key={d}
              d={d}
              fill="none"
              strokeWidth={RING_STROKE}
              strokeLinecap="butt"
              className="stroke-rank-ink"
            />
          ))
        )}

        <text
          x="50"
          y={NUMERAL_BASELINE_Y}
          textAnchor="middle"
          fontSize={NUMERAL_FONT_SIZE}
          fontWeight={700}
          className="fill-rank-ink"
        >
          {position}
        </text>
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  )
}
