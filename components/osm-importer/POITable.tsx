/**
 * POI Table Component - KISS SIMPLIFIED
 * 
 * Simple table view for POIs with editing and selection
 * 
 * @module components/osm-importer/POITable
 */

'use client'

import { useState } from 'react'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import { CheckSquare, Square, Edit3, Save, X, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SimpleOSMPOI } from '@/lib/types/osm-types'
import { OSMService } from '@/lib/services/osm-service-simple'
import { useTranslations } from 'next-intl'

interface POITableProps {
  features: SimpleOSMPOI[]
  selectedFeatures: Set<string>
  onToggleSelection: (id: string) => void
  onEditPOI?: (id: string, updates: any) => void
  onPOIClick?: (poi: SimpleOSMPOI) => void
}

export function POITable({ features, selectedFeatures, onToggleSelection, onEditPOI, onPOIClick }: POITableProps) {
  const t = useTranslations('Pages.OSMImporter.table')
  const { canEdit } = useCmsUser()
  const tCommon = useTranslations('Common')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Record<string, any>>({})

  const handleEdit = (poi: SimpleOSMPOI) => {
    const isDbData = !poi.properties && !poi.geometry
    const poiId = isDbData ? (poi as any).id : poi._id
    setEditingId(poiId)
    setEditValues({
      name: isDbData ? ((poi as any).name || '') : (poi.properties.name || ''),
      city: isDbData ? ((poi as any).city || '') : (poi.properties.city || ''),
      state: isDbData ? ((poi as any).state || '') : (poi.properties.state || ''),
      country: isDbData ? ((poi as any).country || '') : (poi.properties.country || '')
    })
  }

  const handleSave = (poiId: string) => {
    if (onEditPOI) {
      onEditPOI(poiId, editValues)
    }
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
    <div>
      {/* Table Header */}
      <div className="bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800">
        <div className="grid grid-cols-12 gap-4 px-4 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">
          <div className="col-span-1">
            <CheckSquare className="w-4 h-4" />
          </div>
          <div className="col-span-3">{t('name')}</div>
          <div className="col-span-2">{t('category')}</div>
          <div className="col-span-2">{t('city')}</div>
          <div className="col-span-2">{t('state')}</div>
          <div className="col-span-1">{t('country')}</div>
          <div className="col-span-1">{t('actions')}</div>
        </div>
      </div>

      {/* Table Body */}
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {features.map((poi) => {
          // Handle both in-memory and database data structures
          const isDbData = !poi.properties && !poi.geometry
          const location = isDbData ? {
            name: (poi as any).name || t('unnamed'),
            city: (poi as any).city || tCommon('labels.unknown'),
            state: (poi as any).state || tCommon('labels.unknown'),
            country: (poi as any).country || tCommon('labels.unknown'),
            category: (poi as any).primary_category || (poi as any).category || tCommon('labels.unknown')
          } : OSMService.extractLocation(poi)
          
          const poiId = isDbData ? (poi as any).id : poi._id
          const isSelected = selectedFeatures.has(poiId)
          const isEditing = editingId === poiId

          return (
            <div
              key={poiId}
              className={cn(
                "grid grid-cols-12 gap-4 px-4 py-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 transition",
                isSelected && "bg-blue-50 dark:bg-blue-900/20",
                onPOIClick && "cursor-pointer"
              )}
              onClick={() => {
                if (onPOIClick && !isEditing) {
                  onPOIClick(poi)
                }
              }}
            >
              {/* Selection Checkbox */}
              <div className="col-span-1 flex items-center">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleSelection(poiId)
                  }}
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
                    {canEdit && (
                      <button
                        onClick={() => handleSave(poiId)}
                        className="text-green-600 hover:text-green-700"
                      >
                        <Save className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={handleCancel}
                      className="text-red-600 hover:text-red-700"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <>
                    {canEdit && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleEdit(poi)
                        }}
                        className="text-blue-600 hover:text-blue-700"
                        title={tCommon('actions.edit')}
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                    )}
                    {onPOIClick && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onPOIClick(poi)
                        }}
                        className="text-green-600 hover:text-green-700 ml-2"
                        title={t('actions')}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
