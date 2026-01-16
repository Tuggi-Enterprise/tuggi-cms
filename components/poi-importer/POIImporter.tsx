'use client'

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Play, RotateCcw, MapPin, Loader2, CheckCircle2, XCircle, Info, Settings2, BarChart3, Save, History, ChevronDown } from 'lucide-react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { POIImporterMap, POIImporterMapRef } from './POIImporterMap'
import { cn } from '@/lib/utils'
import { PolygonService } from '@/lib/services/polygon-service'
import { SavedPolygon } from '@/types/poi-importer'

interface Point {
  lat: number
  lng: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  result?: any
  error?: string
}

export function POIImporter() {
  const supabase = useSupabaseClient()
  const [range, setRange] = useState(1) // km
  const [points, setPoints] = useState<Point[]>([])
  const [isDrawing, setIsDrawing] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [selectedBounds, setSelectedBounds] = useState<google.maps.LatLngBounds | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [savedPolygons, setSavedPolygons] = useState<SavedPolygon[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const mapRef = useRef<POIImporterMapRef>(null)

  const polygonService = useMemo(() => new PolygonService(supabase), [supabase])

  const fetchHistory = useCallback(async () => {
    try {
      const data = await polygonService.fetchSavedPolygons()
      setSavedPolygons(data)
    } catch (err) {
      console.error('Error fetching history:', err)
    }
  }, [polygonService])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  const addLog = useCallback((message: string) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${message}`, ...prev].slice(0, 50))
  }, [])

  const generateGrid = useCallback((bounds: google.maps.LatLngBounds) => {
    const ne = bounds.getNorthEast()
    const sw = bounds.getSouthWest()
    
    const latStep = range / 111.32 // 1 degree lat is approx 111.32 km
    const avgLat = (ne.lat() + sw.lat()) / 2
    const lngStep = range / (111.32 * Math.cos(avgLat * Math.PI / 180))

    const newPoints: Point[] = []
    
    // Ensure at least one point in center if range is larger than bounds
    const centerLat = avgLat
    const centerLng = (ne.lng() + sw.lng()) / 2

    // Simple grid generation
    for (let lat = sw.lat() + latStep/2; lat <= ne.lat() + latStep/2; lat += latStep) {
      for (let lng = sw.lng() + lngStep/2; lng <= ne.lng() + lngStep/2; lng += lngStep) {
        newPoints.push({
          lat,
          lng,
          status: 'pending'
        })
      }
    }

    // Fallback if no points generated (e.g. very small area)
    if (newPoints.length === 0) {
      newPoints.push({ lat: centerLat, lng: centerLng, status: 'pending' })
    }

    return newPoints
  }, [range])

  const handleAreaChange = useCallback((bounds: google.maps.LatLngBounds | null) => {
    setSelectedBounds(bounds)
    if (!bounds) {
      setPoints([])
      setCurrentIndex(-1)
      return
    }

    const newPoints = generateGrid(bounds)
    setPoints(newPoints)
    setCurrentIndex(-1)
    addLog(`Area selected: ${newPoints.length} points generated with ${range}km range.`)
  }, [generateGrid, range, addLog])

  // Re-generate grid if range changes while bounds exist
  useEffect(() => {
    if (selectedBounds && !isProcessing) {
      const newPoints = generateGrid(selectedBounds)
      setPoints(newPoints)
      setCurrentIndex(-1)
    }
  }, [range, selectedBounds, isProcessing, generateGrid])

  const startProcessing = async () => {
    if (points.length === 0 || isProcessing || !selectedBounds) return

    setIsProcessing(true)
    let startIndex = currentIndex === -1 || currentIndex >= points.length ? 0 : currentIndex
    
    if (startIndex === 0) {
      // Auto-save the area if it's the first time processing this area
      const ne = selectedBounds.getNorthEast()
      const sw = selectedBounds.getSouthWest()
      const paths = [
        { lat: ne.lat(), lng: ne.lng() },
        { lat: ne.lat(), lng: sw.lng() },
        { lat: sw.lat(), lng: sw.lng() },
        { lat: sw.lat(), lng: ne.lng() },
        { lat: ne.lat(), lng: ne.lng() }
      ]

      const name = await polygonService.generatePolygonName(paths)
      
      try {
        await polygonService.savePolygon(name, paths)
        fetchHistory()
        addLog(`Area "${name}" auto-saved to history.`)
      } catch (saveErr) {
        console.error('Failed to auto-save area:', saveErr)
      }

      // Reset all points to pending if starting from beginning
      setPoints(prev => prev.map(p => ({ ...p, status: 'pending' })))
    }

    addLog(`Starting capture process for ${points.length - startIndex} points...`)

    for (let i = startIndex; i < points.length; i++) {
      // Note: In a real app we might want to check a 'shouldStop' ref here
      
      setCurrentIndex(i)
      setPoints(prev => prev.map((p, idx) => idx === i ? { ...p, status: 'processing' } : p))
      addLog(`Processing point ${i + 1}/${points.length} (${points[i].lat.toFixed(4)}, ${points[i].lng.toFixed(4)})`)

      try {
        const { data, error } = await supabase.functions.invoke('capture-pois', {
          body: {
            lat: points[i].lat,
            lon: points[i].lng,
            radius: range * 1000 // Convert km to meters
          }
        })

        if (error) throw error

        const resultCount = data?.summary?.kept || 0
        addLog(`Point ${i + 1} completed: Found ${data?.summary?.total_found || 0} POIs, kept ${resultCount}.`)
        
        setPoints(prev => prev.map((p, idx) => idx === i ? { 
          ...p, 
          status: 'completed', 
          result: data 
        } : p))
      } catch (err: any) {
        const errorMsg = err.message || 'Unknown error'
        addLog(`Point ${i + 1} failed: ${errorMsg}`)
        setPoints(prev => prev.map((p, idx) => idx === i ? { 
          ...p, 
          status: 'failed', 
          error: errorMsg 
        } : p))
      }
      
      // Sequential delay to be gentle with APIs
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    
    setIsProcessing(false)
    setCurrentIndex(points.length)
    addLog("Capture process finished.")
  }

  const handleLoadArea = (polygon: SavedPolygon) => {
    const bounds = new google.maps.LatLngBounds()
    polygon.paths.forEach(p => bounds.extend(p))
    mapRef.current?.setBounds(bounds)
    setShowHistory(false)
    addLog(`Area "${polygon.name}" loaded.`)
  }

  const resetProcess = () => {
    setPoints(prev => prev.map(p => ({ ...p, status: 'pending', result: undefined, error: undefined })))
    setCurrentIndex(-1)
    setLogs([])
    addLog("Process reset.")
  }

  const stats = useMemo(() => {
    const completed = points.filter(p => p.status === 'completed').length
    const failed = points.filter(p => p.status === 'failed').length
    const totalKept = points.reduce((acc, p) => acc + (p.result?.summary?.kept || 0), 0)
    return { completed, failed, totalKept }
  }, [points])

  return (
    <div className="flex h-full flex-col lg:flex-row overflow-hidden">
      {/* Sidebar Controls */}
      <div className="w-full lg:w-96 flex flex-col border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 overflow-y-auto">
        <div className="p-6 space-y-6">
          <div className="flex items-center space-x-2">
            <Settings2 className="w-5 h-5 text-tuggi-blue" />
            <h2 className="text-lg font-semibold dark:text-gray-100">Capture Settings</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Step Range (km)
              </label>
              <div className="flex items-center space-x-4">
                <input
                  type="range"
                  min="0.5"
                  max="5"
                  step="0.5"
                  value={range}
                  disabled={isProcessing}
                  onChange={(e) => setRange(parseFloat(e.target.value))}
                  className="flex-1 accent-tuggi-blue"
                />
                <span className="text-sm font-bold text-tuggi-blue w-12 text-center">
                  {range}km
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Determines the distance between each capture point.
              </p>
            </div>

            <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium dark:text-gray-300">History</span>
                <button 
                  onClick={() => setShowHistory(!showHistory)}
                  className="text-xs text-tuggi-blue flex items-center hover:underline"
                >
                  {showHistory ? 'Hide' : 'Show All'}
                  <ChevronDown className={cn("w-3 h-3 ml-1 transition-transform", showHistory && "rotate-180")} />
                </button>
              </div>

              {showHistory && (
                <div className="mb-4 max-h-40 overflow-y-auto border border-gray-100 dark:border-gray-800 rounded-lg bg-gray-50 dark:bg-gray-900/40 p-2 space-y-1">
                  {savedPolygons.length === 0 ? (
                    <p className="text-[10px] text-gray-400 italic text-center py-2">No history yet</p>
                  ) : (
                    savedPolygons.map(p => (
                      <button
                        key={p.id}
                        onClick={() => handleLoadArea(p)}
                        className="w-full text-left text-[10px] p-2 hover:bg-white dark:hover:bg-gray-800 rounded transition-colors border border-transparent hover:border-gray-200 dark:hover:border-gray-700"
                      >
                        <div className="font-bold truncate">{p.name}</div>
                        <div className="text-gray-400">{new Date(p.created_at).toLocaleDateString()}</div>
                      </button>
                    ))
                  )}
                </div>
              )}

              <div className="flex items-center justify-between mb-4 mt-4">
                <span className="text-sm font-medium dark:text-gray-300">Grid Points:</span>
                <span className="text-sm font-bold dark:text-white">{points.length}</span>
              </div>

              {!selectedBounds && !isProcessing && (
                <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg flex items-start space-x-3">
                  <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    Use the tool on the map to draw a rectangle or polygon over the area you want to capture.
                  </p>
                </div>
              )}

              {points.length > 0 && (
                <div className="space-y-3">
                  <button
                    onClick={startProcessing}
                    disabled={isProcessing}
                    className={cn(
                      "w-full py-3 rounded-lg font-medium flex items-center justify-center space-x-2 transition-all",
                      isProcessing 
                        ? "bg-gray-100 text-gray-400 cursor-not-allowed" 
                        : "bg-tuggi-blue text-white hover:bg-blue-600 shadow-lg shadow-blue-500/20"
                    )}
                  >
                    {isProcessing ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Play className="w-5 h-5" />
                    )}
                    <span>{isProcessing ? 'Processing...' : currentIndex > 0 ? 'Resume Capture' : 'Start Capture'}</span>
                  </button>

                  {!isProcessing && currentIndex > -1 && (
                    <button
                      onClick={resetProcess}
                      className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex items-center justify-center space-x-2"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>Reset Progress</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Stats Section */}
        {points.length > 0 && (
          <div className="p-6 border-t border-gray-200 dark:border-gray-800">
            <div className="flex items-center space-x-2 mb-4">
              <BarChart3 className="w-5 h-5 text-tuggi-orange" />
              <h2 className="text-lg font-semibold dark:text-gray-100">Progress Statistics</h2>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded-lg">
                <span className="text-xs text-gray-500">Completed</span>
                <p className="text-xl font-bold text-green-600">{stats.completed}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded-lg">
                <span className="text-xs text-gray-500">POIs Found</span>
                <p className="text-xl font-bold text-tuggi-blue">{stats.totalKept}</p>
              </div>
            </div>
          </div>
        )}

        {/* Logs Section */}
        <div className="flex-1 flex flex-col min-h-0 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
          <div className="px-6 py-4 flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Activity Logs</span>
            {logs.length > 0 && (
              <button 
                onClick={() => setLogs([])}
                className="text-xs text-tuggi-blue hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-2 font-mono text-[10px]">
            {logs.length === 0 ? (
              <p className="text-gray-400 italic">No activity yet...</p>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="text-gray-600 dark:text-gray-400 border-l-2 border-gray-200 dark:border-gray-700 pl-2">
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Map View */}
      <div className="flex-1 relative bg-gray-100">
        <POIImporterMap 
          ref={mapRef}
          height="100%" 
          onAreaChange={handleAreaChange}
          onDrawingModeChange={setIsDrawing}
          history={savedPolygons}
        />
        
        {/* Progress Overlay */}
        {isProcessing && (
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-full max-w-md px-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-4 border border-gray-100 dark:border-gray-700">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold dark:text-white">Capturing POIs...</span>
                <span className="text-sm font-bold text-tuggi-blue">
                  {Math.round(((currentIndex + 1) / points.length) * 100)}%
                </span>
              </div>
              <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                <div 
                  className="bg-tuggi-blue h-full transition-all duration-500 rounded-full"
                  style={{ width: `${((currentIndex + 1) / points.length) * 100}%` }}
                />
              </div>
              <p className="mt-2 text-[10px] text-gray-500 dark:text-gray-400 text-center">
                Point {currentIndex + 1} of {points.length}
              </p>
            </div>
          </div>
        )}

        {/* View Mode Indicator */}
        {isDrawing && (
          <div className="absolute top-4 right-4 bg-orange-500 text-white px-4 py-2 rounded-full text-xs font-bold animate-pulse shadow-lg">
            Drawing Mode Active
          </div>
        )}
      </div>
    </div>
  )
}
