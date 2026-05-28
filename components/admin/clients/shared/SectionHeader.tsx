'use client'

import { cn } from '@/lib/utils'

/**
 * Tailwind JIT does NOT generate CSS for dynamic class names like
 * `bg-${color}/10` — the class string has to appear verbatim in source.
 * This map is the explicit list of tints the SectionHeader accepts, so
 * every entry forces the matching utility class into the build.
 *
 * To add a new colour: add the literal class strings here.
 */
const COLOR_TINTS = {
  'tuggi-blue': 'bg-tuggi-blue/10',
  'purple-500': 'bg-purple-500/10',
  'green-500': 'bg-green-500/10',
  'amber-500': 'bg-amber-500/10',
  'pink-500': 'bg-pink-500/10',
  'indigo-500': 'bg-indigo-500/10',
  'red-500': 'bg-red-500/10',
} as const

export type SectionHeaderColor = keyof typeof COLOR_TINTS

interface SectionHeaderProps {
  icon: React.ReactNode
  title: string
  color?: SectionHeaderColor
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
      <div className={cn('p-1.5 rounded-lg', COLOR_TINTS[color])}>{icon}</div>
      {title}
    </h2>
  )
}
