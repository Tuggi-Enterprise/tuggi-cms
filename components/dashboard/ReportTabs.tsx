'use client'

import { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ReportTab {
  key: string
  label: string
  icon?: LucideIcon
}

interface ReportTabsProps {
  tabs: ReportTab[]
  active: string
  onChange: (key: string) => void
  className?: string
}

/**
 * Barra de abas dos hubs de report (Catalog / Users / Geography).
 * Visual consistente com o restante do dashboard (pílulas).
 *
 * The label never wraps (#1061): a pill that does not fit makes the bar scroll inside its wrapper
 * (`max-w-full overflow-x-auto` at the call site), never breaks into two lines.
 */
export function ReportTabs({ tabs, active, onChange, className }: ReportTabsProps) {
  return (
    <div className={cn('inline-flex rounded-xl bg-gray-100 dark:bg-gray-800/60 p-1 gap-1', className)}>
      {tabs.map((tab) => {
        const isActive = tab.key === active
        const Icon = tab.icon
        return (
          <button
            key={tab.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(tab.key)}
            className={cn(
              'flex items-center gap-2 whitespace-nowrap px-4 py-2 text-xs font-black uppercase tracking-widest rounded-lg transition-all',
              isActive
                ? 'bg-white dark:bg-gray-900 text-primary-800 dark:text-tuggi-blue shadow-sm'
                : 'text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-300'
            )}
          >
            {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

export default ReportTabs
