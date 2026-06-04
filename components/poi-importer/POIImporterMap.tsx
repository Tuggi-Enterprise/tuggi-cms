'use client'

import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react'
import { Wrapper, Status } from '@googlemaps/react-wrapper'
import { ZoomIn, ZoomOut, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { SavedPolygon } from '@/types/poi-importer'

import { GOOGLE_MAPS_LIBRARIES, GOOGLE_MAPS_VERSION } from '@/lib/maps-config'

const LIBRARIES = GOOGLE_MAPS_LIBRARIES

export interface POIImporterMapRef {
  setBounds: (bounds: google.maps.LatLngBounds) => void
  clear: () => void
}

interface POIImporterMapProps {
  onAreaChange: (bounds: google.maps.LatLngBounds | null) => void
  onDrawingModeChange: (isDrawing: boolean) => void
  history?: SavedPolygon[]
  height?: string
  className?: string
}

const MapInner = forwardRef<POIImporterMapRef, POIImporterMapProps>((props, ref) => {
  const { onAreaChange, onDrawingModeChange, height, className, history } = props
  const t = useTranslations('Pages.POIImporter.actions')
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const drawingManagerRef = useRef<google.maps.drawing.DrawingManager | null>(null)
  const [currentShape, setCurrentShape] = useState<google.maps.Rectangle | google.maps.Polygon | null>(null)
  const historyPolygonsRef = useRef<google.maps.Polygon[]>([])

  useImperativeHandle(ref, () => ({
    setBounds: (bounds: google.maps.LatLngBounds) => {
      if (!mapInstanceRef.current) return
      
      // Clear existing
      if (currentShape) {
        currentShape.setMap(null)
      }

      // Create a rectangle for the bounds
      const rect = new google.maps.Rectangle({
        bounds,
        fillColor: '#3B82F6',
        fillOpacity: 0.2,
        strokeWeight: 2,
        strokeColor: '#3B82F6',
        editable: true,
        draggable: true,
        map: mapInstanceRef.current
      })

      setCurrentShape(rect)
      mapInstanceRef.current.fitBounds(bounds)
      onAreaChange(bounds)

      google.maps.event.addListener(rect, 'bounds_changed', () => {
        onAreaChange(rect.getBounds())
      })
    },
    clear: () => {
      clearShape()
    }
  }))

  const clearShape = useCallback(() => {
    if (currentShape) {
      currentShape.setMap(null)
      setCurrentShape(null)
      onAreaChange(null)
    }
  }, [currentShape, onAreaChange])

  const initializeMap = useCallback(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    const map = new google.maps.Map(mapRef.current, {
      center: { lat: -23.5505, lng: -46.6333 }, // São Paulo as default
      zoom: 12,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      zoomControl: false,
      gestureHandling: 'greedy',
    })

    mapInstanceRef.current = map

    // Area drawing requires the deprecated google.maps.drawing.DrawingManager,
    // removed from the Maps JS API in v3.65. Degrade gracefully if absent.
    if (google.maps.drawing) {
          const drawingManager = new google.maps.drawing.DrawingManager({
            drawingMode: null,
            drawingControl: true,
            drawingControlOptions: {
              position: google.maps.ControlPosition.TOP_CENTER,
              drawingModes: [
                google.maps.drawing.OverlayType.RECTANGLE,
                google.maps.drawing.OverlayType.POLYGON,
              ],
            },
            rectangleOptions: {
              fillColor: '#3B82F6',
              fillOpacity: 0.2,
              strokeWeight: 2,
              strokeColor: '#3B82F6',
              editable: true,
              draggable: true,
            },
            polygonOptions: {
              fillColor: '#3B82F6',
              fillOpacity: 0.2,
              strokeWeight: 2,
              strokeColor: '#3B82F6',
              editable: true,
              draggable: true,
            },
          })

          drawingManager.setMap(map)
          drawingManagerRef.current = drawingManager

          google.maps.event.addListener(drawingManager, 'overlaycomplete', (event: any) => {
            // Clear previous shape if exists
            if (currentShape) {
              currentShape.setMap(null)
            }

            const newShape = event.overlay
            drawingManager.setDrawingMode(null) // Exit drawing mode
            setCurrentShape(newShape)

            // Calculate bounds
            if (event.type === google.maps.drawing.OverlayType.RECTANGLE) {
              onAreaChange(newShape.getBounds())
        
              google.maps.event.addListener(newShape, 'bounds_changed', () => {
                onAreaChange(newShape.getBounds())
              })
            } else if (event.type === google.maps.drawing.OverlayType.POLYGON) {
              const bounds = new google.maps.LatLngBounds()
              newShape.getPath().forEach((element: any) => {
                bounds.extend(element)
              })
              onAreaChange(bounds)

              google.maps.event.addListener(newShape.getPath(), 'set_at', () => {
                const b = new google.maps.LatLngBounds()
                newShape.getPath().forEach((element: any) => b.extend(element))
                onAreaChange(b)
              })
              google.maps.event.addListener(newShape.getPath(), 'insert_at', () => {
                const b = new google.maps.LatLngBounds()
                newShape.getPath().forEach((element: any) => b.extend(element))
                onAreaChange(b)
              })
            }
          })

          google.maps.event.addListener(drawingManager, 'drawingmode_changed', () => {
            onDrawingModeChange(drawingManager.getDrawingMode() !== null)
          })
    } else {
      console.warn('⚠️ [POIImporterMap] Drawing tools unavailable (google.maps.drawing removed in Maps v3.65)')
    }
  }, [onAreaChange, onDrawingModeChange, currentShape])

  const updateHistoryOnMap = useCallback(() => {
    if (!mapInstanceRef.current || !history) return

    // Clear existing history polygons
    historyPolygonsRef.current.forEach(p => p.setMap(null))
    historyPolygonsRef.current = []

    history.forEach(savedArea => {
      const poly = new google.maps.Polygon({
        paths: savedArea.paths,
        fillColor: '#6B7280', // Gray for history
        fillOpacity: 0.1,
        strokeWeight: 1,
        strokeColor: '#9CA3AF',
        clickable: false,
        map: mapInstanceRef.current!
      })
      historyPolygonsRef.current.push(poly)
    })
  }, [history])

  useEffect(() => {
    if (window.google && !mapInstanceRef.current) {
      initializeMap()
    }
  }, [initializeMap])

  useEffect(() => {
    updateHistoryOnMap()
  }, [updateHistoryOnMap])

  return (
    <div className="w-full h-full relative">
      <div ref={mapRef} className="w-full h-full" />
      
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-1 flex flex-col gap-1">
          <button
            onClick={() => mapInstanceRef.current?.setZoom((mapInstanceRef.current?.getZoom() || 0) + 1)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
          >
            <ZoomIn className="w-4 h-4 text-gray-700 dark:text-gray-300" />
          </button>
          <button
            onClick={() => mapInstanceRef.current?.setZoom((mapInstanceRef.current?.getZoom() || 0) - 1)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
          >
            <ZoomOut className="w-4 h-4 text-gray-700 dark:text-gray-300" />
          </button>
        </div>
        
        {currentShape && (
          <button
            onClick={clearShape}
            className="bg-red-600 text-white p-2 rounded-lg shadow-md hover:bg-red-700 transition-colors flex items-center justify-center"
            title={t('clear')}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
})

export const POIImporterMap = forwardRef<POIImporterMapRef, POIImporterMapProps>((props, ref) => {
  const t = useTranslations('Common.status')
  

  return (
    <div className={cn("relative w-full overflow-hidden border border-gray-200 dark:border-gray-800", props.className)} style={{ height: props.height || '600px' }}>
      <Wrapper
        apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}
        libraries={LIBRARIES}
        version={GOOGLE_MAPS_VERSION}
        render={(status) => {
          if (status === Status.LOADING) return <div className="h-full flex items-center justify-center bg-gray-100 animate-pulse">{t('loading')}</div>
          if (status === Status.FAILURE) return <div className="h-full flex items-center justify-center text-red-500">{t('error')}</div>
          return <MapInner {...props} ref={ref} />
        }}
      />
    </div>
  )
})

POIImporterMap.displayName = 'POIImporterMap'
