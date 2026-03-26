'use client'

import { cn } from '@/lib/utils'
import { LucideIcon } from 'lucide-react'

interface StatCardProps {
  icon: LucideIcon | any
  label?: string
  title?: string
  value: string | number
  subtitle?: string
  color?: string
  isLoading?: boolean
  size?: 'normal' | 'compact'
  glow?: boolean
  className?: string
}

export const StatCard = ({ 
  icon: Icon, 
  label, 
  title,
  value, 
  subtitle, 
  color = '#00A8E8', 
  isLoading = false,
  size = 'normal',
  glow = true,
  className
}: StatCardProps) => {
  const isCompact = size === 'compact'
  const displayLabel = label || title || ''
  
  if (isLoading) {
    return (
      <div className={cn(
        "bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 animate-pulse",
        isCompact ? "p-3" : "p-4",
        className
      )}>
        <div className="flex items-center justify-between mb-2">
          <div className={cn(
            "rounded-lg bg-gray-200 dark:bg-gray-700",
            isCompact ? "h-6 w-6" : "h-8 w-8"
          )} />
        </div>
        <div className="h-3 w-16 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
        <div className={cn(
          "bg-gray-200 dark:bg-gray-700 rounded",
          isCompact ? "h-6 w-12" : "h-8 w-16"
        )} />
      </div>
    )
  }

  return (
    <div className={cn(
      "group relative overflow-hidden bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 transition-all duration-300 hover:shadow-xl hover:border-tuggi-blue/30 hover:-translate-y-1",
      isCompact ? "p-3" : "p-4",
      className
    )}>
      {glow && (
        <div 
          className="absolute -top-20 -right-20 w-40 h-40 opacity-10 blur-3xl group-hover:opacity-20 transition-opacity duration-500" 
          style={{ backgroundColor: color }} 
        />
      )}

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-2">
          <div 
            className={cn("rounded-lg", isCompact ? "p-1.5" : "p-2")}
            style={{ backgroundColor: `${color}20` }}
          >
            <Icon 
              className={isCompact ? "h-3.5 w-3.5" : "h-4 w-4"} 
              style={{ color }} 
            />
          </div>
        </div>
        <p className={cn(
          "font-bold text-gray-500 uppercase tracking-wider",
          isCompact ? "text-[10px]" : "text-xs"
        )}>
          {displayLabel}
        </p>
        <p className={cn(
          "font-bold text-gray-900 dark:text-white",
          isCompact ? "text-xl" : "text-2xl"
        )}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
        {subtitle && (
          <p className="text-xs text-gray-400 mt-1">{subtitle}</p>
        )}
      </div>
    </div>
  )
}

interface StatCardRowProps {
  children: React.ReactNode
  columns?: 2 | 3 | 4 | 6 | 8
  className?: string
}

export const StatCardRow = ({ children, columns = 4, className }: StatCardRowProps) => {
  const gridCols: Record<number, string> = {
    2: 'grid-cols-2',
    3: 'grid-cols-2 md:grid-cols-3',
    4: 'grid-cols-2 md:grid-cols-4',
    6: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6',
    8: 'grid-cols-2 md:grid-cols-4 lg:grid-cols-8'
  }

  return (
    <div className={cn("grid gap-4", gridCols[columns], className)}>
      {children}
    </div>
  )
}

export default StatCard
