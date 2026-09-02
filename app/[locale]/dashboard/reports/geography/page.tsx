'use client'

import { Globe } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { GeoDemand } from '@/components/dashboard/reports/GeoDemand'

export default function GeographyReportPage() {
  const t = useTranslations('Pages.Dashboard')

  return (
    <div className="cms-width p-6 lg:p-8 space-y-6 min-h-screen bg-gray-50 dark:bg-gray-950">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
          <Globe className="mr-3 h-8 w-8 text-tuggi-purple" />
          {t('reports.geography.title')}
        </h1>
        <p className="text-gray-500">{t('reports.geography.subtitle')}</p>
      </div>

      <GeoDemand />
    </div>
  )
}
