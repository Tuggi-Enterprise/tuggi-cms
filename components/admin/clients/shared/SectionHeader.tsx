'use client'

import { cn } from '@/lib/utils'

interface SectionHeaderProps {
  icon: React.ReactNode
  title: string
  /** Tailwind colour token used for the icon background tint (e.g. 'tuggi-blue', 'purple-500'). */
  color?: string
}

/**
 * Inline section header used inside the ClientEditorModal tabs.
 * Same visual language as ClientDetails sections — a small uppercase
 * eyebrow with a tinted icon — but extracted so every tab renders it
 * identically.
 */
export function SectionHeader({ icon, title, color = 'tuggi-blue' }: SectionHeaderProps) {
  return (
    <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2.5">
      <div className={cn('p-1.5 rounded-lg', `bg-${color}/10`)}>{icon}</div>
      {title}
    </h2>
  )
}
