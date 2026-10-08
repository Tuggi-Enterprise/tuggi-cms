'use client'

/**
 * Parceria, the record's one working tab (#910): the portal submission and the partnership pipeline
 * in one order, rendered by `PartnershipDetail`. It used to be two tabs, Validação and Parceria, that
 * told the same story twice; `?validation=` and the old `tab=validation` open here.
 *
 * It is the tab of a saved client, and also of a pre-registration (a portal submission with no
 * client yet), where it is the only tab enabled and shows the submission alone.
 *
 * THE MESSAGES ARE MERGED, NOT REPLACED. `Partnerships` is Portuguese-only by decision (#408),
 * but the pipeline opens `PlaceFormModal`, which reads `Modals` and `Common` in the operator's
 * locale. A provider carrying only the Portuguese namespace would print key names inside that
 * modal, so the current messages travel with it and only `Partnerships` is overlaid.
 */

import { NextIntlClientProvider, useLocale, useMessages } from 'next-intl'
import { usePtOverlay } from '@/lib/i18n/pt-overlay'
import { PartnershipDetail } from '@/components/admin/partnerships/PartnershipDetail'
import type { SubmissionProps } from '@/components/admin/clients/shared/PortalSubmission'
import type { ClientEditorTab } from '@/components/admin/clients/ClientEditorModal'

interface PartnershipTabProps {
  clientId?: string
  onOpenTab: (tab: ClientEditorTab) => void
  /** The portal submission the record shows, when there is one. */
  submission?: Omit<SubmissionProps, 'locale' | 'onOpenTab'>
  /** `DecisionSummary` for the phone, which has no sidebar. */
  phoneSummary?: React.ReactNode
}

export function PartnershipTab({ clientId, onOpenTab, submission, phoneSummary }: PartnershipTabProps) {
  const locale = useLocale()
  const messages = useMessages()
  const ptMessages = usePtOverlay()

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={{ ...messages, Partnerships: ptMessages.Partnerships }}
    >
      <PartnershipDetail
        // A new submission remounts: the revealed CPF never carries over (security review #890).
        key={submission?.record.submissionId ?? 'none'}
        locale={locale}
        clientId={clientId}
        onOpenTab={onOpenTab}
        submission={submission}
        phoneSummary={phoneSummary}
      />
    </NextIntlClientProvider>
  )
}
