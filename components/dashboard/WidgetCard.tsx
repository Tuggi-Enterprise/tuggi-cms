'use client'

import { ReactNode } from 'react'
import { Link } from '@/navigation'
import { ArrowRight, LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================================================
// WidgetCard — wrapper padrão dos cards do dashboard.
// Extrai o padrão repetido `bg-white dark:bg-gray-900 rounded-xl border …`
// que estava copiado em cada widget da Overview/reports.
// ============================================================================

interface WidgetCardProps {
  children: ReactNode
  className?: string
  /** Padding interno. Default p-4. Use `false` para cards com tabela/scroll que controlam o próprio padding. */
  padded?: boolean
}

export function WidgetCard({ children, className, padded = true }: WidgetCardProps) {
  return (
    <div
      className={cn(
        'bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col',
        padded && 'p-4',
        className
      )}
    >
      {children}
    </div>
  )
}

// ============================================================================
// SectionHeader — título + ícone + link opcional "ver detalhes →" (drill-down).
// ============================================================================

interface SectionHeaderProps {
  title: string
  icon?: LucideIcon
  /** Cor do ícone (hex ou classe). Default cinza. */
  iconColor?: string
  /** Href do drill-down. Se presente, renderiza o link "ver detalhes →". */
  href?: string
  /** Rótulo do link. Default "ver detalhes". */
  linkLabel?: string
  /** Conteúdo extra à direita (ex.: badge "realtime"), substitui o link se passado. */
  right?: ReactNode
  className?: string
}

export function SectionHeader({
  title,
  icon: Icon,
  iconColor = '#9ca3af',
  href,
  linkLabel = 'ver detalhes',
  right,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between mb-4', className)}>
      <div className="flex items-center gap-2 min-w-0">
        {Icon && <Icon className="h-4 w-4 shrink-0" style={{ color: iconColor }} />}
        <h3 className="text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 truncate">
          {title}
        </h3>
      </div>

      {right ? (
        right
      ) : href ? (
        <Link
          href={href}
          className="group flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-tuggi-blue transition-colors shrink-0"
        >
          {linkLabel}
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </Link>
      ) : null}
    </div>
  )
}

export default WidgetCard
