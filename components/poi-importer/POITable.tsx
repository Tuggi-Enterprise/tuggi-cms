/**
 * POI Table Component - KISS SIMPLIFIED
 * 
 * Simple table view for POIs with editing, selection, and deletion
 * 
 * @module components/poi-importer/POITable
 */

'use client'

import { useState } from 'react'
import { CheckSquare, Square, Edit3, Save, X, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

interface HomologPOI {
  uuid_id: string
  name?: string
  city?: string
  state?: string
  country?: string
  primary_category?: string
  [key: string]: any
}

interface POITableProps {
  features: HomologPOI[]
  selectedFeatures: Set<string>
  onToggleSelection: (id: string) => void
  onEditPOI?: (id: string, updates: any) => void
  onDeletePOI?: (id: string) => void
}

export function POITable({ features, selectedFeatures, onToggleSelection, onEditPOI, onDeletePOI }: POITableProps) {
  const t = useTranslations('Pages.POIImporter.table')
  const tCommon = useTranslations('Common')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Record<string, any>>({})

  const handleEdit = (poi: HomologPOI) => {
    setEditingId(poi.uuid_id)
    setEditValues({
      name: poi.name || '',
      city: poi.city || '',
      state: poi.state || '',
      country: poi.country || ''
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

  const handleDelete = (poiId: string) => {
    if (onDeletePOI) {
      onDeletePOI(poiId)
    }
  }

  return (
    <div className="h-full flex flex-col">
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
      <div className="flex-1 overflow-y-auto">
        {features.map((poi) => {
          const poiId = poi.uuid_id
          const isSelected = selectedFeatures.has(poiId)
          const isEditing = editingId === poiId

          return (
            <div
              key={poiId}
              className={cn(
                "grid grid-cols-12 gap-4 px-4 py-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 transition",
                isSelected && "bg-blue-50 dark:bg-blue-900/20"
              )}
            >
              {/* Selection Checkbox */}
              <div className="col-span-1 flex items-center">
                <button
                  onClick={() => onToggleSelection(poiId)}
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
                  <span className="font-medium">{poi.name || t('unnamed')}</span>
                )}
              </div>

              {/* Category */}
              <div className="col-span-2 flex items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {poi.primary_category || tCommon('labels.unknown')}
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
                  <span className="text-sm">{poi.city || tCommon('labels.unknown')}</span>
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
                  <span className="text-sm">{poi.state || tCommon('labels.unknown')}</span>
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
                  <span className="text-sm">{poi.country || tCommon('labels.unknown')}</span>
                )}
              </div>

              {/* Actions */}
              <div className="col-span-1 flex items-center gap-2">
                {isEditing ? (
                  <>
                    <button
                      onClick={() => handleSave(poiId)}
                      className="text-green-600 hover:text-green-700"
                      title={tCommon('actions.save')}
                    >
                      <Save className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleCancel}
                      className="text-red-600 hover:text-red-700"
                      title={tCommon('actions.cancel')}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => handleEdit(poi)}
                      className="text-blue-600 hover:text-blue-700"
                      title={tCommon('actions.edit')}
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(poiId)}
                      className="text-red-600 hover:text-red-700"
                      title={tCommon('actions.delete')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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
