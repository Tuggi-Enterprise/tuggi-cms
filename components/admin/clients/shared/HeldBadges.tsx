'use client'

/**
 * WHAT A FREE PARTNER SAVED ON `/status` WITHOUT PUBLISHING (#1000): a photo, the story, or both.
 *
 * One component for the board card and the directory row, so the two surfaces cannot drift into
 * different words for the same fact. The chip is the directory's neutral one (`partnerBadges`):
 * a hint about who is close to subscribing, not a pendency, so it carries no accent colour.
 * Renders nothing when there is nothing held, which is every row until #998 writes the first one.
 */

import { useTranslations } from 'next-intl'
import type { ClientDirectoryRow } from '@/lib/services/partnership-service'

const CHIP =
  'mt-1 mr-1 inline-block rounded-full border border-gray-400 px-2 py-0.5 text-xs text-gray-900 dark:text-gray-200'

export function HeldBadges({ row }: { row: Pick<ClientDirectoryRow, 'hasHeldPhoto' | 'hasHeldStory'> }) {
  const t = useTranslations('Clients.directory')
  if (!row.hasHeldPhoto && !row.hasHeldStory) return null
  return (
    <>
      {row.hasHeldPhoto && <span className={CHIP}>{t('heldBadges.photo')}</span>}
      {row.hasHeldStory && <span className={CHIP}>{t('heldBadges.story')}</span>}
    </>
  )
}
