'use client'

/**
 * The partnership pipeline, inside the client record — the tab that made the record the single
 * entrance.
 *
 * WHAT IT REMOVES. The five bands lived on `/admin/partnerships/clients/{id}`, and band 3 said
 * `Assinar o contrato` while linking away at two other pages: the client record and the
 * contract. Filling one fiscal field meant leaving the pipeline, and reading the pipeline meant
 * leaving the record. Here they are neighbouring tabs — `onOpenTab` switches, with no
 * navigation and no fetch, so the operator never loses the state they were reading.
 *
 * IT IS THE SAME COMPONENT, not a copy. `PartnershipDetail` renders in both hosts; what it
 * takes from each is the chrome around it — the standalone page hands it a `backHref` for the
 * queue, this tab hands it the tab strip instead. A second implementation of the five bands is
 * exactly how the record and the queue would start disagreeing about a state.
 *
 * THE MESSAGES ARE MERGED, NOT REPLACED. `Partnerships` is Portuguese-only by decision (#408),
 * but the pipeline opens `PlaceFormModal`, which reads `Modals` and `Common` in the operator's
 * locale. A provider carrying only the Portuguese namespace would print key names inside that
 * modal, so the current messages travel with it and only `Partnerships` is overlaid.
 */

import { NextIntlClientProvider, useLocale, useMessages } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { PartnershipDetail } from '@/components/admin/partnerships/PartnershipDetail'
import type { ClientEditorTab } from '@/components/admin/clients/ClientEditorModal'
import type { ClientEditorTabProps } from './ProfileTab'

interface PartnershipTabProps extends ClientEditorTabProps {
  onOpenTab: (tab: ClientEditorTab) => void
}

export function PartnershipTab({ clientId, onOpenTab }: PartnershipTabProps) {
  const locale = useLocale()
  const messages = useMessages()

  // A registration that was never saved has no pipeline to read: the endpoint below is keyed
  // by the client id, and there is none yet.
  if (!clientId) return null

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={{ ...messages, Partnerships: ptMessages.Partnerships }}
    >
      <PartnershipDetail locale={locale} clientId={clientId} onOpenTab={onOpenTab} />
    </NextIntlClientProvider>
  )
}
