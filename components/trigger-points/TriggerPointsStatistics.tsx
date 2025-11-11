'use client'

interface Statistics {
  total: number
  byType: {
    primary?: number
    secondary?: number
    fallback?: number
  }
  averageQuality: number
  averageConfidence: number
}

interface TriggerPointsStatisticsProps {
  statistics: Statistics | null
  show?: boolean
}

export function TriggerPointsStatistics({ 
  statistics, 
  show = false 
}: TriggerPointsStatisticsProps) {
  if (!show || !statistics) return null

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
        Estatísticas
      </h2>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-600">{statistics.total}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Total</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-green-600">{statistics.byType.primary || 0}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Primários</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-yellow-600">{statistics.byType.secondary || 0}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Secundários</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-600">{statistics.byType.fallback || 0}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Fallback</div>
        </div>
      </div>
      
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="text-center">
          <div className="text-lg font-semibold text-purple-600">
            {(statistics.averageQuality * 100).toFixed(1)}%
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Qualidade Média</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold text-indigo-600">
            {(statistics.averageConfidence * 100).toFixed(1)}%
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Confiança Média</div>
        </div>
      </div>
    </div>
  )
}

