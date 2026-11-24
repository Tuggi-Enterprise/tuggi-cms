/**
 * Value labels written on the dashboard charts (#1204, operator 2026-11-19: "numbers always visible, for
 * a quick read"). Pure geometry, apart from recharts: the chart modules measure the plot with recharts'
 * scale hooks and ask here which font fits and which label stays.
 *
 * The rule is legibility: no number over another number, an axis tick or the card edge. A label first
 * shrinks (down to 9 px) and is dropped only when even that collides, higher priority first.
 */

export const LABEL_FONT_MAX = 10
export const LABEL_FONT_MIN = 9

/**
 * Width of a bold label in px, estimated per character in em of the font size. Measured in Chromium on
 * the CMS sans at weight 900: a digit is 0.65 to 0.67 em, "≥ 37" at 9 px is 21 px. The estimate errs
 * wide so a label that "fits" does fit.
 */
export function labelWidth(text: string, fontSize: number): number {
  let em = 0
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') em += 0.7
    else if (ch === '.' || ch === ',' || ch === ' ' || ch === '\u00a0' || ch === '\u202f') em += 0.34
    else em += 0.75
  }
  return em * fontSize
}

/**
 * Height of a label's box above its baseline, px: the box the browser reports (one em), not the ink, so
 * that two boxes apart are two numbers apart. The box also reaches a quarter of that below the baseline.
 */
export function labelHeight(fontSize: number): number {
  return fontSize
}

/** Offset from the middle of a shape to the baseline that centres a line of digits in it (digit ink is about 0.72 em). */
export function centredBaseline(middle: number, fontSize: number): number {
  return middle + fontSize * 0.36
}

/** The largest font from max down to min at which every text fits in `room` px; `null` when not even min does. */
export function fitFont(texts: readonly string[], room: number, max = LABEL_FONT_MAX, min = LABEL_FONT_MIN): number | null {
  for (let fs = max; fs >= min; fs--) {
    if (texts.every((t) => labelWidth(t, fs) <= room)) return fs
  }
  return null
}

/** A label to place: `x` is its centre, `y` its baseline; the box spans `height` above it and a quarter of that below. */
export interface LabelBox {
  x: number
  y: number
  width: number
  height: number
  /** Higher stays first when two collide. */
  priority: number
}

function overlaps(a: LabelBox, b: LabelBox, gap: number): boolean {
  return (
    a.x - a.width / 2 < b.x + b.width / 2 + gap &&
    b.x - b.width / 2 < a.x + a.width / 2 + gap &&
    a.y - a.height < b.y + b.height / 4 + gap &&
    b.y - b.height < a.y + a.height / 4 + gap
  )
}

/**
 * The labels that stay: highest priority first, each kept only when it overlaps none already kept
 * (`gap` px of air around each). Ties keep the input order. The result keeps the input order.
 */
export function dropColliding<T extends LabelBox>(boxes: readonly T[], gap = 1): T[] {
  const order = boxes.map((b, i) => ({ b, i })).sort((p, q) => q.b.priority - p.b.priority || p.i - q.i)
  const kept: Array<{ b: T; i: number }> = []
  for (const p of order) if (!kept.some((k) => overlaps(k.b, p.b, gap))) kept.push(p)
  return kept.sort((p, q) => p.i - q.i).map((k) => k.b)
}

/** The centre that keeps a label of `width` inside [left, right]. */
export function clampCentre(x: number, width: number, left: number, right: number): number {
  return Math.min(Math.max(x, left + width / 2), right - width / 2)
}

/**
 * The number format whose widest label is narrower, between the full one and the compact one: compact
 * only when the full one does not fit and compact is narrower. In pt the full number stays narrower up
 * to six digits ("2.140" against "2,1 mil"); in en "2.1K" wins at four.
 */
export function narrowerFormat(
  values: readonly number[],
  room: number,
  full: (v: number) => string,
  compact: (v: number) => string
): (v: number) => string {
  const widest = (f: (v: number) => string) => Math.max(0, ...values.map((v) => labelWidth(f(v), LABEL_FONT_MIN)))
  const a = widest(full)
  if (a <= room) return full
  return widest(compact) < a ? compact : full
}
