/**
 * Split View Component
 * 
 * Combined table and map view for OSM POIs
 * 
 * @module components/osm-importer/SplitView
 */

'use client'

import { useState } from 'react'
import { TableView } from './TableView'
import { MapView } from './MapView'
import { GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SplitViewProps {
  sortBy: 'name' | 'city' | 'category' | 'date'
  sortOrder: 'asc' | 'desc'
}

export function SplitView({ sortBy, sortOrder }: SplitViewProps) {
  const [splitRatio, setSplitRatio] = useState(50) // Percentage for table
  const [isDragging, setIsDragging] = useState(false)

  const handleMouseDown = () => {
    setIsDragging(true)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return

    const container = e.currentTarget.parentElement
    if (!container) return

    const rect = container.getBoundingClientRect()
    const x = e.clientX - rect.left
    const percentage = (x / rect.width) * 100
    
    // Constrain between 20% and 80%
    const constrainedPercentage = Math.max(20, Math.min(80, percentage))
    setSplitRatio(constrainedPercentage)
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  return (
    <div 
      className="h-full flex"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Table View */}
      <div 
        className="flex-shrink-0 border-r border-gray-200 dark:border-gray-800"
        style={{ width: `${splitRatio}%` }}
      >
        <TableView sortBy={sortBy} sortOrder={sortOrder} />
      </div>

      {/* Resize Handle */}
      <div
        className={cn(
          "w-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 cursor-col-resize flex items-center justify-center group transition",
          isDragging && "bg-blue-500"
        )}
        onMouseDown={handleMouseDown}
      >
        <GripVertical className={cn(
          "w-3 h-3 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition",
          isDragging && "text-blue-500"
        )} />
      </div>

      {/* Map View */}
      <div 
        className="flex-1"
        style={{ width: `${100 - splitRatio}%` }}
      >
        <MapView />
      </div>
    </div>
  )
}
