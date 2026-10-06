'use client'

/**
 * The portal validation in the Studio's side drawer (#870, operator 2026-10-06): the same 85vw
 * panel from the right, dimmed board behind, that `ClientEditorModal` and the POI management
 * (`POIDetailsModal`) use. Opened by `?validation=<submissionId>` on `/admin/clients`
 * (`lib/clients/record-href.ts`, `VALIDATION_PARAM`); the old page is a redirect to that address.
 *
 * Closing is the board's own address, so the filters survive: the `X` is a real link to
 * `returnTo` (middle-click keeps working), and Escape / a click on the backdrop call `onClose`,
 * which the host points at the same address.
 */

import { useId } from 'react'
import { useDialogShell } from '@/lib/hooks/use-dialog-shell'
import { ValidationReview } from '@/components/admin/partner-proposals/ValidationReview'

export function ValidationModal({
  locale,
  submissionId,
  returnTo,
  onClose,
}: {
  locale: string
  submissionId: string
  /** The board behind, without locale and without the drawer's own parameter. */
  returnTo: string
  onClose: () => void
}) {
  const titleId = useId()
  useDialogShell(true, onClose)

  return (
    <div
      className="fixed inset-0 z-[100] flex justify-end bg-black/50 backdrop-blur-sm transition-opacity duration-300"
      onClick={onClose}
    >
      {/* Same width rule as the record: the whole screen on a phone, 85vw on a monitor. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="h-full w-full overflow-y-auto bg-white shadow-2xl animate-in slide-in-from-right duration-300 dark:bg-gray-900 lg:w-[85vw]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* `key`: "Próximo da fila" swaps the id in the URL; a fresh screen, not a stale one. */}
        <ValidationReview
          key={submissionId}
          locale={locale}
          submissionId={submissionId}
          returnTo={returnTo}
          titleId={titleId}
        />
      </div>
    </div>
  )
}
