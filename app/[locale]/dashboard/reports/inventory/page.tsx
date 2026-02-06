'use client'

import { useState, useEffect } from 'react'
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, LabelList
} from 'recharts'
import { 
  CheckCircle, FileText, Database, Layers, MapPin, 
  Globe, Volume2, Package, Clock, Target, AlertTriangle, Plus, Download
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { StatCard } from '@/components/ui/StatCard'
import { dashboardService, InventoryDetails } from '@/lib/services/dashboard-service'

const TUGGI_COLORS = {
  blue: '#00A8E8',
  orange: '#FF6F00',
  green: '#10B981',
  purple: '#8B5CF6',
  red: '#EF4444',
  background: '#F7F9FA',
  text: '#1A1A1A',
  border: '#D9D9D9'
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

export default function InventoryReportPage() {
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

  const contentQualityData = inventory.categoriesBreakdown.length > 0 ? [] : [] // Placeholder if needed, logic handled below

  // Helper for content quality chart data
  const qualityData = [
    { language: 'PT', count: inventory.poisWithAnyDescription }, // Simplified mapping for now, ideally backend gives per lang
    // Note: The previous chart used stats.languagesBreakdown. 
    // We should ideally fetch that here too if needed, but InventoryDetails has aggregated counts.
    // For now we will replicate the UI structure.
  ]

  return (
    <div className="p-6 lg:p-8 space-y-8 min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
            <Database className="mr-3 h-8 w-8 text-tuggi-blue" />
            {t('reports.inventory.title')}
          </h1>
          <p className="text-gray-500">{t('reports.inventory.subtitle')}</p>
        </div>
        <button className="flex items-center px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          <Download className="w-4 h-4 mr-2" />
          {t('kpi.export') || 'Export'}
        </button>
      </div>

      {/* Core Inventory Stats */}
      <div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
          <Database className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.blue }} />
          {t('kpi.total_core')}
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard icon={Package} title={t('kpi.total_core')} value={inventory.coreTotal} color={TUGGI_COLORS.blue} isLoading={isLoading} size="compact" />
          <StatCard icon={CheckCircle} title={t('kpi.approved_pois')} value={inventory.coreApproved} color={TUGGI_COLORS.green} isLoading={isLoading} size="compact" />
          <StatCard icon={Clock} title={t('kpi.pending')} value={inventory.corePending} color={TUGGI_COLORS.orange} isLoading={isLoading} size="compact" />
          <StatCard icon={MapPin} title={t('kpi.with_coords')} value={inventory.coreWithCoordinates} color={TUGGI_COLORS.blue} isLoading={isLoading} size="compact" />
          <StatCard icon={Target} title={t('kpi.with_triggers')} value={inventory.coreWithTriggerPoints} color={TUGGI_COLORS.green} isLoading={isLoading} size="compact" />
          <StatCard icon={AlertTriangle} title={t('kpi.missing_triggers')} value={inventory.coreMissingTriggerPoints} color={TUGGI_COLORS.red} isLoading={isLoading} size="compact" />
        </div>
      </div>

      {/* Homolog Stats */}
      <div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
          <Layers className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.purple }} />
          {t('kpi.total_homolog')}
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={Layers} title={t('kpi.total_homolog')} value={inventory.homologTotal} color={TUGGI_COLORS.purple} isLoading={isLoading} size="compact" />
          <StatCard icon={CheckCircle} title={t('kpi.processed')} value={inventory.homologProcessed} color={TUGGI_COLORS.green} isLoading={isLoading} size="compact" />
          <StatCard icon={Clock} title={t('kpi.pending')} value={inventory.homologPending} color={TUGGI_COLORS.orange} isLoading={isLoading} size="compact" />
          <StatCard icon={Plus} title={t('kpi.new_7d')} value={inventory.recentHomologAdditions} subtitle={t('labels.last_7d')} color={TUGGI_COLORS.blue} isLoading={isLoading} size="compact" />
        </div>
      </div>

      {/* Content Quality */}
      <div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
          <FileText className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.green }} />
          {t('reports.content_coverage.title')}
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={FileText} title={t('kpi.with_description')} value={inventory.poisWithAnyDescription} color={TUGGI_COLORS.green} isLoading={isLoading} size="compact" />
          <StatCard icon={Globe} title={t('kpi.all_languages')} value={inventory.poisWithAllLanguages} color={TUGGI_COLORS.blue} isLoading={isLoading} size="compact" />
          <StatCard icon={Volume2} title={t('kpi.with_audio')} value={inventory.poisWithAudio} color={TUGGI_COLORS.purple} isLoading={isLoading} size="compact" />
          <StatCard icon={AlertTriangle} title={t('kpi.missing_content')} value={inventory.poisMissingContent} color={TUGGI_COLORS.red} isLoading={isLoading} size="compact" />
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Cities by POI Count */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
            <MapPin className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.blue }} />
            {t('charts.top_cities_poi')}
          </h3>
          <div className="space-y-3 max-h-[250px] overflow-y-auto custom-scrollbar">
            {inventory.topCities.length > 0 ? inventory.topCities.map((city, index) => (
              <div key={city.city} className="flex items-center justify-between">
                <div className="flex items-center">
                  <span className="text-xs font-black text-gray-400 w-5">{index + 1}</span>
                  <span className="font-medium text-gray-900 dark:text-white">{city.city}</span>
                  <span className="text-[10px] text-gray-500 ml-2">({city.country})</span>
                </div>
                <span className="font-black text-tuggi-blue">{city.count}</span>
              </div>
            )) : (
              <div className="text-center py-8 text-gray-500">Loading...</div>
            )}
          </div>
        </div>

        {/* Categories Breakdown */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
            <Layers className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.purple }} />
            {t('charts.categories')}
          </h3>
          <div className="flex flex-wrap gap-2">
            {inventory.categoriesBreakdown.map((cat) => (
              <div key={cat.category} className="px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 capitalize">{cat.category}</span>
                <span className="px-2 py-0.5 bg-tuggi-blue/20 text-tuggi-blue text-xs font-black rounded-full">{cat.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
