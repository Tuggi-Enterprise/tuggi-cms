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
  /** Size and visibility of the icons; `/admin/social` drops them below `sm` so three tabs fit 390 px. */
  iconClassName?: string
}

/**
 * Barra de abas dos hubs de report (Catalog / Users / Geography).
 * Visual consistente com o restante do dashboard (pílulas).
 */
export function ReportTabs({ tabs, active, onChange, className, iconClassName = 'h-4 w-4' }: ReportTabsProps) {
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
              'flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-widest rounded-lg transition-all',
              isActive
                ? 'bg-white dark:bg-gray-900 text-primary-800 dark:text-tuggi-blue shadow-sm'
                : 'text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-300'
            )}
          >
            {Icon && <Icon className={iconClassName} aria-hidden="true" />}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

export default ReportTabs
