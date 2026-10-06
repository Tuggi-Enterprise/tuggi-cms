'use client'

/**
 * THE TABS OF A RECORD, one list rendered twice and never two lists: a 288px sidebar on a monitor
 * (eyebrow, tabs, and a footer pinned to its bottom) and a strip that scrolls sideways on a phone.
 *
 * Extracted from `ClientEditorModal` for #870 ("todos os cadastros precisam ser iguais"): the
 * portal validation (`ValidationReview`) and the proposal conference (`ProposalReview`) render
 * the same tabs, so the three records cannot drift apart in shape. It goes inside `RecordShell`'s
 * body, before the panel the tabs open.
 */

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface RecordTab<T extends string> {
  id: T
  label: string
  icon: LucideIcon
  disabled?: boolean
  /** Small mark after the label — e.g. "alterado" on a resubmitted area. */
  badge?: ReactNode
}

interface RecordTabsProps<T extends string> {
  tabs: readonly RecordTab<T>[]
  active: T
  onSelect: (id: T) => void
  /** The eyebrow over the tabs on a monitor, and the phone strip's `aria-label`. */
  heading: string
  /** `title` of a disabled tab. */
  disabledTitle?: string
  /** Pinned to the bottom of the sidebar on a monitor (the modal's save block). */
  footer?: ReactNode
}

export function RecordTabs<T extends string>({ tabs, active, onSelect, heading, disabledTitle, footer }: RecordTabsProps<T>) {
  const buttons = (compact: boolean) =>
    tabs.map((tab) => (
      <button
        key={tab.id}
        type="button"
        onClick={() => !tab.disabled && onSelect(tab.id)}
        disabled={tab.disabled}
        aria-current={active === tab.id ? 'page' : undefined}
        className={cn(
          'flex items-center gap-3 rounded-2xl font-bold text-sm transition-all duration-300 text-left',
          // A phone taps these with a thumb: 44px tall, side by side, and the label never wraps
          // mid-strip.
          compact ? 'min-h-[44px] shrink-0 whitespace-nowrap px-4 py-2' : 'w-full px-4 py-3',
          active === tab.id
            ? 'bg-tuggi-blue text-white'
            : tab.disabled
              ? 'text-gray-300 cursor-not-allowed'
              : 'text-gray-500 dark:text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5'
        )}
        title={tab.disabled ? disabledTitle : undefined}
      >
        <tab.icon className={cn('h-5 w-5 shrink-0', active === tab.id && 'animate-pulse')} />
        <span className={compact ? undefined : 'flex-1'}>{tab.label}</span>
        {tab.badge}
      </button>
    ))

  return (
    <>
      {/* Sidebar — the monitor's shape, where 288px beside the content costs nothing. */}
      <aside className="hidden lg:flex w-72 bg-white dark:bg-gray-900 border-r border-gray-100/50 dark:border-gray-800 p-6 flex-col gap-2 z-20 shrink-0 overflow-y-auto">
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-3 mb-2">{heading}</p>
        {buttons(false)}
        <div className="my-2 border-t border-gray-100 dark:border-gray-800" />
        {footer ? <div className="mt-auto space-y-3">{footer}</div> : null}
      </aside>

      {/* The phone's shape: the same tabs as a strip that scrolls sideways, above the panel they
          open. On a 390px screen the 288px sidebar left ~43px for the record itself. */}
      <nav
        aria-label={heading}
        className="lg:hidden flex gap-2 overflow-x-auto border-b border-gray-100 dark:border-gray-800 px-4 py-2 shrink-0"
      >
        {buttons(true)}
      </nav>
    </>
  )
}
