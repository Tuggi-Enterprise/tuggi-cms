'use client'

/**
 * The failed read of a block of `/admin/trip-reminder` (#1233), with its retry: the settings, the
 * panel and (#1281) the list of the hours of "now" each fail alone, in the same red box.
 */

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { TripAdminError } from '@/lib/trip-reminder/settings'
import { errorText } from './format'

export function ReadFailure({ error, onRetry }: { error: TripAdminError | null; onRetry: () => void }) {
  const t = useTranslations('TripReminder')
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <span>
        {t('load_error')} {errorText(t, error)}
      </span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t('reload')}
      </Button>
    </div>
  )
}
