'use client'

import { useState, useEffect } from 'react'
import { useLocationData } from '@/lib/hooks/use-location-data'
import { Loader2, AlertCircle, CheckCircle2, Play, Filter, Database, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MigrationResult {
  poi_uuid_id: string
  poi_name: string
  success: boolean
  attraction_id?: string
  error?: string
  steps?: any[]
}

export default function PoiMigrationPage() {
  const locationData = useLocationData({ autoLoadCountries: true })

  // Form state
  const [country, setCountry] = useState('')
  const [state, setState] = useState('')
  const [city, setCity] = useState('')
  const [processingStatus, setProcessingStatus] = useState('pending')
  const [batchSize, setBatchSize] = useState(25)
  const [mode, setMode] = useState<'migration_only' | 'migration_description' | 'migration_description_audio' | 'full'>('full')
  const [autoGenerateAudio, setAutoGenerateAudio] = useState(true)
  const [autoApprove, setAutoApprove] = useState(false)
  const [skipIfExists, setSkipIfExists] = useState(true)

  // Data state
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isMigrating, setIsMigrating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [results, setResults] = useState<MigrationResult[]>([])
  const [progress, setProgress] = useState<{
    total: number
    processed: number
    successful: number
    failed: number
    percentage: number
  } | null>(null)

  // Auto-load countries
  useEffect(() => {
    if (locationData.countries.length > 0 && !country) {
      setCountry(locationData.countries[0].name)
    }
  }, [locationData.countries, country])

  // Load states when country changes
  useEffect(() => {
    if (country) {
      locationData.loadStates(country)
      setState('')
      setCity('')
    }
  }, [country])

  // Load cities when state changes
  useEffect(() => {
    if (country && state) {
      locationData.loadCities(country, state)
      setCity('')
    }
  }, [country, state])

  // Preview POIs count
  const previewPOIs = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/migration/migrate-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: {
            country: country || undefined,
            state: state || undefined,
            city: city || undefined,
            processing_status: processingStatus
          },
          options: {
            batch_size: 1 // Just to get count
          }
        })
      })

      if (!response.ok) {
        throw new Error('Failed to preview POIs')
      }

      // For now, we'll estimate based on filters
      // In production, create a separate endpoint for counting
      setPreviewCount(null) // Will be set after migration starts
    } catch (error) {
      console.error('Preview error:', error)
      setError('Failed to preview POIs')
    } finally {
      setIsLoading(false)
    }
  }

  // Start migration
  const startMigration = async () => {
    setIsMigrating(true)
    setError(null)
    setSuccess(null)
    setResults([])
    setProgress({
      total: 0,
      processed: 0,
      successful: 0,
      failed: 0,
      percentage: 0
    })

    try {
      const response = await fetch('/api/migration/migrate-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: {
            country: country || undefined,
            state: state || undefined,
            city: city || undefined,
            processing_status: processingStatus
          },
          options: {
            batch_size: batchSize,
            mode,
            auto_generate_audio: autoGenerateAudio,
            auto_approve_if_satisfactory: autoApprove,
            skip_if_exists: skipIfExists
          }
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Migration failed')
      }

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || 'Migration failed')
      }

      setResults(data.results || [])
      setProgress({
        total: data.total_pois || 0,
        processed: data.processed || 0,
        successful: data.successful || 0,
        failed: data.failed || 0,
        percentage: data.total_pois > 0 ? Math.round((data.processed / data.total_pois) * 100) : 0
      })

      setSuccess(`Migration completed! ${data.successful} successful, ${data.failed} failed`)
    } catch (error) {
      console.error('Migration error:', error)
      setError(error instanceof Error ? error.message : 'Unknown error')
    } finally {
      setIsMigrating(false)
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          POI Migration: Homolog → Core
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Migrate POIs from homolog.pois to core.attractions with full pipeline processing
        </p>
      </div>

      {/* Filters Section */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-5 h-5 text-gray-500" />
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Filters</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Country */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Country
            </label>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              disabled={isMigrating}
            >
              <option value="">All Countries</option>
              {locationData.countries.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* State */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              State
            </label>
            <select
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              disabled={isMigrating || !country}
            >
              <option value="">All States</option>
              {locationData.states.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* City */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              City
            </label>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              disabled={isMigrating || !state}
            >
              <option value="">All Cities</option>
              {locationData.cities.map((c) => (
                <option key={c.name || ''} value={c.name || ''}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Processing Status */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Processing Status
            </label>
            <select
              value={processingStatus}
              onChange={(e) => setProcessingStatus(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              disabled={isMigrating}
            >
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>
      </div>

      {/* Configuration Section */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Settings className="w-5 h-5 text-gray-500" />
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Configuration</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Batch Size */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Batch Size
            </label>
            <select
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              disabled={isMigrating}
            >
              <option value={10}>10 POIs</option>
              <option value={25}>25 POIs</option>
              <option value={50}>50 POIs</option>
              <option value={100}>100 POIs</option>
            </select>
          </div>

          {/* Mode */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Processing Mode
            </label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              disabled={isMigrating}
            >
              <option value="migration_only">Migration Only</option>
              <option value="migration_description">Migration + Description</option>
              <option value="migration_description_audio">Migration + Description + Audio</option>
              <option value="full">Full Pipeline</option>
            </select>
          </div>

          {/* Options */}
          <div className="md:col-span-2 space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoGenerateAudio}
                onChange={(e) => setAutoGenerateAudio(e.target.checked)}
                disabled={isMigrating}
                className="rounded border-gray-300"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Auto-generate audio when description is approved
              </span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoApprove}
                onChange={(e) => setAutoApprove(e.target.checked)}
                disabled={isMigrating}
                className="rounded border-gray-300"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Auto-approve POI if all criteria are met
              </span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={skipIfExists}
                onChange={(e) => setSkipIfExists(e.target.checked)}
                disabled={isMigrating}
                className="rounded border-gray-300"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Skip POIs that already exist in core
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* Progress Section */}
      {progress && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Progress</h2>
          
          <div className="mb-4">
            <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-1">
              <span>Processing</span>
              <span>{progress.percentage}%</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-gray-500">Total</div>
              <div className="font-semibold text-gray-900 dark:text-white">{progress.total}</div>
            </div>
            <div>
              <div className="text-gray-500">Successful</div>
              <div className="font-semibold text-green-600">{progress.successful}</div>
            </div>
            <div>
              <div className="text-gray-500">Failed</div>
              <div className="font-semibold text-red-600">{progress.failed}</div>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
        <div className="flex gap-4">
          <button
            onClick={startMigration}
            disabled={isMigrating || isLoading}
            className={cn(
              "flex items-center gap-2 px-6 py-3 rounded-md font-medium",
              "bg-blue-600 text-white hover:bg-blue-700",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {isMigrating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Migrating...
              </>
            ) : (
              <>
                <Play className="w-5 h-5" />
                Start Migration
              </>
            )}
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6 flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
          <span className="text-red-800 dark:text-red-200">{error}</span>
        </div>
      )}

      {success && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 mb-6 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
          <span className="text-green-800 dark:text-green-200">{success}</span>
        </div>
      )}

      {/* Results Table */}
      {results.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Results</h2>
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-2 px-4 text-gray-700 dark:text-gray-300">POI Name</th>
                  <th className="text-left py-2 px-4 text-gray-700 dark:text-gray-300">Status</th>
                  <th className="text-left py-2 px-4 text-gray-700 dark:text-gray-300">Attraction ID</th>
                  <th className="text-left py-2 px-4 text-gray-700 dark:text-gray-300">Error</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result, idx) => (
                  <tr key={idx} className="border-b border-gray-100 dark:border-gray-700">
                    <td className="py-2 px-4 text-gray-900 dark:text-white">{result.poi_name}</td>
                    <td className="py-2 px-4">
                      {result.success ? (
                        <span className="text-green-600 dark:text-green-400">Success</span>
                      ) : (
                        <span className="text-red-600 dark:text-red-400">Failed</span>
                      )}
                    </td>
                    <td className="py-2 px-4 text-gray-600 dark:text-gray-400">
                      {result.attraction_id || '-'}
                    </td>
                    <td className="py-2 px-4 text-red-600 dark:text-red-400">
                      {result.error || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

