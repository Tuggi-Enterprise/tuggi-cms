'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { Map, Download } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { dashboardService, HeatmapPoint } from '@/lib/services/dashboard-service'

// Lazy load TrailMap
const TrailMap = dynamic(
  () => import('@/components/trail-visualization/TrailMap').then(mod => mod.TrailMap),
  { 
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full bg-gray-100 dark:bg-gray-800 rounded-2xl">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-tuggi-blue mx-auto mb-4" />
          <p className="text-gray-500">Loading map...</p>
        </div>
      </div>
    )
  }
)

export default function HeatmapReportPage() {
  const [heatmapData, setHeatmapData] = useState<HeatmapPoint[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const t = useTranslations('Pages.Dashboard')

  useEffect(() => {
    const loadHeatmap = async () => {
      setIsLoading(true)
      const result = await dashboardService.getHeatmapData(5000)
      if (result.success && result.data) {
        setHeatmapData(result.data)
      }
      setIsLoading(false)
    }
    loadHeatmap()
  }, [])

  return (
    <div className="p-6 lg:p-8 space-y-8 min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
            <Map className="mr-3 h-8 w-8 text-tuggi-blue" />
            {t('reports.heatmap.title')}
          </h1>
          <div className="text-sm text-gray-500">
            {heatmapData.length.toLocaleString()} {t('labels.core_homolog')} • {t('labels.last_7d')}
          </div>
        </div>
        <button className="flex items-center px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          <Download className="w-4 h-4 mr-2" />
          {t('kpi.export') || 'Export'}
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
        <div className="h-[700px]">
          <TrailMap
            center={{ lat: -32.0, lng: -58.0 }}
            zoom={4}
            height="700px"
            showHeatMap={true}
            showTrails={false}
            heatMapData={heatmapData}
          />
        </div>
      </div>
    </div>
  )
}
