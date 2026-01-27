/**
 * View Mode Toggle - Shared Component
 * 
 * Toggle between table and map views
 * 
 * @module components/shared/ViewModeToggle
 */

'use client'

import { Table2, Map } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

interface ViewModeToggleProps {
  viewMode: 'table' | 'map'
  onViewChange: (mode: 'table' | 'map') => void
  className?: string
}

export function ViewModeToggle({ viewMode, onViewChange, className }: ViewModeToggleProps) {
  const t = useTranslations('Shared.ViewModeToggle')
  return (
    <div className={cn("flex items-center space-x-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1", className)}>
      <button
        onClick={() => onViewChange('table')}
        className={cn(
          "flex items-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
          viewMode === 'table'
            ? "bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm"
            : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
        )}
      >
        <Table2 className="w-4 h-4 mr-2" />
        {t('table')}
      </button>
      <button
        onClick={() => onViewChange('map')}
        className={cn(
          "flex items-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
          viewMode === 'map'
            ? "bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm"
            : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
        )}
      >
        <Map className="w-4 h-4 mr-2" />
        {t('map')}
      </button>
    </div>
  )
}
