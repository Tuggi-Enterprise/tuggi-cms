'use client'

/**
 * THE FRAME OF A RECORD IN THE STUDIO: the header bar and the body below it, and nothing else.
 *
 * One component for the client record (`ClientEditorModal`), the portal validation
 * (`ValidationReview`) and the proposal conference (`ProposalReview`) — #870, "todos os cadastros
 * precisam ser iguais". Before it, each screen wrote its own header, and the validation's was a
 * `sticky top-0` card of variable height scrolling over a `sticky top-24` aside: a two-line title
 * hid the plan line under it. Here the header sits OUTSIDE the area that scrolls, so neither
 * column needs `sticky` and nothing can overlap.
 *
 * The owner of the screen keeps what is not frame: the modal keeps its backdrop, its focus trap
 * and its `role="dialog"` (passed through `...rest`); the pages keep their columns, which go in
 * `children` inside a `flex-1 overflow-hidden` row.
 *
 * Header layout — three children and `order`: on a phone `controls` wrap to their own line under
 * the title (`order-3 w-full`), on a monitor they sit inline (`lg:order-2`). Measured by
 * `tests/ct/client-board.mobile.spec.tsx`, which caught the title shrinking to 0 px when the
 * controls did not wrap.
 */

import Link from 'next/link'
import type { HTMLAttributes, ReactNode, Ref } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const CLOSE_CLASS =
  'order-2 shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-all text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 lg:order-3 lg:min-h-0 lg:min-w-0'

interface RecordShellProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** The glyph inside the blue square — `Edit`, `Plus`, `ClipboardCheck`… */
  icon: ReactNode
  title: ReactNode
  titleId?: string
  /** `h2` inside the modal, which is named by it; `h1` on a page of its own. */
  titleAs?: 'h1' | 'h2'
  subtitle?: ReactNode
  /** Status pill, acts. Wraps under the title on a phone. */
  controls?: ReactNode
  /** `aria-label` of the `X`. */
  closeLabel: string
  /** A page closes by going somewhere (a real link, middle-clickable)… */
  closeHref?: string
  /** …a drawer closes in place. */
  onClose?: () => void
  closeRef?: Ref<HTMLButtonElement>
  /** Extra classes for the body row (it is already `flex-1 flex-col lg:flex-row overflow-hidden relative`). */
  bodyClassName?: string
  children: ReactNode
}

export function RecordShell({
  icon,
  title,
  titleId,
  titleAs: Title = 'h2',
  subtitle,
  controls,
  closeLabel,
  closeHref,
  onClose,
  closeRef,
  bodyClassName,
  className,
  children,
  ...rest
}: RecordShellProps) {
  return (
    <div {...rest} className={cn('h-full flex flex-col bg-white dark:bg-gray-900', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 lg:h-16 lg:flex-nowrap lg:px-6 lg:py-0 border-b border-gray-100 dark:border-gray-800 shrink-0">
        <div className="order-1 flex flex-1 items-center gap-3 min-w-0">
          <div className="p-2 bg-tuggi-blue/10 rounded-xl shrink-0">{icon}</div>
          <div className="min-w-0">
            <Title id={titleId} className="font-bold text-gray-900 dark:text-white truncate text-base leading-tight">
              {title}
            </Title>
            {subtitle ? <p className="text-[10px] text-gray-400 font-medium truncate">{subtitle}</p> : null}
          </div>
        </div>

        {controls ? <div className="order-3 w-full shrink-0 lg:order-2 lg:w-auto">{controls}</div> : null}

        {closeHref ? (
          <Link href={closeHref} aria-label={closeLabel} className={CLOSE_CLASS}>
            <X className="h-5 w-5" />
          </Link>
        ) : (
          <button ref={closeRef} type="button" onClick={onClose} aria-label={closeLabel} className={CLOSE_CLASS}>
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <div className={cn('flex-1 flex flex-col lg:flex-row overflow-hidden relative', bodyClassName)}>{children}</div>
    </div>
  )
}
