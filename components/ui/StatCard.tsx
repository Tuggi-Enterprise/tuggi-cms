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
        "h-full bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 animate-pulse",
        isCompact ? "p-3" : "p-4",
        className
      )}>
        {/* The skeleton is the same two blocks the loaded card has, in the same places — icon
            and label on one line, number under it (spec-dashboard-acesso-e-saldo-2026-09 §5:
            the skeleton stands at the height of the real line). It carries no third block for
            the `subtitle`: one card in six has one, and the row's height is the grid's. */}
        <div className={cn("flex items-center gap-2", isCompact ? "mb-1" : "mb-1.5")}>
          <div className={cn(
            "shrink-0 rounded-lg bg-gray-200 dark:bg-gray-700",
            isCompact ? "h-6 w-6" : "h-8 w-8"
          )} />
          <div className="h-3 w-16 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
        <div className={cn(
          "bg-gray-200 dark:bg-gray-700 rounded",
          isCompact ? "h-6 w-12" : "h-8 w-16"
        )} />
      </div>
    )
  }

  return (
    <div className={cn(
      // `h-full` is what makes a ROW of these end level. A grid item is stretched to the row's
      // height, so the `<Link>` around each card is already as tall as the tallest card; without
      // this the white box inside it was not, and the one card carrying a `subtitle` stood 36px
      // proud of its five neighbours (#658). Outside a grid there is no definite height to be
      // 100% of, so this resolves to `auto` and changes nothing.
      "group relative h-full overflow-hidden bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 transition-all duration-300 hover:shadow-xl hover:border-tuggi-blue/30 hover:-translate-y-1",
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
        {/* THE LABEL SHARES THE ICON'S LINE. It used to have a line of its own under an icon
            that sat alone on a 26px row, and 16px of every card in every KPI row paid for that
            (#658). `leading-[1.15]` is the part that makes it free rather than merely tidier:
            two lines of an 11px label stack to 25px, which still fits inside the icon box, so
            the long labels — `Ecossistema de Usuários`, `Curadoria Aprovada` — wrap without
            making their card taller than the ones whose label is one word. */}
        <div className={cn("flex items-center gap-2", isCompact ? "mb-1" : "mb-1.5")}>
          <div
            className={cn("shrink-0 rounded-lg", isCompact ? "p-1.5" : "p-2")}
            style={{ backgroundColor: `${color}20` }}
          >
            <Icon
              className={cn("block", isCompact ? "h-3.5 w-3.5" : "h-4 w-4")}
              style={{ color }}
            />
          </div>
          <p className={cn(
            "min-w-0 font-bold text-gray-500 uppercase tracking-widest leading-[1.15]",
            isCompact ? "text-[11px]" : "text-sm"
          )}>
            {displayLabel}
          </p>
        </div>
        {/* `leading-none` AFTER the size, and this is not style. `cn` is `tailwind-merge`, which
            treats a font-size utility as overriding `leading-*` — declared first, it was being
            dropped from the class list, so `text-2xl` painted its own 32px line-height and every
            card in the CMS carried 8px nobody asked for. Order is the fix; the class was already
            there, it just never reached the DOM. */}
        <p className={cn(
          "font-black text-gray-900 dark:text-white",
          isCompact ? "text-2xl" : "text-3xl",
          "leading-none"
        )}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
        {/* `text-sm text-gray-400` was #9CA3AF — 2.54:1, failing SC 1.4.3 AA, and LARGER than
            the 11 px label above it (spec-dashboard-acesso-e-saldo-2026-09 §5). Light is what
            the spec measured (#4B5563, 7.56:1); dark is gray-400 on gray-900, because gray-600
            in the dark theme would repeat the same defect from the other side. The size is now
            the label's own 11px instead of `text-xs` — same colour, and it closes the other half
            of §5's complaint, which was that the subtitle outsized the label above it.

            `whitespace-pre-line` is what lets the message choose its own line break. Left to
            wrap on its own at a sixth of the row, `Pagas 21 h 49 min · Gratuitas 18 h 22 min`
            broke after `Gratuitas` and left the word stranded from its number. */}
        {subtitle && (
          <p className="mt-0.5 whitespace-pre-line text-[11px] leading-[1.2] font-bold text-gray-600 dark:text-gray-400">
            {subtitle}
          </p>
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
