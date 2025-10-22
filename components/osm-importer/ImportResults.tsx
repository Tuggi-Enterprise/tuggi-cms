/**
 * Import Results Component
 * 
 * Shows import summary, progress, and error details
 * 
 * @module components/osm-importer/ImportResults
 */

'use client'

import { useState } from 'react'
import { 
  CheckCircle, XCircle, AlertTriangle, Clock, 
  Download, RefreshCw, Eye, EyeOff, ChevronDown, ChevronRight
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ImportResults as ImportResultsType } from '@/types/osm-importer'

interface ImportResultsProps {
  results: ImportResultsType | null
  onClose?: () => void
  onRetry?: () => void
  onExport?: () => void
}

export function ImportResults({ results, onClose, onRetry, onExport }: ImportResultsProps) {
  const [showDetails, setShowDetails] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  if (!results) return null

  const { 
    imported,
    skipped,
    failed,
    summary
  } = results

  const total_processed = summary.total
  const successful_imports = summary.imported
  const skipped_duplicates = summary.skipped
  const failed_count = summary.failed
  const processing_time_ms = summary.processing_time_ms
  const status: 'completed' | 'failed' | 'processing' = failed_count > 0 ? 'failed' : 'completed'
  const error_message = failed.length > 0 ? `${failed.length} POIs failed to import` : undefined
  const importDetails = [...imported.map(id => ({ osm_id: id, osm_type: 'node', status: 'imported' as const, message: 'Successfully imported' })), ...skipped.map(id => ({ osm_id: id, osm_type: 'node', status: 'skipped' as const, message: 'Skipped duplicate' })), ...failed.map(f => ({ osm_id: f.poi, osm_type: 'node', status: 'failed' as const, message: f.error }))]

  const successRate = total_processed > 0 ? (successful_imports / total_processed) * 100 : 0
  const isCompleted = status === 'completed'
  const hasErrors = failed_count > 0 || error_message
  const hasWarnings = skipped_duplicates > 0

  const getStatusIcon = () => {
    if (status === 'failed') return <XCircle className="w-5 h-5 text-red-500" />
    if (hasErrors) return <AlertTriangle className="w-5 h-5 text-yellow-500" />
    return <CheckCircle className="w-5 h-5 text-green-500" />
  }

  const getStatusColor = () => {
    if (status === 'failed') return 'border-red-200 bg-red-50 dark:bg-red-900/20'
    if (hasErrors) return 'border-yellow-200 bg-yellow-50 dark:bg-yellow-900/20'
    return 'border-green-200 bg-green-50 dark:bg-green-900/20'
  }

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}m`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Results Modal */}
      <div className="relative w-full max-w-2xl bg-white dark:bg-gray-950 rounded-lg shadow-xl border border-gray-200 dark:border-gray-800">
        {/* Header */}
        <div className={cn(
          "px-6 py-4 border-b rounded-t-lg",
          getStatusColor()
        )}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {getStatusIcon()}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Import {isCompleted ? 'Completed' : status === 'failed' ? 'Failed' : 'In Progress'}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {total_processed.toLocaleString()} POIs processed
                  {processing_time_ms && ` in ${formatTime(processing_time_ms)}`}
                </p>
              </div>
            </div>

            {onClose && (
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition"
              >
                <XCircle className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Summary Stats */}
        <div className="px-6 py-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                {successful_imports.toLocaleString()}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Imported</div>
            </div>

            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                {skipped_duplicates.toLocaleString()}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Skipped</div>
            </div>

            <div className="text-center">
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                {failed_count.toLocaleString()}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Failed</div>
            </div>

            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {successRate.toFixed(1)}%
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Success Rate</div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mb-4">
            <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
              <span>Progress</span>
              <span>{successRate.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${successRate}%` }}
              />
            </div>
          </div>

          {/* Error Message */}
          {error_message && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <XCircle className="w-4 h-4 text-red-500" />
                <span className="text-sm font-medium text-red-800 dark:text-red-200">
                  Error
                </span>
              </div>
              <p className="text-sm text-red-700 dark:text-red-300">
                {error_message}
              </p>
            </div>
          )}

          {/* Details Toggle */}
          {importDetails.length > 0 && (
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition"
            >
              {showDetails ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              {showDetails ? 'Hide' : 'Show'} detailed results ({importDetails.length} items)
            </button>
          )}
        </div>

        {/* Detailed Results */}
        {showDetails && importDetails.length > 0 && (
          <div className="border-t border-gray-200 dark:border-gray-800">
            <div className="px-6 py-4">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  Detailed Results
                </h4>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowErrors(!showErrors)}
                    className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                  >
                    {showErrors ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    {showErrors ? 'Hide' : 'Show'} errors only
                  </button>
                </div>
              </div>

              <div className="max-h-64 overflow-y-auto">
                <div className="space-y-2">
                  {importDetails
                    .filter(result => !showErrors || result.status === 'failed')
                    .map((result, index) => (
                    <div
                      key={index}
                      className={cn(
                        "flex items-center justify-between p-3 rounded-lg text-sm",
                        result.status === 'imported' && "bg-green-50 dark:bg-green-900/20",
                        result.status === 'skipped' && "bg-yellow-50 dark:bg-yellow-900/20",
                        result.status === 'failed' && "bg-red-50 dark:bg-red-900/20"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        {result.status === 'imported' && <CheckCircle className="w-4 h-4 text-green-500" />}
                        {result.status === 'skipped' && <AlertTriangle className="w-4 h-4 text-yellow-500" />}
                        {result.status === 'failed' && <XCircle className="w-4 h-4 text-red-500" />}
                        
                        <div>
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            {result.osm_type}-{result.osm_id}
                          </div>
                          {result.message && (
                            <div className="text-xs text-gray-600 dark:text-gray-400">
                              {result.message}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {result.status}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {onRetry && hasErrors && (
              <button
                onClick={onRetry}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition"
              >
                <RefreshCw className="w-4 h-4" />
                Retry Failed
              </button>
            )}

            {onExport && successful_imports > 0 && (
              <button
                onClick={onExport}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg flex items-center gap-2 transition"
              >
                <Download className="w-4 h-4" />
                Export Results
              </button>
            )}
          </div>

          <div className="text-xs text-gray-500 dark:text-gray-400">
            Batch completed at {new Date().toLocaleTimeString()}
          </div>
        </div>
      </div>
    </div>
  )
}
