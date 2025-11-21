'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { TrailMap, Trail, HeatMapPoint } from '@/components/trail-visualization/TrailMap'
import { UserFilter } from '@/components/trail-visualization/UserFilter'
import { Map, Layers, RefreshCw, AlertCircle, Calendar, Users, Activity } from 'lucide-react'

interface TrailStats {
  total_points: number
  unique_users: number
  unique_trips: number
  date_range?: { start: string; end: string }
}

export default function TrailVisualizationPage() {
  const [trails, setTrails] = useState<Trail[]>([])
  const [heatMapData, setHeatMapData] = useState<HeatMapPoint[]>([])
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [showTrails, setShowTrails] = useState(true)
  const [showHeatMap, setShowHeatMap] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<TrailStats | null>(null)
  const [mapBounds, setMapBounds] = useState<{
    north: number
    south: number
    east: number
    west: number
  } | null>(null)
  const [timeRange, setTimeRange] = useState('30') // days
  const [onlyMoving, setOnlyMoving] = useState(false)
  
  const mapCenterRef = useRef<{ lat: number; lng: number }>({ lat: -23.5505, lng: -46.6333 })
  const mapZoomRef = useRef<number>(13)

  const fetchTrails = useCallback(async () => {
    if (!mapBounds) return

    try {
      setIsLoading(true)
      setError(null)

      const params = new URLSearchParams()
      params.append('bounds', `${mapBounds.north},${mapBounds.south},${mapBounds.east},${mapBounds.west}`)
      
      if (selectedUserIds.length > 0) {
        params.append('userIds', selectedUserIds.join(','))
      }

      // Add time range filter
      const daysAgo = new Date()
      daysAgo.setDate(daysAgo.getDate() - parseInt(timeRange))
      params.append('startDate', daysAgo.toISOString())

      if (onlyMoving) {
        params.append('onlyMoving', 'true')
      }

      params.append('limit', '2000') // Reduced to prevent timeout

      const response = await fetch(`/api/trail-visualization/trails?${params.toString()}`)
      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch trails')
      }

      setTrails(result.data?.trails || [])
      setStats(result.data?.stats || null)
    } catch (err) {
      console.error('Error fetching trails:', err)
      setError(err instanceof Error ? err.message : 'Failed to load trails')
    } finally {
      setIsLoading(false)
    }
  }, [mapBounds, selectedUserIds, timeRange, onlyMoving])

  const fetchHeatMap = useCallback(async () => {
    if (!mapBounds || !showHeatMap) return

    try {
      const params = new URLSearchParams()
      params.append('bounds', `${mapBounds.north},${mapBounds.south},${mapBounds.east},${mapBounds.west}`)
      
      // Add time range filter
      const daysAgo = new Date()
      daysAgo.setDate(daysAgo.getDate() - parseInt(timeRange))
      params.append('startDate', daysAgo.toISOString())

      params.append('gridSize', '0.001') // ~100m grid

      const response = await fetch(`/api/trail-visualization/heatmap?${params.toString()}`)
      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch heat map')
      }

      setHeatMapData(result.data?.heatmap || [])
    } catch (err) {
      console.error('Error fetching heat map:', err)
      // Don't set error state for heat map, just log it
      console.error(err)
    }
  }, [mapBounds, showHeatMap, timeRange])

  // Fetch trails when bounds change
  useEffect(() => {
    if (mapBounds && showTrails) {
      // Increase debounce time to avoid too many requests
      const timeoutId = setTimeout(() => {
        fetchTrails()
      }, 1000) // Increased debounce to 1 second
      return () => clearTimeout(timeoutId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapBounds, showTrails]) // fetchTrails is stable via useCallback

  // Fetch heat map when bounds change and heat map is enabled
  useEffect(() => {
    if (mapBounds && showHeatMap) {
      const timeoutId = setTimeout(() => {
        fetchHeatMap()
      }, 500) // Debounce
      return () => clearTimeout(timeoutId)
    }
  }, [mapBounds, showHeatMap, fetchHeatMap])

  // Fetch trails when filters change
  useEffect(() => {
    if (mapBounds && showTrails) {
      fetchTrails()
    }
  }, [selectedUserIds, timeRange, onlyMoving])

  const handleBoundsChange = useCallback((bounds: {
    north: number
    south: number
    east: number
    west: number
  }) => {
    setMapBounds(bounds)
  }, [])

  const handleRefresh = () => {
    if (showTrails) {
      fetchTrails()
    }
    if (showHeatMap) {
      fetchHeatMap()
    }
  }

  return (
    <div className="p-6 space-y-6 bg-tuggi-background min-h-screen">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-tuggi-text dark:text-white flex items-center">
            <Map className="h-8 w-8 mr-3" />
            Trail Visualization
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Visualize user movement patterns and identify high-traffic areas
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Sidebar - Filters */}
        <div className="lg:col-span-1 space-y-4">
          <UserFilter
            selectedUserIds={selectedUserIds}
            onSelectionChange={setSelectedUserIds}
          />

          {/* Time Range Filter */}
          <div className="tuggi-card p-4">
            <h3 className="text-sm font-semibold text-tuggi-text dark:text-white mb-3 flex items-center">
              <Calendar className="h-4 w-4 mr-2" />
              Time Range
            </h3>
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="365">Last year</option>
            </select>
          </div>

          {/* View Toggle */}
          <div className="tuggi-card p-4">
            <h3 className="text-sm font-semibold text-tuggi-text dark:text-white mb-3 flex items-center">
              <Layers className="h-4 w-4 mr-2" />
              View Mode
            </h3>
            <div className="space-y-2">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={showTrails}
                  onChange={(e) => setShowTrails(e.target.checked)}
                  className="mr-2"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Show Trails</span>
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={showHeatMap}
                  onChange={(e) => setShowHeatMap(e.target.checked)}
                  className="mr-2"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Show Heat Map</span>
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={onlyMoving}
                  onChange={(e) => setOnlyMoving(e.target.checked)}
                  className="mr-2"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Only Moving Points</span>
              </label>
            </div>
          </div>

          {/* Stats */}
          {stats && (
            <div className="tuggi-card p-4">
              <h3 className="text-sm font-semibold text-tuggi-text dark:text-white mb-3 flex items-center">
                <Activity className="h-4 w-4 mr-2" />
                Statistics
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Total Points:</span>
                  <span className="font-medium text-tuggi-text dark:text-white">{stats.total_points.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Users:</span>
                  <span className="font-medium text-tuggi-text dark:text-white">{stats.unique_users}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Trips:</span>
                  <span className="font-medium text-tuggi-text dark:text-white">{stats.unique_trips}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Side - Map */}
        <div className="lg:col-span-3">
          <div className="tuggi-card p-4">
            {error && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center">
                <AlertCircle className="h-5 w-5 text-red-500 mr-2" />
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <TrailMap
              center={mapCenterRef.current}
              zoom={mapZoomRef.current}
              trails={trails}
              heatMapData={heatMapData}
              showTrails={showTrails}
              showHeatMap={showHeatMap}
              selectedUserIds={selectedUserIds}
              onBoundsChange={handleBoundsChange}
              isLoading={isLoading}
              height="600px"
              className="rounded-lg overflow-hidden"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

