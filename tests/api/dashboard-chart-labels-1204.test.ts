/**
 * #1204: the numbers written on the dashboard charts (operator 2026-11-19, "numbers always visible").
 * The rule is legibility: a label shrinks to 9 px before it is dropped, a dropped label is the lower
 * priority one, and the compact notation is used only when it is the narrower.
 *
 * The overlap itself (no number over a number, a tick or the card edge at 390 and 1440) is measured on
 * the rendered page; this file pins the decisions that measurement depends on.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LABEL_FONT_MAX,
  LABEL_FONT_MIN,
  centredBaseline,
  clampCentre,
  dropColliding,
  fitFont,
  labelHeight,
  labelWidth,
  narrowerFormat,
} from '../../lib/dashboard/chart-labels'

const box = (x: number, y: number, priority: number, width = 12) => ({ x, y, width, height: labelHeight(LABEL_FONT_MIN), priority })

test('#1204: the width estimate errs wide of what Chromium measured (a digit at 9 px is 6 px)', () => {
  assert.ok(labelWidth('72', 9) >= 12)
  assert.ok(labelWidth('≥ 37', 9) >= 21)
  assert.ok(labelWidth('1.480', 9) < labelWidth('14800', 9), 'a separator is narrower than a digit')
})

test('#1204: the font shrinks before anything is dropped, never under 9 px', () => {
  assert.equal(fitFont(['12', '9'], 40), LABEL_FONT_MAX)
  const tight = labelWidth('200', LABEL_FONT_MIN)
  assert.equal(fitFont(['200'], tight), LABEL_FONT_MIN)
  assert.equal(fitFont(['200'], tight - 1), null)
})

test('#1204: of two colliding labels the higher priority stays, and the order of the rest is kept', () => {
  const kept = dropColliding([box(10, 50, 1), box(16, 50, 5), box(60, 50, 0)])
  assert.deepEqual(
    kept.map((b) => b.x),
    [16, 60]
  )
})

test('#1204: a tie keeps the first, so the first hour of a tied peak keeps its number', () => {
  const kept = dropColliding([box(10, 50, 3), box(16, 50, 3)])
  assert.deepEqual(
    kept.map((b) => b.x),
    [10]
  )
})

test('#1204: labels side by side at different heights both stay when their boxes clear', () => {
  const h = labelHeight(LABEL_FONT_MIN)
  assert.equal(dropColliding([box(10, 50, 1), box(16, 50 - h - h / 4 - 2, 0)]).length, 2)
  assert.equal(dropColliding([box(10, 50, 1), box(16, 50 - h / 2, 0)]).length, 1)
})

test('#1204: a label at the edge of the plot is pulled inside it, never over the y axis', () => {
  assert.equal(clampCentre(2, 20, 0, 300), 10)
  assert.equal(clampCentre(298, 20, 0, 300), 290)
  assert.equal(clampCentre(150, 20, 0, 300), 150)
})

test('#1204: the number inside a segment sits on its middle', () => {
  assert.ok(centredBaseline(100, 10) > 100)
  assert.ok(centredBaseline(100, 10) - labelHeight(10) < 100)
})

test('#1204: the compact notation is used only when the full number does not fit and compact is narrower', () => {
  const pt = new Intl.NumberFormat('pt-BR')
  const ptCompact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })
  const full = (v: number) => pt.format(v)
  const compact = (v: number) => ptCompact.format(v)
  // Three digits fit a 27 px band at 390: full.
  assert.equal(narrowerFormat([120, 980], 27, full, compact)(980), '980')
  // Four digits do not fit 20 px, but "2,1 mil" is wider than "2.140": still full.
  assert.equal(narrowerFormat([2140], 20, full, compact)(2140), '2.140')
  // Millions: "2,1 mi" is narrower than "2.140.000".
  assert.equal(narrowerFormat([2140000], 20, full, compact)(2140000), compact(2140000))
  // In English "2.1K" is narrower than "2,140" already at four digits.
  const en = new Intl.NumberFormat('en')
  const enCompact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
  assert.equal(
    narrowerFormat([2140], 20, (v) => en.format(v), (v) => enCompact.format(v))(2140),
    '2.1K'
  )
})
