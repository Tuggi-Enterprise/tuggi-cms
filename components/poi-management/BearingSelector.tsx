'use client'

import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

interface BearingSelectorProps {
  value?: number | null
  onChange: (bearing: number | null) => void
  disabled?: boolean
  className?: string
}

export function BearingSelector({ 
  value, 
  onChange, 
  disabled = false,
  className 
}: BearingSelectorProps) {
  const t = useTranslations('Modals.TriggerPointsManager')
  const [isDragging, setIsDragging] = useState(false)
  const compassRef = useRef<HTMLDivElement>(null)
  const size = 120
  const center = size / 2
  const radius = 45

  // Convert bearing to angle (0° = North, clockwise)
  const bearingToAngle = (bearing: number) => {
    return (bearing - 90) * (Math.PI / 180)
  }

  // Convert mouse position to bearing
  const positionToBearing = useCallback((clientX: number, clientY: number) => {
    if (!compassRef.current) return null
    
    const rect = compassRef.current.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    
    const deltaX = clientX - centerX
    const deltaY = clientY - centerY
    
    let angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI)
    // Convert to bearing (0° = North, clockwise)
    let bearing = (angle + 90) % 360
    if (bearing < 0) bearing += 360
    
    return Math.round(bearing)
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled) return
    e.preventDefault()
    setIsDragging(true)
    
    const bearing = positionToBearing(e.clientX, e.clientY)
    if (bearing !== null) {
      onChange(bearing)
    }
  }, [disabled, positionToBearing, onChange])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || disabled) return
    
    const bearing = positionToBearing(e.clientX, e.clientY)
    if (bearing !== null) {
      onChange(bearing)
    }
  }, [isDragging, disabled, positionToBearing, onChange])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  const clearBearing = () => {
    if (!disabled) {
      onChange(null)
    }
  }

  // Calculate pointer position
  const pointerX = value !== null && value !== undefined 
    ? center + Math.cos(bearingToAngle(value)) * radius
    : center
  const pointerY = value !== null && value !== undefined 
    ? center + Math.sin(bearingToAngle(value)) * radius
    : center

  return (
    <div className={cn('space-y-2', className)}>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        {t('labels.expected_bearing')}
      </label>
      
      <div className="flex items-center space-x-4">
        {/* Compass */}
        <div className="relative">
          <div 
            ref={compassRef}
            className={cn(
              "relative bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 rounded-full cursor-pointer transition-all",
              disabled ? "opacity-50 cursor-not-allowed" : "hover:border-tuggi-blue",
              isDragging && "border-tuggi-blue shadow-lg"
            )}
            style={{ width: size, height: size }}
            onMouseDown={handleMouseDown}
          >
            {/* Compass background */}
            <svg 
              width={size} 
              height={size} 
              className="absolute inset-0"
              viewBox={`0 0 ${size} ${size}`}
            >
              {/* Cardinal directions */}
              <g className="text-xs font-medium fill-gray-600 dark:fill-gray-400">
                <text x={center} y="12" textAnchor="middle" className="text-sm font-bold">N</text>
                <text x={size - 8} y={center + 4} textAnchor="middle">E</text>
                <text x={center} y={size - 4} textAnchor="middle">S</text>
                <text x="8" y={center + 4} textAnchor="middle">W</text>
              </g>
              
              {/* Degree marks */}
              {Array.from({ length: 12 }, (_, i) => {
                const angle = (i * 30) * (Math.PI / 180)
                const x1 = center + Math.cos(angle) * (radius - 5)
                const y1 = center + Math.sin(angle) * (radius - 5)
                const x2 = center + Math.cos(angle) * (radius - 2)
                const y2 = center + Math.sin(angle) * (radius - 2)
                
                return (
                  <line 
                    key={i}
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke="currentColor"
                    strokeWidth="1"
                    className="text-gray-400 dark:text-gray-500"
                  />
                )
              })}
              
              {/* Center dot */}
              <circle 
                cx={center} 
                cy={center} 
                r="2" 
                className="fill-gray-400 dark:fill-gray-500"
              />
              
              {/* Pointer */}
              {value !== null && value !== undefined && (
                <g>
                  {/* Pointer line */}
                  <line 
                    x1={center} 
                    y1={center} 
                    x2={pointerX} 
                    y2={pointerY}
                    stroke="#3B82F6"
                    strokeWidth="2"
                    className="drop-shadow-sm"
                    markerEnd="url(#arrowhead)"
                  />
                  {/* Arrow marker definition */}
                  <defs>
                    <marker
                      id="arrowhead"
                      markerWidth="10"
                      markerHeight="7"
                      refX="9"
                      refY="3.5"
                      orient="auto"
                    >
                      <polygon
                        points="0 0, 10 3.5, 0 7"
                        fill="#3B82F6"
                        className="drop-shadow-sm"
                      />
                    </marker>
                  </defs>
                </g>
              )}
            </svg>
          </div>
        </div>
        
        {/* Value display and controls */}
        <div className="flex-1 space-y-2">
          <div className="flex items-center space-x-2">
            <input
              type="number"
              min="0"
              max="360"
              value={value ?? ''}
              onChange={(e) => {
                const val = e.target.value
                if (val === '') {
                  onChange(null)
                } else {
                  const bearing = Math.max(0, Math.min(360, parseFloat(val)))
                  onChange(isNaN(bearing) ? null : bearing)
                }
              }}
              placeholder="0-360"
              disabled={disabled}
              className="w-20 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white disabled:opacity-50"
            />
            <span className="text-sm text-gray-500 dark:text-gray-400">°</span>
            <button
              type="button"
              onClick={clearBearing}
              disabled={disabled || value === null}
              className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('labels.clear')}
            </button>
          </div>
          
          {value !== null && value !== undefined && (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {t('labels.direction_label', { 
                  dir: value === 0 || value === 360 ? t('directions.north') : 
                         value === 90 ? t('directions.east') : 
                         value === 180 ? t('directions.south') : 
                         value === 270 ? t('directions.west') : 
                         value < 90 ? t('directions.northeast') :
                         value < 180 ? t('directions.southeast') :
                         value < 270 ? t('directions.southwest') : t('directions.northwest')
                })}
            </div>
          )}
          
          <div className="text-xs text-gray-400 dark:text-gray-500">
            {t('labels.click_drag_compass')}
          </div>
        </div>
      </div>
    </div>
  )
}