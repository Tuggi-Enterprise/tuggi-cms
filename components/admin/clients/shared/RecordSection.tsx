'use client'

/**
 * A section card of a record tab — the white `rounded-3xl` card with the eyebrow `SectionHeader`
 * that `ProfileTab`, `ContractTab` and the other client tabs draw. `aside` sits at the right of
 * the eyebrow (a badge, a link). Used by the portal validation and the proposal conference
 * (#870), so their content reads in the same shape as the client record.
 */

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { SectionHeader, type SectionHeaderColor } from './SectionHeader'

export const RECORD_CARD =
  'bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-5 lg:p-8 shadow-sm'

/** The two-column grid of fields every client tab uses. */
export const FIELD_GRID = 'grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-10'

interface RecordSectionProps {
  icon: ReactNode
  title: string
  color?: SectionHeaderColor
  aside?: ReactNode
  className?: string
  children: ReactNode
}

export function RecordSection({ icon, title, color, aside, className, children }: RecordSectionProps) {
  return (
    <section className={cn(RECORD_CARD, className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-3">
        <SectionHeader icon={icon} title={title} color={color} />
        {aside}
      </div>
      {children}
    </section>
  )
}
