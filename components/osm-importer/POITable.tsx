/**
 * POI Table Component - KISS SIMPLIFIED
 * 
 * Simple table view for POIs with editing and selection
 * 
 * @module components/osm-importer/POITable
 */

'use client'

import { useState } from 'react'
import { CheckSquare, Square, Edit3, Save, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SimpleOSMPOI } from '@/lib/hooks/use-osm-importer-simple'
import { OSMService } from '@/lib/services/osm-service-simple'

interface POITableProps {
  features: SimpleOSMPOI[]
  selectedFeatures: Set<string>
  onToggleSelection: (id: string) => void
  onEditPOI: (id: string, updates: any) => void
}

export function POITable({ features, selectedFeatures, onToggleSelection, onEditPOI }: POITableProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Record<string, any>>({})

  const handleEdit = (poi: SimpleOSMPOI) => {
    setEditingId(poi._id)
    setEditValues({
      name: poi.properties.name || '',
      city: poi.properties.city || '',
      state: poi.properties.state || '',
      country: poi.properties.country || ''
    })
  }

  const handleSave = (poiId: string) => {
    onEditPOI(poiId, editValues)
    setEditingId(null)
    setEditValues({})
  }

  const handleCancel = () => {
    setEditingId(null)
    setEditValues({})
  }

  const handleEditChange = (field: string, value: string) => {
    setEditValues(prev => ({ ...prev, [field]: value }))
  }

  return (
    <div className="h-full flex flex-col">
      {/* Table Header */}
      <div className="bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800">
        <div className="grid grid-cols-12 gap-4 px-4 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">
          <div className="col-span-1">
            <CheckSquare className="w-4 h-4" />
          </div>
          <div className="col-span-3">Name</div>
          <div className="col-span-2">Category</div>
          <div className="col-span-2">City</div>
          <div className="col-span-2">State</div>
          <div className="col-span-1">Country</div>
          <div className="col-span-1">Actions</div>
        </div>
      </div>

      {/* Table Body */}
      <div className="flex-1 overflow-y-auto">
        {features.map((poi) => {
          const location = OSMService.extractLocation(poi)
          const isSelected = selectedFeatures.has(poi._id)
          const isEditing = editingId === poi._id

          return (
            <div
              key={poi._id}
              className={cn(
                "grid grid-cols-12 gap-4 px-4 py-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 transition",
                isSelected && "bg-blue-50 dark:bg-blue-900/20"
              )}
            >
              {/* Selection Checkbox */}
              <div className="col-span-1 flex items-center">
                <button
                  onClick={() => onToggleSelection(poi._id)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                </button>
              </div>

              {/* Name */}
              <div className="col-span-3 flex items-center">
                {isEditing ? (
                  <input
                    type="text"
                    value={editValues.name}
                    onChange={(e) => handleEditChange('name', e.target.value)}
                    className="w-full px-2 py-1 border rounded text-sm"
                  />
                ) : (
                  <span className="font-medium">{location.name}</span>
                )}
              </div>

              {/* Category */}
              <div className="col-span-2 flex items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {location.category}
                </span>
              </div>

              {/* City */}
              <div className="col-span-2 flex items-center">
                {isEditing ? (
                  <input
                    type="text"
                    value={editValues.city}
                    onChange={(e) => handleEditChange('city', e.target.value)}
                    className="w-full px-2 py-1 border rounded text-sm"
                  />
                ) : (
                  <span className="text-sm">{location.city}</span>
                )}
              </div>

              {/* State */}
              <div className="col-span-2 flex items-center">
                {isEditing ? (
                  <input
                    type="text"
                    value={editValues.state}
                    onChange={(e) => handleEditChange('state', e.target.value)}
                    className="w-full px-2 py-1 border rounded text-sm"
                  />
                ) : (
                  <span className="text-sm">{location.state}</span>
                )}
              </div>

              {/* Country */}
              <div className="col-span-1 flex items-center">
                {isEditing ? (
                  <input
                    type="text"
                    value={editValues.country}
                    onChange={(e) => handleEditChange('country', e.target.value)}
                    className="w-full px-2 py-1 border rounded text-sm"
                  />
                ) : (
                  <span className="text-sm">{location.country}</span>
                )}
              </div>

              {/* Actions */}
              <div className="col-span-1 flex items-center gap-2">
                {isEditing ? (
                  <>
                    <button
                      onClick={() => handleSave(poi._id)}
                      className="text-green-600 hover:text-green-700"
                    >
                      <Save className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleCancel}
                      className="text-red-600 hover:text-red-700"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => handleEdit(poi)}
                    className="text-blue-600 hover:text-blue-700"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
