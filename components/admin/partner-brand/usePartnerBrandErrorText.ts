'use client'

/** A refusal of the partner brand routes (`PartnerBrandError`) as the sentence of `PartnerBrand.errors`. */

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import type { PartnerBrandError } from '@/lib/partner-brand/brand'

export function usePartnerBrandErrorText(): (error: PartnerBrandError | undefined | null) => string {
  const t = useTranslations('PartnerBrand')
  return useCallback(
    (error) => (error?.code && t.has(`errors.${error.code}`) ? t(`errors.${error.code}`) : t('errors.write_failed')),
    [t]
  )
}
