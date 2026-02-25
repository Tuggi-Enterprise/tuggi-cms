'use client'

import React from 'react'
import { Direction, DIRECTION_OPTIONS } from '@/types/trigger-points'
import { cn } from '@/lib/utils'
import { useCmsUser } from '@/lib/hooks/useCmsUser'

interface DirectionSelectorProps {
  value: Direction | null
  onChange: (direction: Direction | null) => void
  disabled?: boolean
  className?: string
}

export function DirectionSelector({ 
  value, 
  onChange, 
  disabled = false, 
  className = '' 
}: DirectionSelectorProps) {
  const { isViewer } = useCmsUser()
  const effectiveDisabled = disabled || isViewer

  const handleDirectionClick = (direction: Direction) => {
    if (effectiveDisabled) return
    
    // Toggle behavior - if clicking the same direction, deselect it
    if (value === direction) {
      onChange(null)
    } else {
      onChange(direction)
    }
  }

  const handleClear = () => {
    if (disabled) return
    onChange(null)
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Direction (optional)
        </label>
        {value && (
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-50"
          >
            Clear
          </button>
        )}
      </div>
      
      <div className="grid grid-cols-2 gap-2 max-w-[200px] mx-auto">
        {/* Top row - Front */}
        <div className="col-span-2 flex justify-center">
          <button
            type="button"
            onClick={() => handleDirectionClick('front')}
            disabled={disabled}
            className={cn(
              "flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2 transition-all duration-200 hover:scale-105",
              "focus:outline-none focus:ring-2 focus:ring-tuggi-blue focus:ring-offset-2",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100",
              value === 'front' 
                ? "border-tuggi-blue bg-tuggi-blue text-white shadow-lg" 
                : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-tuggi-blue hover:bg-tuggi-blue/10"
            )}
            title="Front - In front of you"
          >
            <span className="text-2xl">⬆️</span>
            <span className="text-xs font-medium mt-1">Front</span>
          </button>
        </div>
        
        {/* Middle row - Left and Right */}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => handleDirectionClick('left')}
            disabled={disabled}
            className={cn(
              "flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2 transition-all duration-200 hover:scale-105",
              "focus:outline-none focus:ring-2 focus:ring-tuggi-blue focus:ring-offset-2",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100",
              value === 'left' 
                ? "border-tuggi-blue bg-tuggi-blue text-white shadow-lg" 
                : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-tuggi-blue hover:bg-tuggi-blue/10"
            )}
            title="Left - To your left"
          >
            <span className="text-2xl">⬅️</span>
            <span className="text-xs font-medium mt-1">Left</span>
          </button>
        </div>
        
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => handleDirectionClick('right')}
            disabled={disabled}
            className={cn(
              "flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2 transition-all duration-200 hover:scale-105",
              "focus:outline-none focus:ring-2 focus:ring-tuggi-blue focus:ring-offset-2",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100",
              value === 'right' 
                ? "border-tuggi-blue bg-tuggi-blue text-white shadow-lg" 
                : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-tuggi-blue hover:bg-tuggi-blue/10"
            )}
            title="Right - To your right"
          >
            <span className="text-2xl">➡️</span>
            <span className="text-xs font-medium mt-1">Right</span>
          </button>
        </div>
        
        {/* Bottom row - Back */}
        <div className="col-span-2 flex justify-center">
          {/* <button
            type="button"
            onClick={() => handleDirectionClick('back')}
            disabled={disabled}
            className={cn(
              "flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2 transition-all duration-200 hover:scale-105",
              "focus:outline-none focus:ring-2 focus:ring-tuggi-blue focus:ring-offset-2",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100",
              value === 'back' 
                ? "border-tuggi-blue bg-tuggi-blue text-white shadow-lg" 
                : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-tuggi-blue hover:bg-tuggi-blue/10"
            )}
            title="Back - Behind you"
          >
            <span className="text-2xl">⬇️</span>
            <span className="text-xs font-medium mt-1">Back</span>
          </button> */}
        </div>
      </div>
      
      {/* Help text */}
      <div className="text-xs text-center text-gray-500 dark:text-gray-400 mt-3">
        <p>This direction will be used in the audio narration,</p>
        <p>e.g. &quot;To your right...&quot; or &quot;In front of you...&quot;</p>
      </div>
      
      {/* Selected direction indicator */}
      {value && (
        <div className="text-sm text-center text-tuggi-blue dark:text-tuggi-blue-light font-medium">
          Selected: {DIRECTION_OPTIONS.find(opt => opt.value === value)?.description}
        </div>
      )}
    </div>
  )
}