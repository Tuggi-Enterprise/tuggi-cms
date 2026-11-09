/**
 * The answer sentence of each block (#1161, spec Parte E §E3.3; copy cms-relatorio-engajamento-perguntas
 * §1.1): built by rule from the numbers the block prints, never by a model, and never stating a number
 * the block does not print. Pure: it returns the copy key and the raw values; the component formats them.
 *
 * Order of decision, the same in every block (copy §1.1): the source did not exist yet, the read failed,
 * a zero base, an incomplete registrar (no comparison, then the floor sentence), measured.
 */

import type { Cell } from '@/lib/engagement/cells'
import type { DeltaState, TileDelta } from '@/lib/engagement/summary'
import type { QuestionBlock, StatKind } from '@/lib/engagement/blocks'

export type AnswerValue =
  | { kind: 'pct'; value: number }
  | { kind: 'int'; value: number }
  | { kind: 'minutes'; value: number }
  | { kind: 'km'; value: number }
  | { kind: 'month'; value: string }

/** The comparison clause `{cmp}` (copy §1.2); `null` prints an empty clause. */
export interface Comparison {
  key: string
  /** The previous month's value, formatted as the current one. */
  prev: { kind: StatKind; value: number } | null
  prevMonth: string
}

export interface Answer {
  key: string
  values: Record<string, AnswerValue>
  cmp: Comparison | null
  /** Append the floor sentence (DS-COMPONENTE-084 item 1). */
  floor: boolean
  /** The block offers a retry. */
  retry: boolean
}

/** DS-COMPONENTE-100 state to the clause of copy §1.2; `new`, `unknown` and `closes` print none. */
const CMP_KEYS: Partial<Record<DeltaState, string>> = {
  up: 'questions.common.compare_up',
  down: 'questions.common.compare_down',
  flat: 'questions.common.compare_same',
  small_base: 'questions.common.compare_sample',
  partial: 'questions.common.compare_so_far',
}

export function comparisonOf(delta: TileDelta | null, kind: StatKind): Comparison | null {
  if (!delta) return null
  const key = CMP_KEYS[delta.state]
  if (!key) return null
  const prev = delta.prev.cell
  return {
    key,
    prev: (prev.state === 'measured' || prev.state === 'floor') && prev.value !== null ? { kind, value: prev.value } : null,
    prevMonth: delta.prev.month,
  }
}

const has = (c: Cell) => (c.state === 'measured' || c.state === 'floor') && c.value !== null
const v = (c: Cell) => c.value as number
const pct = (c: Cell): AnswerValue => ({ kind: 'pct', value: v(c) })
const int = (c: Cell): AnswerValue => ({ kind: 'int', value: v(c) })
const minutes = (c: Cell): AnswerValue => ({ kind: 'minutes', value: v(c) })

/** The shared part of the decision: a block that has no number to state. */
function gate(block: QuestionBlock, month: string, noSourceKey = 'questions.common.answer_no_data_bank'): Answer | null {
  const base = { values: { month: { kind: 'month', value: month } as AnswerValue }, cmp: null, floor: false, retry: false }
  if (block.status === 'failed') return { ...base, key: 'questions.common.answer_failed', retry: true }
  if (block.status === 'no_source') return { ...base, key: noSourceKey }
  if (block.status === 'empty') return { ...base, key: `questions.${block.key}.answer_empty` }
  // Loading, or a number missing for a reason the block prints beside it: no sentence.
  return null
}

/** Measured or floor: the comparison only for a measured number (copy §1.1). */
function finish(block: QuestionBlock, key: string, values: Record<string, AnswerValue>): Answer {
  const floor = block.headline.cell.state === 'floor'
  return { key, values, cmp: floor ? null : comparisonOf(block.headline.delta, block.headline.kind), floor, retry: false }
}

/** Block 1: the share of who entered that turned the guide on the first day; then who did nothing. */
export function answerBlock1(block: QuestionBlock, month: string): Answer | null {
  const g = gate(block, month)
  if (g || !has(block.headline.cell)) return g
  const nothing = block.facts.nothing
  return has(nothing)
    ? finish(block, 'questions.block_1.answer', { pct: pct(block.headline.cell), nothing: int(nothing) })
    : finish(block, 'questions.block_1.answer_short', { pct: pct(block.headline.cell) })
}

/** Block 2: who turned the guide on, a share of who opened the app when opens are measured; then the km. */
export function answerBlock2(block: QuestionBlock, month: string): Answer | null {
  const g = gate(block, month)
  if (g || !has(block.headline.cell)) return g
  const people = block.facts.people
  if (!has(people)) return null
  const km = block.facts.km
  const share = block.headline.kind === 'rate'
  const values: Record<string, AnswerValue> = { n: int(people) }
  if (share) values.pct = pct(block.headline.cell)
  if (has(km)) values.km = { kind: 'km', value: v(km) }
  const key = share ? (has(km) ? 'questions.block_2.answer' : 'questions.block_2.answer_no_km') : has(km) ? 'questions.block_2.answer_no_opens' : 'questions.block_2.answer_no_opens_no_km'
  return finish(block, key, values)
}

/** Block 3: the median of guide time per person; then the p75 and the share off screen. */
export function answerBlock3(block: QuestionBlock, month: string): Answer | null {
  const g = gate(block, month)
  if (g || !has(block.headline.cell)) return g
  const { p75, bg } = block.facts
  if (!has(p75)) return null
  return has(bg)
    ? finish(block, 'questions.block_3.answer', { median: minutes(block.headline.cell), p75: minutes(p75), bg: pct(bg) })
    : finish(block, 'questions.block_3.answer_no_screen', { median: minutes(block.headline.cell), p75: minutes(p75) })
}

/** Block 4: the medians of the buckets the app records, the vehicle one compared. */
export function answerBlock4(block: QuestionBlock, month: string): Answer | null {
  const g = gate(block, month, 'questions.block_4.answer_no_source')
  if (g || !has(block.headline.cell)) return g
  const { walking, stopped } = block.facts
  if (!has(walking) || !has(stopped)) return null
  return finish(block, 'questions.block_4.answer_medians', { vehicle: minutes(block.headline.cell), walk: minutes(walking), still: minutes(stopped) })
}

const ANSWERS = { block_1: answerBlock1, block_2: answerBlock2, block_3: answerBlock3, block_4: answerBlock4 } as const

export function answerOf(block: QuestionBlock, month: string): Answer | null {
  return ANSWERS[block.key](block, month)
}

/**
 * The first sentence of a rendered answer, the line the month summary reuses (copy §2 item 5): up to the
 * first full stop followed by a space or the end. A decimal point is never followed by a space.
 */
export function firstSentence(text: string): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(text)
  return m ? m[1] : text
}
