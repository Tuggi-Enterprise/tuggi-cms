/**
 * OSM POI Modal Component
 * 
 * Detailed view and editing for individual OSM POIs
 * 
 * @module components/osm-importer/OSMPOIModal
 */

'use client'

import { useState, useEffect } from 'react'
import { 
  X, MapPin, Tag, Calendar, Edit3, Save, 
  AlertCircle, CheckCircle, ExternalLink, Copy
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { EditableOSMPOI } from '@/types/osm-importer'

interface OSMPOIModalProps {
  poi: EditableOSMPOI | null
  isOpen: boolean
  onClose: () => void
  onSave: (poi: EditableOSMPOI) => void
  extractLocationFromOSMTags: (tags: Record<string, string>) => any
  getPrimaryCategory: (tags: Record<string, string>) => string | null
}

export function OSMPOIModal({ 
  poi, 
  isOpen, 
  onClose, 
  onSave, 
  extractLocationFromOSMTags,
  getPrimaryCategory 
}: OSMPOIModalProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValues, setEditValues] = useState<Record<string, any>>({})
  const [hasChanges, setHasChanges] = useState(false)

  // Reset state when POI changes
  useEffect(() => {
    if (poi) {
      const location = extractLocationFromOSMTags(poi.properties.tags)
      setEditValues({
        name: location.name || '',
        city: location.city || '',
        state: location.state || '',
        country: location.country || '',
        address: location.address || ''
      })
      setIsEditing(false)
      setHasChanges(false)
    }
  }, [poi, extractLocationFromOSMTags])

  if (!isOpen || !poi) return null

  const location = extractLocationFromOSMTags(poi.properties.tags)
  const category = getPrimaryCategory(poi.properties.tags)
  const coordinates = poi.geometry.type === 'Point' 
    ? poi.geometry.coordinates as [number, number]
    : null

  const handleEdit = () => {
    setIsEditing(true)
  }

  const handleSave = () => {
    if (hasChanges) {
      onSave({
        ...poi,
        _edited: true,
        _editedFields: editValues
      })
    }
    setIsEditing(false)
    setHasChanges(false)
  }

  const handleCancel = () => {
    setIsEditing(false)
    setHasChanges(false)
    // Reset to original values
    const originalLocation = extractLocationFromOSMTags(poi.properties.tags)
    setEditValues({
      name: originalLocation.name || '',
      city: originalLocation.city || '',
      state: originalLocation.state || '',
      country: originalLocation.country || '',
      address: originalLocation.address || ''
    })
  }

  const handleFieldChange = (field: string, value: string) => {
    setEditValues(prev => ({ ...prev, [field]: value }))
    setHasChanges(true)
  }

  const handleCopyOSMId = () => {
    navigator.clipboard.writeText(`${poi.properties.type}-${poi.properties.id}`)
  }

  const handleOpenInOSM = () => {
    const osmUrl = `https://www.openstreetmap.org/${poi.properties.type}/${poi.properties.id}`
    window.open(osmUrl, '_blank')
  }

  const renderField = (label: string, field: string, value: string, placeholder: string) => (
    <div className="space-y-1">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>
      {isEditing ? (
        <input
          type="text"
          value={editValues[field] || ''}
          onChange={(e) => handleFieldChange(field, e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      ) : (
        <div className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 rounded-lg text-gray-900 dark:text-gray-100">
          {value || <span className="text-gray-400 italic">Not specified</span>}
        </div>
      )}
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl bg-white dark:bg-gray-950 rounded-lg shadow-xl border border-gray-200 dark:border-gray-800 max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MapPin className="w-6 h-6 text-blue-600" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {isEditing ? 'Edit POI' : 'POI Details'}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {poi.properties.type.toUpperCase()}-{poi.properties.id}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isEditing ? (
                <>
                  <button
                    onClick={handleSave}
                    disabled={!hasChanges}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition"
                  >
                    <Save className="w-4 h-4" />
                    Save
                  </button>
                  <button
                    onClick={handleCancel}
                    className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg transition"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={handleEdit}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition"
                >
                  <Edit3 className="w-4 h-4" />
                  Edit
                </button>
              )}

              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-4 overflow-y-auto max-h-[calc(90vh-200px)]">
          <div className="space-y-6">
            {/* Basic Information */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-4">
                Basic Information
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {renderField('Name', 'name', location.name || '', 'POI Name')}
                {renderField('City', 'city', location.city || '', 'City')}
                {renderField('State', 'state', location.state || '', 'State/Province')}
                {renderField('Country', 'country', location.country || '', 'Country')}
                {renderField('Address', 'address', location.address || '', 'Full Address')}
              </div>
            </div>

            {/* OSM Information */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-4">
                OSM Information
              </h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                  <span className="text-sm text-gray-600 dark:text-gray-400">OSM ID</span>
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono bg-white dark:bg-gray-800 px-2 py-1 rounded">
                      {poi.properties.type}-{poi.properties.id}
                    </code>
                    <button
                      onClick={handleCopyOSMId}
                      className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                      title="Copy OSM ID"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Category</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {category || 'No category'}
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Type</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100 capitalize">
                    {poi.properties.type}
                  </span>
                </div>

                {coordinates && (
                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Coordinates</span>
                    <span className="text-sm font-mono text-gray-900 dark:text-gray-100">
                      {coordinates[1].toFixed(6)}, {coordinates[0].toFixed(6)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* OSM Tags */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-4">
                OSM Tags ({Object.keys(poi.properties.tags).length})
              </h4>
              <div className="max-h-48 overflow-y-auto bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                <div className="space-y-2">
                  {Object.entries(poi.properties.tags).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between text-sm">
                      <span className="font-mono text-gray-600 dark:text-gray-400">{key}</span>
                      <span className="text-gray-900 dark:text-gray-100 ml-4">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-4 border-t border-gray-200 dark:border-gray-800">
              <button
                onClick={handleOpenInOSM}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg flex items-center gap-2 transition"
              >
                <ExternalLink className="w-4 h-4" />
                View in OpenStreetMap
              </button>

              <button
                onClick={handleCopyOSMId}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg flex items-center gap-2 transition"
              >
                <Copy className="w-4 h-4" />
                Copy OSM ID
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        {hasChanges && (
          <div className="px-6 py-3 bg-yellow-50 dark:bg-yellow-900/20 border-t border-yellow-200 dark:border-yellow-800">
            <div className="flex items-center gap-2 text-sm text-yellow-800 dark:text-yellow-200">
              <AlertCircle className="w-4 h-4" />
              <span>You have unsaved changes</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
