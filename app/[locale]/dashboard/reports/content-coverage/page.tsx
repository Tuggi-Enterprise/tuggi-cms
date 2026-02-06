'use client'

import { useState, useEffect } from 'react'
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import { 
  AlertTriangle, FileText, Volume2, Image as ImageIcon, Download, CheckCircle
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { dashboardService, InventoryDetails } from '@/lib/services/dashboard-service'
import { StatCard } from '@/components/ui/StatCard'

const TUGGI_COLORS = {
  blue: '#00A8E8',
  orange: '#FF6F00',
  green: '#10B981',
  red: '#EF4444'
}

const EMPTY_INVENTORY: InventoryDetails = {
  coreTotal: 0,
  coreApproved: 0,
  corePending: 0,
  coreWithCoordinates: 0,
  coreWithTriggerPoints: 0,
  coreMissingTriggerPoints: 0,
  homologTotal: 0,
  homologProcessed: 0,
  homologPending: 0,
  poisWithAnyDescription: 0,
  poisWithAllLanguages: 0,
  poisWithAudio: 0,
  poisMissingContent: 0,
  topCities: [],
  categoriesBreakdown: [],
  recentCoreAdditions: 0,
  recentHomologAdditions: 0
}

export default function ContentCoverageReportPage() {
  const [inventory, setInventory] = useState<InventoryDetails>(EMPTY_INVENTORY)
  const [isLoading, setIsLoading] = useState(true)
  const t = useTranslations('Pages.Dashboard')

  useEffect(() => {
    const loadInventory = async () => {
      setIsLoading(true)
      const result = await dashboardService.getInventoryDetails()
      if (result.success && result.data) {
        setInventory(result.data)
      }
      setIsLoading(false)
    }
    loadInventory()
  }, [])

  return (
    <div className="p-6 lg:p-8 space-y-8 min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
            <AlertTriangle className="mr-3 h-8 w-8 text-tuggi-orange" />
            {t('reports.content_coverage.title')}
          </h1>
          <p className="text-gray-500">{t('reports.content_coverage.subtitle')}</p>
        </div>
        <button className="flex items-center px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          <Download className="w-4 h-4 mr-2" />
          {t('kpi.export') || 'Export'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard 
          icon={Volume2} 
          title={t('kpi.missing_audio')} 
          value={inventory.coreTotal - inventory.poisWithAudio} 
          subtitle={t('labels.needing_narration')}
          color={TUGGI_COLORS.red} 
          isLoading={isLoading} 
        />
        <StatCard 
          icon={FileText} 
          title={t('kpi.missing_descriptions')} 
          value={inventory.coreTotal - inventory.poisWithAnyDescription} 
          subtitle={t('labels.pois_empty')}
          color={TUGGI_COLORS.orange} 
          isLoading={isLoading} 
        />
        <StatCard 
          icon={CheckCircle} 
          title={t('kpi.optimized')} 
          value={inventory.poisWithAllLanguages} 
          subtitle={t('labels.optimized_subtitle')}
          color={TUGGI_COLORS.green} 
          isLoading={isLoading} 
        />
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">{t('labels.action_items')}</h3>
        <div className="space-y-4">
            <div className="p-4 bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-100 dark:border-red-900/30 flex items-start">
               <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5 mr-3" />
               <div>
                  <h4 className="font-bold text-red-700 dark:text-red-400">{t('labels.generate_missing_audios')}</h4>
                  <p className="text-sm text-red-600 dark:text-red-500/80 mt-1">
                      {inventory.coreTotal - inventory.poisWithAudio} POIs {t('labels.needing_narration').toLowerCase()}.
                  </p>
               </div>
            </div>
             <div className="p-4 bg-orange-50 dark:bg-orange-900/10 rounded-xl border border-orange-100 dark:border-orange-900/30 flex items-start">
               <FileText className="h-5 w-5 text-orange-500 mt-0.5 mr-3" />
               <div>
                  <h4 className="font-bold text-orange-700 dark:text-orange-400">{t('labels.complete_translations')}</h4>
                  <p className="text-sm text-orange-600 dark:text-orange-500/80 mt-1">
                      {inventory.coreTotal - inventory.poisWithAllLanguages} POIs {t('labels.missing_content').toLowerCase()}.
                  </p>
               </div>
            </div>
        </div>
      </div>
    </div>
  )
}
