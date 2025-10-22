/**
 * Loading Overlay Component
 * 
 * Shows detailed loading progress with steps and progress bar
 * 
 * @module components/osm-importer/LoadingOverlay
 */

'use client'

import { cn } from '@/lib/utils'
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react'

interface LoadingOverlayProps {
  isLoading: boolean
  progress: number
  step: string
  details: string
  error?: string | null
}

export function LoadingOverlay({ 
  isLoading, 
  progress, 
  step, 
  details, 
  error 
}: LoadingOverlayProps) {
  console.log('🔍 LOADING OVERLAY RENDER:', { isLoading, progress, step, details, error })
  
  // Show overlay if loading, has error, or is in progress (progress > 0)
  if (!isLoading && !error && progress === 0) {
    console.log('❌ LOADING OVERLAY: Not showing (no loading, no error, progress = 0)')
    return null
  }
  
  console.log('✅ LOADING OVERLAY: Showing overlay')

  const isError = !!error
  const isComplete = progress === 100 && !isError

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          {isError ? (
            <AlertCircle className="h-6 w-6 text-red-500" />
          ) : isComplete ? (
            <CheckCircle className="h-6 w-6 text-green-500" />
          ) : (
            <Loader2 className="h-6 w-6 text-blue-500 animate-spin" />
          )}
          
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">
              {isError ? 'Erro no Processamento' : 
               isComplete ? 'Processamento Concluído' : 
               'Processando Arquivo'}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {isError ? 'Ocorreu um erro durante o processamento' :
               isComplete ? 'Todos os dados foram processados com sucesso' :
               'Aguarde enquanto processamos seus dados...'}
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-4">
          <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
            <span>{step}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div 
              className={cn(
                "h-2 rounded-full transition-all duration-300 ease-out",
                isError ? "bg-red-500" : 
                isComplete ? "bg-green-500" : 
                "bg-blue-500"
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Details */}
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {isError ? (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3">
              <p className="text-red-800 dark:text-red-200 font-medium">Erro:</p>
              <p className="text-red-700 dark:text-red-300 mt-1">{error}</p>
            </div>
          ) : (
            <div className="bg-gray-50 dark:bg-gray-800 rounded p-3">
              <p className="text-gray-700 dark:text-gray-300">{details}</p>
            </div>
          )}
        </div>

        {/* Loading Steps Indicator */}
        {!isError && !isComplete && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <div className={cn(
                "w-2 h-2 rounded-full",
                progress >= 25 ? "bg-green-500" : "bg-gray-300"
              )} />
              <span>Analisando GeoJSON</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <div className={cn(
                "w-2 h-2 rounded-full",
                progress >= 50 ? "bg-green-500" : "bg-gray-300"
              )} />
              <span>Processando Features</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <div className={cn(
                "w-2 h-2 rounded-full",
                progress >= 75 ? "bg-green-500" : "bg-gray-300"
              )} />
              <span>Extraindo Metadados</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <div className={cn(
                "w-2 h-2 rounded-full",
                progress >= 100 ? "bg-green-500" : "bg-gray-300"
              )} />
              <span>Finalizando</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
