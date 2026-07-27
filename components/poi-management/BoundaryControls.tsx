'use client'

/**
 * Shared boundary-editing controls (status badge + Reset / Delete / Save / Draw).
 * SSOT for the boundary control set, used by TriggerPointsManager's Boundary mode
 * (the unified map workspace shared by POIs, Events and Places).
 * Purely presentational — state and handlers are passed in.
 */

import { useTranslations } from 'next-intl'
import { RotateCcw, Trash2, Loader2, Save, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LatLng { lat: number; lng: number }

interface BoundaryControlsProps {
  boundaryPolygon: LatLng[] | null
  existingBoundary: LatLng[] | null
  isDrawingEnabled: boolean
  isSaving: boolean
  canEdit: boolean
  onReset: () => void
  onDelete: () => void
  onSave: () => void
  onToggleDrawing: () => void
  className?: string
}

export function BoundaryControls({
  boundaryPolygon,
  existingBoundary,
  isDrawingEnabled,
  isSaving,
  canEdit,
  onReset,
  onDelete,
  onSave,
  onToggleDrawing,
  className,
}: BoundaryControlsProps) {
  const t = useTranslations('Modals.POIDetails')
  const tCommon = useTranslations('Common.actions')

  const hasValidPolygon = !!boundaryPolygon && boundaryPolygon.length >= 3

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className={cn(
          'px-2 py-1 rounded text-xs font-bold uppercase',
          hasValidPolygon
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
        )}>
          {hasValidPolygon ? t('labels.boundary_defined') : t('labels.boundary_missing')}
        </div>

        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              onClick={onReset}
              className="px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white flex items-center gap-1"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {tCommon('reset')}
            </button>

            {(boundaryPolygon || existingBoundary) && (
              <button
                onClick={onDelete}
                disabled={isSaving}
                className="px-3 py-1.5 text-xs font-semibold text-red-600 hover:text-red-700 flex items-center gap-1 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {tCommon('delete')}
              </button>
            )}
          </div>
        )}
      </div>

      {canEdit && (
        <div className="flex items-center gap-3">
          <button
            onClick={onSave}
            disabled={isSaving || !hasValidPolygon}
            className="flex-1 px-4 py-3 bg-tuggi-blue text-white rounded-xl font-bold text-sm hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center transition-all shadow-lg shadow-blue-500/20"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('labels.saving_boundary')}
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                {t('labels.save_boundary')}
              </>
            )}
          </button>

          <button
            onClick={onToggleDrawing}
            className={cn(
              'px-4 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2',
              isDrawingEnabled
                ? 'bg-amber-500 text-white hover:bg-amber-600'
                : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            )}
          >
            <Sparkles className="h-4 w-4" />
            {isDrawingEnabled ? t('labels.stop_drawing') : t('labels.start_drawing')}
          </button>
        </div>
      )}
    </div>
  )
}
