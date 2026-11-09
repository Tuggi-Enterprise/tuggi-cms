'use client'

import type { ReactNode } from 'react'
import { Lightbulb } from 'lucide-react'

import { WidgetCard } from '@/components/dashboard/WidgetCard'
import { DIM } from '@/components/ui/dense-table'
import { cn } from '@/lib/utils'

/**
 * The shell of every question block of the Engagement page (#1161, spec Parte E §E3): the question as a
 * heading, the answer in one or two sentences, the line that says who is counted and from which source,
 * then the numbers, the chart, its legend and a hint. The title is a sentence, not a label, so no
 * `SectionHeader`. One shell for all blocks: a second one must not be born.
 */

export interface QuestionLegendItem {
  key: string
  label: string
  color: string
  /** Hollow disc: a series drawn as an outline. */
  hollow?: boolean
  hint?: string
}

export interface QuestionCardProps {
  id: string
  testId: string
  title: string
  /** Badges on the right of the title: GA4 when the whole block is GA4. */
  badges?: ReactNode
  /** The answer sentence; `undefined` while loading, `null` when the block has none to state. */
  answer?: ReactNode | null
  base?: ReactNode
  stats?: ReactNode
  chart?: ReactNode
  legend?: QuestionLegendItem[]
  hint?: string
  children?: ReactNode
}

export function QuestionCard({ id, testId, title, badges, answer, base, stats, chart, legend, hint, children }: QuestionCardProps) {
  const headingId = `${id}-title`
  return (
    <section id={id} className="scroll-mt-6 min-w-0" data-testid={testId} aria-labelledby={headingId}>
      <WidgetCard>
        <div className="flex items-start justify-between gap-3">
          <h2 id={headingId} className="text-base lg:text-lg font-bold leading-6 text-gray-900 dark:text-white">
            {title}
          </h2>
          {badges && <span className="flex shrink-0 gap-1.5">{badges}</span>}
        </div>
        {answer === undefined ? (
          <div className="mt-1 h-5 w-3/4 animate-pulse rounded bg-gray-100 dark:bg-gray-800" data-testid="question-answer-loading" />
        ) : answer === null ? null : (
          <p className="mt-1 max-w-prose text-sm leading-5 text-gray-800 dark:text-gray-200" data-testid="question-answer">
            {answer}
          </p>
        )}
        {base && (
          <p className={cn('mt-1 text-[11px] leading-4', DIM)} data-testid="question-base">
            {base}
          </p>
        )}
        {stats && <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 lg:grid-cols-3">{stats}</div>}
        {children}
        {chart && <div className="mt-4">{chart}</div>}
        {legend && legend.length > 1 && (
          <ul className={cn('mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]', DIM)} data-testid="question-legend">
            {legend.map((l) => (
              <li key={l.key} className="flex items-center gap-1.5" title={l.hint}>
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={l.hollow ? { border: `1.5px solid ${l.color}` } : { backgroundColor: l.color }}
                />
                {l.label}
              </li>
            ))}
          </ul>
        )}
        {hint && (
          <p className={cn('mt-3 flex items-start gap-1.5 text-[11px] leading-4', DIM)} data-testid="question-hint">
            <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{hint}</span>
          </p>
        )}
      </WidgetCard>
    </section>
  )
}

export default QuestionCard
