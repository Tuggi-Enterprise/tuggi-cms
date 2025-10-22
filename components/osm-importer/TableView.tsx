/**
 * Table View Component
 * 
 * Virtualized table view for OSM POIs with inline editing
 * 
 * @module components/osm-importer/TableView
 */

'use client'

import { useState, useMemo } from 'react'
import { 
  CheckSquare, Square, Edit3, Save, X, 
  MapPin, Tag, Calendar, AlertCircle 
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOSMImporter } from '@/lib/hooks/use-osm-importer'
import { EditableOSMPOI } from '@/types/osm-importer'

interface TableViewProps {
  sortBy: 'name' | 'city' | 'category' | 'date'
  sortOrder: 'asc' | 'desc'
}

export function TableView({ sortBy, sortOrder }: TableViewProps) {
  const {
    features,
    selectedFeatures,
    toggleSelection,
    editPOI,
    getPrimaryCategory,
    extractLocationFromOSMTags
  } = useOSMImporter()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Record<string, any>>({})

  // Sort features
  const sortedFeatures = useMemo(() => {
    return [...features].sort((a, b) => {
      let aValue: any, bValue: any

      switch (sortBy) {
        case 'name':
          aValue = extractLocationFromOSMTags(a.properties.tags).name || ''
          bValue = extractLocationFromOSMTags(b.properties.tags).name || ''
          break
        case 'city':
          aValue = extractLocationFromOSMTags(a.properties.tags).city || ''
          bValue = extractLocationFromOSMTags(b.properties.tags).city || ''
          break
        case 'category':
          aValue = getPrimaryCategory(a.properties.tags) || ''
          bValue = getPrimaryCategory(b.properties.tags) || ''
          break
        case 'date':
          aValue = a.properties.tags['@timestamp'] || ''
          bValue = b.properties.tags['@timestamp'] || ''
          break
        default:
          return 0
      }

      if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1
      if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1
      return 0
    })
  }, [features, sortBy, sortOrder, extractLocationFromOSMTags, getPrimaryCategory])

  const handleEdit = (poi: EditableOSMPOI) => {
    setEditingId(poi._id)
    setEditValues({
      name: extractLocationFromOSMTags(poi.properties.tags).name || '',
      city: extractLocationFromOSMTags(poi.properties.tags).city || '',
      state: extractLocationFromOSMTags(poi.properties.tags).state || '',
      country: extractLocationFromOSMTags(poi.properties.tags).country || ''
    })
  }

  const handleSave = (poiId: string) => {
    Object.entries(editValues).forEach(([field, value]) => {
      if (value !== '') {
        editPOI(poiId, field, value)
      }
    })
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
        {sortedFeatures.map((poi) => {
          const location = extractLocationFromOSMTags(poi.properties.tags)
          const category = getPrimaryCategory(poi.properties.tags)
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
                  onClick={() => toggleSelection(poi._id)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                >
                  {isSelected ? (
                    <CheckSquare className="w-4 h-4 text-blue-600" />
                  ) : (
                    <Square className="w-4 h-4 text-gray-400" />
                  )}
                </button>
              </div>

              {/* Name */}
              <div className="col-span-3 flex items-center">
                {isEditing ? (
                  <input
                    type="text"
                    value={editValues.name || ''}
                    onChange={(e) => handleEditChange('name', e.target.value)}
                    className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-950"
                    placeholder="POI Name"
                  />
                ) : (
                  <div className="flex items-center gap-2 min-w-0">
                    <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="truncate font-medium">
                      {location.name || 'Unnamed POI'}
                    </span>
                  </div>
                )}
              </div>

              {/* Category */}
              <div className="col-span-2 flex items-center">
                {isEditing ? (
                  <input
                    type="text"
                    value={editValues.category || category || ''}
                    onChange={(e) => handleEditChange('category', e.target.value)}
                    className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-950"
                    placeholder="Category"
                  />
                ) : (
                  <div className="flex items-center gap-2 min-w-0">
                    <Tag className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="truncate text-sm">
                      {category || 'No category'}
                    </span>
                  </div>
                )}
              </div>

              {/* City */}
              <div className="col-span-2 flex items-center">
                {isEditing ? (
                  <input
                    type="text"
                    value={editValues.city || ''}
                    onChange={(e) => handleEditChange('city', e.target.value)}
                    className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-950"
                    placeholder="City"
                  />
                ) : (
                  <span className="truncate text-sm">
                    {location.city || 'Unknown'}
                  </span>
                )}
              </div>

              {/* State */}
              <div className="col-span-2 flex items-center">
                {isEditing ? (
                  <input
                    type="text"
                    value={editValues.state || ''}
                    onChange={(e) => handleEditChange('state', e.target.value)}
                    className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-950"
                    placeholder="State"
                  />
                ) : (
                  <span className="truncate text-sm">
                    {location.state || 'Unknown'}
                  </span>
                )}
              </div>

              {/* Country */}
              <div className="col-span-1 flex items-center">
                {isEditing ? (
                  <input
                    type="text"
                    value={editValues.country || ''}
                    onChange={(e) => handleEditChange('country', e.target.value)}
                    className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-950"
                    placeholder="Country"
                  />
                ) : (
                  <span className="truncate text-sm">
                    {location.country || 'Unknown'}
                  </span>
                )}
              </div>

              {/* Actions */}
              <div className="col-span-1 flex items-center gap-1">
                {isEditing ? (
                  <>
                    <button
                      onClick={() => handleSave(poi._id)}
                      className="p-1 hover:bg-green-100 dark:hover:bg-green-900/30 rounded text-green-600"
                      title="Save changes"
                    >
                      <Save className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleCancel}
                      className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded text-red-600"
                      title="Cancel editing"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => handleEdit(poi)}
                    className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-600 dark:text-gray-400"
                    title="Edit POI"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Empty State */}
      {sortedFeatures.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 dark:text-gray-400">No POIs found</p>
            <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
              Try adjusting your filters or search terms
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
