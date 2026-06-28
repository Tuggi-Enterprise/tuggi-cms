'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Users, Crown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { ReportTabs } from '@/components/dashboard/ReportTabs'
import { UsersAll } from '@/components/dashboard/reports/UsersAll'
import { UsersPremium } from '@/components/dashboard/reports/UsersPremium'

export default function UsersReportPage() {
  const t = useTranslations('Pages.Dashboard')
  const initialTab = useSearchParams().get('tab') === 'premium' ? 'premium' : 'all'
  const [tab, setTab] = useState(initialTab)

  const tabs = [
    { key: 'all', label: t('tabs.all_users'), icon: Users },
    { key: 'premium', label: t('tabs.premium'), icon: Crown },
  ]

  return (
    <div className="p-6 lg:p-8 space-y-6 min-h-screen bg-gray-50 dark:bg-gray-950">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
          <Users className="mr-3 h-8 w-8 text-tuggi-purple" />
          {t('reports.users.title')}
        </h1>
        <p className="text-gray-500">{t('reports.users.subtitle')}</p>
      </div>

      <ReportTabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'all' ? <UsersAll /> : <UsersPremium />}
    </div>
  )
}
