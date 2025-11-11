'use client'

import { TriggerPoint } from '@/lib/services/trigger-points-google/types/interfaces'

interface TriggerPointsListProps {
  triggerPoints: TriggerPoint[]
}

// Função auxiliar para obter cor do trigger point
function getTriggerPointColor(type: string): string {
  switch (type) {
    case 'primary':
      return '#10B981' // Verde
    case 'secondary':
      return '#F59E0B' // Amarelo
    case 'fallback':
      return '#6B7280' // Cinza
    default:
      return '#3B82F6' // Azul
  }
}

export function TriggerPointsList({ triggerPoints }: TriggerPointsListProps) {
  if (triggerPoints.length === 0) return null

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
        Trigger Points ({triggerPoints.length})
      </h2>
      
      <div className="space-y-3 max-h-64 overflow-y-auto">
        {triggerPoints.map((tp, index) => (
          <div key={tp.id} className="p-3 border border-gray-200 dark:border-gray-600 rounded-md">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: getTriggerPointColor(tp.type) }}
                />
                <span className="font-medium text-gray-900 dark:text-white">
                  {tp.type.charAt(0).toUpperCase() + tp.type.slice(1)} #{index + 1}
                </span>
              </div>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {tp.distance.toFixed(0)}m
              </span>
            </div>
            
            <div className="text-sm text-gray-600 dark:text-gray-400">
              <div>Localização: {tp.location.lat.toFixed(6)}, {tp.location.lng.toFixed(6)}</div>
              <div>Raio: {tp.radius}m | Qualidade: {(tp.quality * 100).toFixed(1)}% | Confiança: {(tp.confidence * 100).toFixed(1)}%</div>
              <div>Bearing: {tp.expectedBearing.toFixed(0)}° | Prioridade: {tp.priority}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

