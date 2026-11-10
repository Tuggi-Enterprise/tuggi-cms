'use client'

/**
 * A refusal of the campaign routes (`CampaignError`) as the sentence of `AppCampaigns.errors`. The
 * language and the field come back as codes; this hook names them (`languages.*`, `fields.*`) and
 * reads the limit from `CAMPAIGN_TEXT_MAX`, so no number is written twice.
 */

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { CAMPAIGN_TEXT_MAX, type CampaignError } from '@/lib/campaigns/app-campaigns'

export function useCampaignErrorText(): (error: CampaignError | undefined | null) => string {
  const t = useTranslations('AppCampaigns')
  return useCallback(
    (error) => {
      if (!error?.code || !t.has(`errors.${error.code}`)) return t('errors.write_failed')
      return t(`errors.${error.code}`, {
        lang: error.lang ? t(`languages.${error.lang}`) : '',
        field: error.field ? t(`fields.${error.field}`) : '',
        max: error.field ? CAMPAIGN_TEXT_MAX[error.field] : 0,
      })
    },
    [t]
  )
}
