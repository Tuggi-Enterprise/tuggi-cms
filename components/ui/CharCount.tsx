import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * The character counter of a copy field, one for every marketing surface.
 *
 * IT NEVER BLOCKS, and that is the decision rather than a detail. The subject (50) and
 * preheader (90) limits are inbox advice: Gmail truncates, Outlook truncates somewhere else,
 * neither refuses the message. A `maxLength` on the input would turn advice into a rule and
 * leave the operator wondering why the key stopped responding. Amber says "over"; the person
 * writing decides.
 *
 * It is a component because it was written twice as loose JSX inside `NewsletterManager`
 * (subject and preheader) and the push composer repeats the same pair — three copies of one
 * colour-and-threshold decision is the defect CLAUDE.md §6 (DRY) names.
 */
export interface CharCountProps {
  value: string | undefined | null
  max: number
  className?: string
}

export function CharCount({ value, max, className }: CharCountProps) {
  const length = value?.length ?? 0
  const over = length > max
  return (
    <span
      className={cn('text-xs tabular-nums', over ? 'text-amber-600' : 'text-gray-400', className)}
      /*
       * `polite`, not `assertive`: the number changes on every keystroke, and a screen reader
       * interrupting the typing to say "38/50" would make the field unusable. `polite` waits
       * for the pause — which is exactly when the count starts to matter.
       */
      aria-live="polite"
    >
      {length}/{max}
    </span>
  )
}
