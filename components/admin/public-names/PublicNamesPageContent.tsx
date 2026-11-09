'use client'

/**
 * /admin/public-names (#1144, epic #1127): the moderation of display name, @ and bio. The queue of
 * reports on top (BR-USUARIO-051 item 5) and the lists the filter reads underneath (BR-USUARIO-050
 * item 7, BR-USUARIO-051 items 2 and 2.d). The reset and the lock of one account live on its record,
 * the drawer over the app users list, which the account link of every report opens.
 *
 * Shell follows `RouteReviewPageContent`, the other moderation queue of user content.
 */

import { ShieldAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Container } from '@/components/ui/Container'
import { IdentityReportsBand } from './ReportsQueue'
import { FilterListsPanel } from './FilterLists'

export function PublicNamesPageContent() {
  const t = useTranslations('Pages.PublicNames')
  return (
    <div className="py-6">
      <Container fullWidth>
        <div className="mb-4">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white">
            <ShieldAlert size={22} className="text-tuggi-orange" aria-hidden="true" /> {t('title')}
          </h1>
          <p className="text-sm text-gray-700 dark:text-gray-300">{t('subtitle')}</p>
        </div>
        <IdentityReportsBand />
        <FilterListsPanel />
      </Container>
    </div>
  )
}
